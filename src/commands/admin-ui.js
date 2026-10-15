// ══════════════════════════════════════
// 🛡️ ADMIN UI — Panel admin interaktif (navigasi angka + tombol)
// ══════════════════════════════════════
// Admin cukup menekan tombol / membalas angka, tanpa mengetik perintah.

const auth = require('../auth');
const wallet = require('../wallet');
const db = require('../database');
const settings = require('../settings');
const config = require('../config');
const logger = require('../utils/logger');
const { formatRupiah } = require('../utils/helpers');
const { sendButtons } = require('../utils/interactive');
const { getUserIdByWa, getSenderWa } = require('./akun');

// chatId -> { view, action?, target?, command?, page? }
const adminState = new Map();

const MAX_LIST = 20;

function _chatId(msg) {
    return msg.safeChatId || msg.from;
}

function _setState(msg, state) {
    adminState.set(_chatId(msg), state);
}

function _getState(msg) {
    return adminState.get(_chatId(msg));
}

function _clear(msg) {
    adminState.delete(_chatId(msg));
}

/**
 * Cek admin berdasarkan nomor HP asli pengirim (aman di grup maupun chat pribadi).
 */
function isAdminMsg(msg) {
    const userId = getUserIdByWa(getSenderWa(msg));
    if (!userId) return false;
    const user = auth.findUserById(userId);
    return !!user && user.role === 'admin' && user.isActive !== false;
}

function _footer() {
    return `_Balas angka untuk memilih · 0 = kembali_`;
}

/**
 * Kirim menu bernomor. Bila jumlah opsi ≤ 3 dan punya command langsung,
 * coba kirim sebagai tombol asli WhatsApp (otomatis fallback ke teks).
 */
async function _sendMenu(client, msg, { title, lines, footer = _footer(), buttons = null }) {
    const body = `${title}\n━━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n━━━━━━━━━━━━━━━━━━━━━━\n${footer}`;

    if (buttons && buttons.length && buttons.length <= 3) {
        const chatId = _chatId(msg);
        try {
            return await sendButtons(client, chatId, { body, buttons, footer: 'Autobot Admin' });
        } catch (e) {
            logger.debug('ADMIN-UI', `Tombol gagal, fallback teks: ${e.message}`);
        }
    }
    return msg.reply(body);
}

// ══════════════════════════════════════
//  MENU UTAMA ADMIN
// ══════════════════════════════════════

async function showAdminMenu(client, msg) {
    if (!isAdminMsg(msg)) {
        _clear(msg);
        return msg.reply(`❌ *AKSES DITOLAK*\nPerintah ini khusus admin.`);
    }

    _setState(msg, { view: 'main' });

    const users = auth.listUsers();
    const drivers = db.getAllDrivers();

    // Ringkasan singkat di kepala panel: admin langsung tahu kondisi sistem
    // tanpa harus masuk ke menu statistik dulu.
    const totalSaldo = users.reduce((n, u) => n + wallet.getBalance(u.id), 0);
    const belumSiap = drivers.filter((d) => !db.isCookieReady(d) || !db.isScreenshotReady(d)).length;

    return _sendMenu(client, msg, {
        title: `🛡️ *PANEL ADMIN — AUTOBOT*`,
        lines: [
            `👥 User: *${users.length}*  ·  🚚 Driver: *${drivers.length}*`,
            `💰 Total saldo: *${formatRupiah(totalSaldo)}*`,
            belumSiap
                ? `⚠️ *${belumSiap} driver* belum lengkap berkasnya`
                : `✅ Semua berkas driver lengkap`,
            ``,
            `1️⃣  👥 *Kelola User & Akun*`,
            `2️⃣  💰 *Saldo & Transaksi*`,
            `3️⃣  🚀 *Absen Override* _(absenkan driver)_`,
            `4️⃣  🚚 *Kelola Driver & Berkas*`,
            `5️⃣  💾 *Cadangan & Pemulihan Data*`,
            `6️⃣  ⚙️ *Form & Sistem*`,
            `7️⃣  📊 *Statistik Sistem*`,
            `0️⃣  ❌ Keluar dari panel`,
        ],
    });
}

