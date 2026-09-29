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
    return !!user && user.role === 'admin';
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

    return _sendMenu(client, msg, {
        title: `🛡️ *PANEL ADMIN — AUTOBOT*`,
        lines: [
            `👥 User: *${users.length}*  ·  🚚 Driver: *${drivers.length}*`,
            ``,
            `1️⃣  👥 *Kelola User & Akun*`,
            `2️⃣  💰 *Saldo & Transaksi*`,
            `3️⃣  🚀 *Absen Override* _(absenkan driver)_`,
            `4️⃣  ⚙️ *Form & Sistem*`,
            `5️⃣  📊 *Statistik Sistem*`,
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
            `0️⃣  ⬅ Kembali`,
        ],
    });
}

async function _menuSaldo(client, msg) {
    _setState(msg, { view: 'saldo' });
    return _sendMenu(client, msg, {
        title: `💰 *SALDO & TRANSAKSI*`,
        lines: [
            `1️⃣  💵 Lihat saldo semua user`,
            `2️⃣  ➕ Tambah saldo user`,
            `3️⃣  ➖ Potong saldo user`,
            `4️⃣  🧾 Daftar order top-up`,
            `0️⃣  ⬅ Kembali`,
        ],
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
 * Minta konfirmasi sebelum eksekusi. Pakai tombol asli bila tersedia.
 */
async function _confirm(client, msg, { body, command }) {
    _setState(msg, { view: 'confirm', command });
    return _sendMenu(client, msg, {
        title: `⚠️ *KONFIRMASI*`,
        lines: [body],
        footer: `_Balas *1* untuk lanjut · *0* untuk batal_`,
        buttons: [
            { id: command, body: '✅ Ya, Lanjut' },
            { id: '/admin', body: '❌ Batal' },
        ],
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
            case 'pick_user':
            case 'pick_driver':
            case 'pick_driver_link':
            case 'confirm':
            case 'input_nominal':
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
            if (num === '4') { await _menuSistem(client, msg); return { handled: true, command: null }; }
            if (num === '5') { _clear(msg); return { handled: true, command: '/adminstat' }; }
            return _invalid(msg);

        // ── Kelola user ──
        case 'user':
            if (num === '1') { _clear(msg); return { handled: true, command: '/listuser' }; }
            if (num === '2') { await _pickUser(client, msg, 'aktifkan', `✅ *AKTIFKAN AKUN*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '3') { await _pickUser(client, msg, 'nonaktifkan', `🚫 *NONAKTIFKAN AKUN*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '4') { await _pickUser(client, msg, 'resetpw', `🔑 *RESET PASSWORD*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '5') { await _pickUser(client, msg, 'setadmin', `👑 *JADIKAN ADMIN*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '6') { await _pickUser(client, msg, 'linkdriver', `🔗 *TAUTKAN AKUN KE DRIVER*\n_Pilih user:_`); return { handled: true, command: null }; }
            return _invalid(msg);

        // ── Saldo ──
        case 'saldo':
            if (num === '1') { _clear(msg); return { handled: true, command: '/listuser' }; }
            if (num === '2') { await _pickUser(client, msg, 'tambahsaldo', `➕ *TAMBAH SALDO*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '3') { await _pickUser(client, msg, 'potongsaldo', `➖ *POTONG SALDO*\n_Pilih user:_`); return { handled: true, command: null }; }
            if (num === '4') { _clear(msg); return { handled: true, command: '/orderlist' }; }
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
                const cmd = state.command;
                _clear(msg);
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