async function _menuUser(client, msg) {
    _setState(msg, { view: 'user' });
    return _sendMenu(client, msg, {
        title: `👥 *KELOLA USER & AKUN*`,
        lines: [
            `1️⃣  📋 Lihat semua user`,
            `2️⃣  ✅ Aktifkan akun`,
            `3️⃣  🚫 Nonaktifkan akun`,
            `4️⃣  🔑 Reset password user`,
            `5️⃣  👑 Jadikan admin`,
            `6️⃣  🔗 Tautkan akun ke driver`,
            `7️⃣  🗑️ *Hapus akun permanen*`,
            `0️⃣  ⬅ Kembali`,
        ],
    });
}

async function _menuSaldo(client, msg) {
    _setState(msg, { view: 'saldo' });

    const penerima = require('./admin-massal').calonPenerima();

    return _sendMenu(client, msg, {
        title: `💰 *SALDO & TRANSAKSI*`,
        lines: [
            `1️⃣  💵 Lihat saldo semua user`,
            `2️⃣  ➕ Tambah saldo *satu* user`,
            `3️⃣  ➖ Potong saldo *satu* user`,
            `4️⃣  👥 *Tambah saldo SEMUA* _(${penerima.length} akun)_`,
            `5️⃣  🎯 *Tambah saldo PILIHAN* _(pilih sendiri)_`,
            `6️⃣  🧾 Daftar order top-up`,
            `0️⃣  ⬅ Kembali`,
        ],
    });
}

async function _menuDriver(client, msg) {
    _setState(msg, { view: 'driver' });

    const drivers = db.getAllDrivers();
    const belumSiap = drivers.filter((d) => !db.isCookieReady(d) || !db.isScreenshotReady(d));

    return _sendMenu(client, msg, {
        title: `🚚 *KELOLA DRIVER & BERKAS*`,
        lines: [
            `🚚 Terdaftar: *${drivers.length}*` +
            (belumSiap.length ? `  ·  ⚠️ *${belumSiap.length}* belum lengkap` : `  ·  ✅ semua siap`),
            ``,
            `1️⃣  📋 Daftar driver & kesiapan berkas`,
            `2️⃣  🗓️ Cek jadwal libur`,
            `3️⃣  🏖️ Atur hari libur driver`,
            `4️⃣  🚛 Batalkan libur _(set masuk)_`,
            `5️⃣  🗑️ *Hapus driver* _(+ cookie & foto)_`,
            `0️⃣  ⬅ Kembali`,
        ],
    });
}

async function _menuBackup(client, msg) {
    _setState(msg, { view: 'backup' });

    // Tampilkan kapan cadangan terakhir dibuat supaya admin tahu
    // apakah perlu membuat yang baru.
    let barisTerakhir = `📦 Belum ada cadangan tersimpan`;
    try {
        const backup = require('../services/backup');
        const daftar = backup.daftarBackup();
        if (daftar.length) {
            const t = daftar[0];
            const waktu = t.waktu.toLocaleString('id-ID', { timeZone: config.cronTimezone });
            barisTerakhir = `📦 Terakhir: *${backup._ukuranTerbaca(t.ukuran)}* · ${waktu}\n` +
                `     _${daftar.length} arsip tersimpan_`;
        }
    } catch (e) {
        logger.debug('ADMIN-UI', `Gagal membaca daftar cadangan: ${e.message}`);
    }

    return _sendMenu(client, msg, {
        title: `💾 *CADANGAN & PEMULIHAN DATA*`,
        lines: [
            barisTerakhir,
            ``,
            `1️⃣  📦 *Cadangkan sekarang* & kirim ke WA`,
            `2️⃣  📋 Daftar cadangan di VPS`,
            `3️⃣  ♻️ Cara memulihkan data _(panduan)_`,
            `0️⃣  ⬅ Kembali`,
        ],
        footer: `_Cadangan memuat user, driver, saldo, cookie & foto._`,
    });
}

async function _menuAbsen(client, msg) {
    _setState(msg, { view: 'absen' });
    return _sendMenu(client, msg, {
        title: `🚀 *ABSEN OVERRIDE (ADMIN)*`,
        lines: [
            `_Jalankan absen atas nama driver mana pun._`,
            ``,
            `1️⃣  🚚 Absenkan 1 driver _(saldo dipotong)_`,
            `2️⃣  🆓 Absenkan 1 driver _(gratis)_`,
            `3️⃣  👥 Absenkan SEMUA driver _(gratis)_`,
            `4️⃣  📋 Lihat daftar driver`,
            `0️⃣  ⬅ Kembali`,
        ],
    });
}

async function _menuSistem(client, msg) {
    _setState(msg, { view: 'sistem' });
    return _sendMenu(client, msg, {
        title: `⚙️ *FORM & SISTEM*`,
        lines: [
            `1️⃣  👁️ Lihat link Google Form aktif`,
            `2️⃣  🔗 Ganti link Google Form`,
            `3️⃣  ↩️ Reset link ke default (.env)`,
            `4️⃣  🖥️ Status server & diagnostik`,
            `5️⃣  🗓️ Cek jadwal libur driver`,
            `0️⃣  ⬅ Kembali`,
        ],
    });
}

// ══════════════════════════════════════
//  PICKER (pilih user / driver dari daftar)
// ══════════════════════════════════════

async function _pickUser(client, msg, action, judul) {
    const users = auth.listUsers();
    if (!users.length) {
        await msg.reply(`📋 Belum ada user terdaftar.`);
        return showAdminMenu(client, msg);
    }

    const list = users.slice(0, MAX_LIST);
    _setState(msg, { view: 'pick_user', action, items: list.map(u => u.email) });

    const lines = list.map((u, i) => {
        const status = u.isActive !== false ? '🟢' : '🔴';
        const role = u.role === 'admin' ? '👑' : '👤';
        return `${i + 1}. ${status}${role} *${u.nama}*\n     ${u.email} · ${formatRupiah(wallet.getBalance(u.id))}`;
    });
    lines.push(`0️⃣  ⬅ Batal`);

    return _sendMenu(client, msg, { title: judul, lines });
}

async function _pickDriver(client, msg, action, judul) {
    const drivers = db.getAllDrivers();
    if (!drivers.length) {
        await msg.reply(`📋 Belum ada driver di database.`);
        return showAdminMenu(client, msg);
    }

    const list = drivers.slice(0, MAX_LIST);
    _setState(msg, { view: 'pick_driver', action, items: list.map(d => d.nama) });

    const lines = list.map((d, i) => {
        const libur = db.isLiburHariIni(d.nama) ? '🏖️ Libur' : '🚚 Masuk';
        return `${i + 1}. *${d.nama}* _(ID ${d.id})_\n     ${libur}`;
    });
    lines.push(`0️⃣  ⬅ Batal`);

    return _sendMenu(client, msg, { title: judul, lines });
}

/**
 * Picker driver generik dengan view tujuan sendiri, supaya satu daftar bisa
 * dipakai untuk aksi yang berbeda (libur, set masuk, hapus).
 */
async function _pickDriverUntuk(client, msg, view, judul) {
    const drivers = db.getAllDrivers();
    if (!drivers.length) {
        await msg.reply(`📋 Belum ada driver di database.`);
        return showAdminMenu(client, msg);
    }

    const list = drivers.slice(0, MAX_LIST);
    _setState(msg, { view, items: list.map((d) => d.nama) });

    const lines = list.map((d, i) => {
        const libur = db.isLiburHariIni(d.nama) ? '🏖️ Libur' : '🚚 Masuk';
        const siap = db.isCookieReady(d) && db.isScreenshotReady(d) ? '✅' : '⚠️';
        return `${i + 1}. *${d.nama}* _(ID ${d.id})_\n     ${libur} · ${siap} berkas`;
    });
    lines.push(`0️⃣  ⬅ Batal`);

    return _sendMenu(client, msg, { title: judul, lines });
}

const HARI_LIBUR = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];

async function _pickHariLibur(client, msg, nama) {
    _setState(msg, { view: 'pick_hari_libur', target: nama, items: HARI_LIBUR });

    const lines = HARI_LIBUR.map((h, i) => `${i + 1}. ${h.charAt(0).toUpperCase() + h.slice(1)}`);
    lines.push(`0️⃣  ⬅ Batal`);

    return _sendMenu(client, msg, {
        title: `🏖️ *HARI LIBUR*\n_Driver: ${nama}_\n_Pilih hari:_`,
        lines,
    });
}

/**
 * Pilih penerima saldo massal. Admin mencentang nomor (boleh "1,3" atau
 * "2-4"), jadi tidak perlu mengulang alur per user.
 */
async function _pickPenerima(client, msg) {
    const kandidat = require('./admin-massal').calonPenerima();
    if (!kandidat.length) {
        await msg.reply(
            `📭 *TIDAK ADA PENERIMA*\n` +
            `Belum ada akun aktif yang tertaut ke driver.\n\n` +
            `💡 Tautkan dulu lewat menu *Kelola User → Tautkan akun ke driver*.`
        );
        return showAdminMenu(client, msg);
    }

    const list = kandidat.slice(0, MAX_LIST);
    _setState(msg, { view: 'pick_penerima', items: list.map((u) => u.email) });

    const lines = list.map((u, i) =>
        `${i + 1}. *${u.nama}*\n     🚚 ${u.driverNama} · ${formatRupiah(wallet.getBalance(u.id))}`);
    lines.push(`0️⃣  ⬅ Batal`);

    return _sendMenu(client, msg, {
        title: `🎯 *PILIH PENERIMA SALDO*`,
        lines,
        footer: `_Ketik nomornya: \`1,3\` atau \`2-4\` · \`semua\` untuk semua · 0 = batal_`,
    });
}

/**
 * Minta nominal untuk saldo massal.
 * @param {Array<string>|null} emails Daftar penerima, null = semua kandidat.
 */
async function _mintaNominalMassal(client, msg, emails) {
    const kandidat = require('./admin-massal').calonPenerima();
    if (!kandidat.length) {
        await msg.reply(
            `📭 *TIDAK ADA PENERIMA*\n` +
            `Belum ada akun aktif yang tertaut ke driver.`
        );
        return showAdminMenu(client, msg);
    }

    const terpilih = emails || kandidat.map((u) => u.email);
    _setState(msg, { view: 'input_nominal_massal', items: terpilih });

    return msg.reply(
        `👥 *SALDO MASSAL*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 Penerima: *${terpilih.length}* akun\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Ketik nominal per akun (angka saja):\n\n` +
        `💡 \`50000\` → tambah Rp 50.000 tiap akun\n` +
        `💡 \`-10000\` → potong Rp 10.000 tiap akun\n\n` +
        `_(balas 0 untuk batal)_`
    );
}

/**
 * Minta konfirmasi sebelum eksekusi.
 *
 * Dua mode: `command` (perintah slash, bisa dikirim sebagai tombol asli
 * WhatsApp) atau `aksi` (fungsi yang dijalankan langsung). Mode `aksi`
 * dipakai untuk hal yang tidak punya perintah setara — misal saldo massal
 * dengan daftar penerima pilihan — dan selalu jatuh ke menu teks karena
 * tombol WhatsApp hanya bisa membawa string.
 */
async function _confirm(client, msg, { body, command, aksi }) {
    _setState(msg, { view: 'confirm', command, aksi });
    return _sendMenu(client, msg, {
        title: `⚠️ *KONFIRMASI*`,
        lines: [body],
        footer: `_Balas *1* untuk lanjut · *0* untuk batal_`,
        buttons: command ? [
            { id: command, body: '✅ Ya, Lanjut' },
            { id: '/admin', body: '❌ Batal' },
        ] : null,
    });
}

// ══════════════════════════════════════
//  HANDLER INPUT
// ══════════════════════════════════════

/**
 * Tangani input admin (angka navigasi maupun teks bebas seperti nominal/password/link).
 * @returns {{ handled: boolean, command?: string|null }}
 */
async function handleAdminInput(client, msg, pesan) {
    const state = _getState(msg);
    if (!state) return { handled: false };

    // Sesi admin dicabut di tengah jalan
    if (!isAdminMsg(msg)) {
        _clear(msg);
        return { handled: false };
    }

    const text = String(pesan || '').trim();
    const num = /^\d{1,2}$/.test(text) ? text : null;

    // ── Batal universal ──
    if (num === '0') {
        switch (state.view) {
            case 'main':
                _clear(msg);
                await msg.reply(`👋 Keluar dari panel admin. Ketik \`/admin\` untuk membuka lagi.`);
                return { handled: true, command: null };
            case 'user':
            case 'saldo':
            case 'absen':
            case 'sistem':
            case 'driver':
            case 'backup':
            case 'pick_user':
            case 'pick_driver':
            case 'pick_driver_link':
            case 'pick_driver_hapus':
            case 'pick_driver_libur':
            case 'pick_driver_masuk':
            case 'pick_hari_libur':
            case 'pick_penerima':
            case 'confirm':
            case 'input_nominal':
            case 'input_nominal_massal':
            case 'input_password':
            case 'input_formurl':
                await showAdminMenu(client, msg);
                return { handled: true, command: null };
        }
    }

    switch (state.view) {
        // ── Menu utama ──
        case 'main':
            if (num === '1') { await _menuUser(client, msg); return { handled: true, command: null }; }
            if (num === '2') { await _menuSaldo(client, msg); return { handled: true, command: null }; }
            if (num === '3') { await _menuAbsen(client, msg); return { handled: true, command: null }; }
            if (num === '4') { await _menuDriver(client, msg); return { handled: true, command: null }; }
            if (num === '5') { await _menuBackup(client, msg); return { handled: true, command: null }; }
            if (num === '6') { await _menuSistem(client, msg); return { handled: true, command: null }; }
            if (num === '7') { _clear(msg); return { handled: true, command: '/adminstat' }; }
            return _invalid(msg);

        // ── Kelola user ──
        case 'user':
            if (num === '1') { _clear(msg); return { handled: true, command: '/listuser' }; }
            if (num === '2') { await _pickUser(client, msg, 'aktifkan', `✅ *AKTIFKAN AKUN*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '3') { await _pickUser(client, msg, 'nonaktifkan', `🚫 *NONAKTIFKAN AKUN*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '4') { await _pickUser(client, msg, 'resetpw', `🔑 *RESET PASSWORD*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '5') { await _pickUser(client, msg, 'setadmin', `👑 *JADIKAN ADMIN*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '6') { await _pickUser(client, msg, 'linkdriver', `🔗 *TAUTKAN AKUN KE DRIVER*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '7') { await _pickUser(client, msg, 'hapusakun', `🗑️ *HAPUS AKUN PERMANEN*\n_Pilih user:_`); return { handled: true, command: null }; }
            return _invalid(msg);

        // ── Saldo ──
        case 'saldo':
            if (num === '1') { _clear(msg); return { handled: true, command: '/listuser' }; }
            if (num === '2') { await _pickUser(client, msg, 'tambahsaldo', `➕ *TAMBAH SALDO*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '3') { await _pickUser(client, msg, 'potongsaldo', `➖ *POTONG SALDO*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '4') { await _mintaNominalMassal(client, msg, null); return { handled: true, command: null }; }
            if (num === '5') { await _pickPenerima(client, msg); return { handled: true, command: null }; }
            if (num === '6') { _clear(msg); return { handled: true, command: '/orderlist' }; }
            return _invalid(msg);

        // ── Kelola driver & berkas ──
        case 'driver':
            if (num === '1') { _clear(msg); return { handled: true, command: '/listdriver' }; }
            if (num === '2') { _clear(msg); return { handled: true, command: '/ceklibur' }; }
            if (num === '3') { await _pickDriverUntuk(client, msg, 'pick_driver_libur', `🏖️ *ATUR HARI LIBUR*\n_Pilih driver:_`); return { handled: true, command: null }; }
            if (num === '4') { await _pickDriverUntuk(client, msg, 'pick_driver_masuk', `🚛 *BATALKAN LIBUR*\n_Pilih driver:_`); return { handled: true, command: null }; }
            if (num === '5') { await _pickDriverUntuk(client, msg, 'pick_driver_hapus', `🗑️ *HAPUS DRIVER*\n_Pilih driver:_`); return { handled: true, command: null }; }
            return _invalid(msg);

        // ── Cadangan data ──
        case 'backup':
            if (num === '1') { _clear(msg); return { handled: true, command: '/backup' }; }
            if (num === '2') { _clear(msg); return { handled: true, command: '/listbackup' }; }
            if (num === '3') {
                _clear(msg);
                await msg.reply(
                    `♻️ *CARA MEMULIHKAN DATA*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `1️⃣ Kirim berkas cadangan \`.tar.gz\` ke chat ini,\n` +
                    `    tulis \`/restore\` di kolom keterangannya.\n\n` +
                    `2️⃣ Bot menampilkan isi arsip untuk diperiksa.\n\n` +
                    `3️⃣ Ketik \`/restore ya\` untuk benar-benar memulihkan.\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🛟 Data lama *otomatis diarsipkan* dulu, jadi salah pulihkan masih bisa dikembalikan.\n\n` +
                    `⚠️ Setelah pulih, jalankan di VPS:\n\`pm2 restart auto-petrip-bot\``
                );
                return { handled: true, command: null };
            }
            return _invalid(msg);

        // ── Absen override ──
        case 'absen':
            if (num === '1') { await _pickDriver(client, msg, 'absen_bayar', `🚚 *ABSENKAN DRIVER*\n_Saldo driver akan dipotong. Pilih driver:_`); return { handled: true, command: null }; }
            if (num === '2') { await _pickDriver(client, msg, 'absen_gratis', `🆓 *ABSENKAN DRIVER (GRATIS)*\n_Saldo TIDAK dipotong. Pilih driver:_`); return { handled: true, command: null }; }
            if (num === '3') {
                await _confirm(client, msg, {
                    body: `Jalankan absen untuk *SEMUA driver* tanpa memotong saldo?`,
                    command: '/absenkansemua',
                });
                return { handled: true, command: null };
            }
            if (num === '4') { _clear(msg); return { handled: true, command: '/listdriver' }; }
            return _invalid(msg);

        // ── Sistem ──
        case 'sistem':
            if (num === '1') { _clear(msg); return { handled: true, command: '/getform' }; }
            if (num === '2') {
                _setState(msg, { view: 'input_formurl' });
                await msg.reply(`🔗 *GANTI LINK GOOGLE FORM*\n\nKirim link form barunya:\n_Contoh: https://docs.google.com/forms/d/e/xxx/viewform_\n\n_(balas 0 untuk batal)_`);
                return { handled: true, command: null };
            }
            if (num === '3') {
                await _confirm(client, msg, {
                    body: `Kembalikan link Google Form ke default (.env)?`,
                    command: '/resetform',
                });
                return { handled: true, command: null };
            }
            if (num === '4') { _clear(msg); return { handled: true, command: '/status' }; }
            if (num === '5') { _clear(msg); return { handled: true, command: '/ceklibur' }; }
            return _invalid(msg);

        // ── Pilih user dari daftar ──
        case 'pick_user': {
            if (!num) return _invalid(msg);
            const email = state.items[parseInt(num, 10) - 1];
            if (!email) return _invalid(msg);
            return _afterPickUser(client, msg, state.action, email);
        }

        // ── Pilih driver untuk ditautkan ke akun ──
        case 'pick_driver_link': {
            if (!num) return _invalid(msg);
            const nama = state.items[parseInt(num, 10) - 1];
            if (!nama) return _invalid(msg);

            const cmd = `/linkdriveruser ${state.target} ${nama}`;
            _clear(msg);
            return { handled: true, command: cmd };
        }

        // ── Pilih driver untuk diatur hari liburnya ──
        case 'pick_driver_libur': {
            if (!num) return _invalid(msg);
            const nama = state.items[parseInt(num, 10) - 1];
            if (!nama) return _invalid(msg);
            await _pickHariLibur(client, msg, nama);
            return { handled: true, command: null };
        }

        // ── Pilih hari libur ──
        case 'pick_hari_libur': {
            if (!num) return _invalid(msg);
            const hari = state.items[parseInt(num, 10) - 1];
            if (!hari) return _invalid(msg);
            _clear(msg);
            return { handled: true, command: `/setlibur ${state.target} ${hari}` };
        }

        // ── Pilih driver untuk dikembalikan ke jadwal masuk ──
        case 'pick_driver_masuk': {
            if (!num) return _invalid(msg);
            const nama = state.items[parseInt(num, 10) - 1];
            if (!nama) return _invalid(msg);
            _clear(msg);
            return { handled: true, command: `/setmasuk ${nama}` };
        }

        // ── Pilih driver untuk dihapus ──
        case 'pick_driver_hapus': {
            if (!num) return _invalid(msg);
            const nama = state.items[parseInt(num, 10) - 1];
            if (!nama) return _invalid(msg);

            // Peringatkan bila masih ada akun yang bergantung pada driver ini.
            const terkait = auth.listUsers().filter(
                (u) => (u.driverNama || '').toLowerCase() === nama.toLowerCase()
            );

            let body = `Hapus driver *${nama}*?\n` +
                `_Data driver, jadwal libur, cookie & foto ikut dihapus._\n` +
                `_(Dicadangkan otomatis lebih dulu.)_`;
            if (terkait.length) {
                body += `\n\n🔗 *${terkait.length} akun* masih tertaut:\n` +
                    terkait.map((u) => `• ${u.nama}`).join('\n');
            }

            // Dijalankan lewat perintah agar konfirmasi dua langkah di
            // /hapusdriver tetap berlaku sebagai pengaman terakhir.
            await _confirm(client, msg, {
                body,
                aksi: async (m) => {
                    const { handleHapusDriver } = require('./driver');
                    await handleHapusDriver(m, `/hapusdriver ${nama}`);
                    await handleHapusDriver(m, `/hapusdriver ya`);
                },
            });
            return { handled: true, command: null };
        }

        // ── Pilih penerima saldo massal (boleh "1,3" atau "2-4") ──
        case 'pick_penerima': {
            const kandidat = require('./admin-massal').calonPenerima();
            const { pilihan, galat } = require('./admin-massal').pilihDariNomor(text, kandidat);

            if (galat) {
                await msg.reply(`❌ ${galat}\n_Contoh: \`1,3\` atau \`2-4\` · \`semua\` · 0 = batal_`);
                return { handled: true, command: null };
            }
            if (!pilihan.length) return _invalid(msg);

            await _mintaNominalMassal(client, msg, pilihan.map((u) => u.email));
            return { handled: true, command: null };
        }

        // ── Pilih driver dari daftar ──
        case 'pick_driver': {
            if (!num) return _invalid(msg);
            const nama = state.items[parseInt(num, 10) - 1];
            if (!nama) return _invalid(msg);

            const gratis = state.action === 'absen_gratis';
            await _confirm(client, msg, {
                body: `Jalankan absen untuk driver *${nama}*?\n` +
                    `💳 Saldo: ${gratis ? '🆓 tidak dipotong' : `dipotong ${formatRupiah(config.pricePerAbsen)}`}`,
                command: `/absenkan ${nama}${gratis ? ' gratis' : ''}`,
            });
            return { handled: true, command: null };
        }

        // ── Konfirmasi ──
        case 'confirm': {
            if (num === '1' || /^(ya|y|ok|lanjut)$/i.test(text)) {
                const { command: cmd, aksi } = state;
                _clear(msg);

                if (aksi) {
                    try {
                        await aksi(msg);
                    } catch (e) {
                        logger.error('ADMIN-UI', `Aksi konfirmasi gagal: ${e.message}`);
                        await msg.reply(`❌ *GAGAL DIJALANKAN*\n_${e.message}_`);
                    }
                    return { handled: true, command: null };
                }
                return { handled: true, command: cmd };
            }
            await msg.reply(`_Balas *1* untuk lanjut, atau *0* untuk batal._`);
            return { handled: true, command: null };
        }

        // ── Input nominal saldo ──
        case 'input_nominal': {
            const amount = parseInt(text.replace(/[^\d]/g, ''), 10);
            if (isNaN(amount) || amount <= 0) {
                await msg.reply(`❌ Nominal tidak valid. Ketik angka saja, contoh: \`50000\`.\n_(balas 0 untuk batal)_`);
                return { handled: true, command: null };
            }
            const signed = state.action === 'potongsaldo' ? -amount : amount;
            await _confirm(client, msg, {
                body: `${signed >= 0 ? 'Tambah' : 'Potong'} saldo *${formatRupiah(amount)}* untuk akun *${state.target}*?`,
                command: `/adjust ${state.target} ${signed}`,
            });
            return { handled: true, command: null };
        }

        // ── Input nominal saldo massal ──
        case 'input_nominal_massal': {
            // Nominal minus diizinkan (memotong saldo), jadi tanda tidak dibuang.
            const nominal = parseInt(text.replace(/[^\d-]/g, ''), 10);
            if (!Number.isFinite(nominal) || nominal === 0) {
                await msg.reply(
                    `❌ Nominal tidak valid. Ketik angka saja, contoh \`50000\` atau \`-10000\`.\n` +
                    `_(balas 0 untuk batal)_`
                );
                return { handled: true, command: null };
            }

            const emails = state.items;
            const userIds = emails
                .map((e) => auth.findUserByEmail(e))
                .filter(Boolean)
                .map((u) => u.id);

            if (!userIds.length) {
                _clear(msg);
                await msg.reply(`❌ Akun penerima sudah tidak ada. Coba lagi dari \`/admin\`.`);
                return { handled: true, command: null };
            }

            await _confirm(client, msg, {
                body: `${nominal > 0 ? '➕ Menambah' : '➖ Memotong'} *${formatRupiah(Math.abs(nominal))}* ` +
                    `pada *${userIds.length}* akun.\n` +
                    `🧮 Total dana: *${formatRupiah(Math.abs(nominal) * userIds.length)}*`,
                aksi: async (m) => {
                    const { jalankanAdjustMassal } = require('./admin-massal');
                    await jalankanAdjustMassal(m, client, nominal, userIds);
                },
            });
            return { handled: true, command: null };
        }

        // ── Input password baru ──
        case 'input_password': {
            if (text.length < 6) {
                await msg.reply(`❌ Password minimal 6 karakter.\n_(balas 0 untuk batal)_`);
                return { handled: true, command: null };
            }
            const cmd = `/adminreset ${state.target} ${text}`;
            _clear(msg);
            return { handled: true, command: cmd };
        }

        // ── Input link form ──
        case 'input_formurl': {
            if (!/^https?:\/\//i.test(text)) {
                await msg.reply(`❌ Link harus diawali \`http://\` atau \`https://\`.\n_(balas 0 untuk batal)_`);
                return { handled: true, command: null };
            }
            await _confirm(client, msg, {
                body: `Ganti link Google Form menjadi:\n${text}`,
                command: `/setform ${text}`,
            });
            return { handled: true, command: null };
        }
    }

    _clear(msg);
    return { handled: false };
}

/**
 * Lanjutan setelah admin memilih user dari daftar.
 */
async function _afterPickUser(client, msg, action, email) {
    const user = auth.findUserByEmail(email);
    if (!user) {
        _clear(msg);
        await msg.reply(`❌ User *${email}* sudah tidak ada.`);
        return { handled: true, command: null };
    }

    switch (action) {
        case 'aktifkan':
            _clear(msg);
            return { handled: true, command: `/aktifkan ${email}` };

        case 'nonaktifkan':
            await _confirm(client, msg, {
                body: `Nonaktifkan akun *${user.nama}* (${email})?\n_User tidak akan bisa memakai bot._`,
                command: `/nonaktifkan ${email}`,
            });
            return { handled: true, command: null };

        case 'setadmin':
            await _confirm(client, msg, {
                body: `Jadikan *${user.nama}* (${email}) sebagai *ADMIN*?\n_Akses penuh ke seluruh panel._`,
                command: `/setadmin ${email}`,
            });
            return { handled: true, command: null };

        case 'resetpw':
            _setState(msg, { view: 'input_password', target: email });
            await msg.reply(`🔑 *RESET PASSWORD*\nAkun: *${user.nama}* (${email})\n\nKetik password baru (min. 6 karakter):\n_(balas 0 untuk batal)_`);
            return { handled: true, command: null };

        case 'tambahsaldo':
        case 'potongsaldo':
            _setState(msg, { view: 'input_nominal', action, target: email });
            await msg.reply(
                `${action === 'tambahsaldo' ? '➕ *TAMBAH SALDO*' : '➖ *POTONG SALDO*'}\n` +
                `Akun: *${user.nama}* (${email})\n` +
                `Saldo kini: *${formatRupiah(wallet.getBalance(user.id))}*\n\n` +
                `Ketik nominal (angka saja), contoh: \`50000\`\n_(balas 0 untuk batal)_`
            );
            return { handled: true, command: null };

        case 'linkdriver':
            return _pickDriverForLink(client, msg, email);

        case 'hapusakun':
            await _confirm(client, msg, {
                body: `Hapus akun *${user.nama}* (${email}) ${user.role === 'admin' ? '🛡️ *(ADMIN)*' : ''}?\n` +
                    `💰 Saldo: *${formatRupiah(wallet.getBalance(user.id))}*\n\n` +
                    `_Akun, saldo & riwayat transaksinya DIHAPUS PERMANEN._\n` +
                    `_(Dicadangkan otomatis lebih dulu.)_`,
                aksi: async (m) => {
                    const { jalankanHapusAkun } = require('./admin-massal');
                    await jalankanHapusAkun(m, user.id);
                },
            });
            return { handled: true, command: null };
    }

    _clear(msg);
    return { handled: false };
}

/**
 * Pilih driver yang akan ditautkan ke akun user.
 */
async function _pickDriverForLink(client, msg, email) {
    const drivers = db.getAllDrivers();
    if (!drivers.length) {
        _clear(msg);
        await msg.reply(`📋 Belum ada driver di database.`);
        return { handled: true, command: null };
    }

    const list = drivers.slice(0, MAX_LIST);
    _setState(msg, { view: 'pick_driver_link', items: list.map(d => d.nama), target: email });

    const lines = list.map((d, i) => `${i + 1}. *${d.nama}* _(ID ${d.id})_`);
    lines.push(`0️⃣  ⬅ Batal`);

    await _sendMenu(client, msg, {
        title: `🔗 *TAUTKAN AKUN*\n_Akun: ${email}_\n_Pilih driver:_`,
        lines,
    });
    return { handled: true, command: null };
}

function _invalid(msg) {
    msg.reply(`❌ Pilihan tidak tersedia. Balas angka yang ada di daftar, atau *0* untuk kembali.`).catch(() => { });
    return { handled: true, command: null };
}

module.exports = {
    showAdminMenu,
    handleAdminInput,
    clearAdminState: _clear,
    isAdminMsg,
};
