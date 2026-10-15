// ══════════════════════════════════════════
// 📋 COMMAND: /menu & /bantuan
// ══════════════════════════════════════════
// Menu bernomor: user balas angka (1,2,3) untuk memilih.
//
// Menu bersifat kontekstual: isinya menyesuaikan status pengirim. User yang
// belum login tidak disuguhi menu saldo, dan menu admin hanya muncul bagi
// admin. Tujuannya agar tidak ada pilihan yang dipilih lalu ditolak.

// Simpan konteks menu aktif per chat (in-memory)
const menuState = new Map(); // chatId -> 'main' | 'akun' | 'absen' | 'data' | 'lain'

// Simpan alur input bertahap (topup/login/daftar) per chat
const pendingInput = new Map(); // chatId -> { action, step, data }

/**
 * Status pengirim, dipakai untuk menyusun menu yang relevan.
 * Dimuat saat dipanggil (lazy) untuk menghindari lingkar impor dengan router.
 */
function _konteks(msg) {
    try {
        const { getUserIdByWa, getSenderWa } = require('./akun');
        const auth = require('../auth');
        const wallet = require('../wallet');

        const userId = getUserIdByWa(getSenderWa(msg));
        if (!userId) return { login: false, admin: false };

        const user = auth.findUserById(userId);
        if (!user) return { login: false, admin: false };

        return {
            login: true,
            admin: user.role === 'admin' && user.isActive !== false,
            nama: user.nama,
            saldo: wallet.getBalance(userId),
            driverNama: user.driverNama,
        };
    } catch (e) {
        return { login: false, admin: false };
    }
}

function _chatId(msg) {
    return msg.safeChatId || msg.from;
}

/**
 * Tampilkan menu utama (bernomor)
 */
async function handleMenu(msg) {
    const chatId = _chatId(msg);
    const ctx = _konteks(msg);
    menuState.set(chatId, 'main');

    const { formatRupiah } = require('../utils/helpers');

    let teks =
        `╔════════════════════════╗\n` +
        `  📊 *AUTOBOT COMMAND CENTER* 📊\n` +
        `╚════════════════════════╝\n`;

    // Baris status membuat user langsung tahu posisinya tanpa mengetik /saldo.
    if (ctx.login) {
        teks += `\n👤 *${ctx.nama}*${ctx.admin ? ' 🛡️ _admin_' : ''}\n`;
        teks += `💰 Saldo: *${formatRupiah(ctx.saldo)}*`;
        teks += ctx.driverNama ? `  ·  🚚 ${ctx.driverNama}\n` : `  ·  ⚠️ _belum tertaut driver_\n`;
    } else {
        teks += `\n🔒 _Belum login._ Pilih menu *1* untuk masuk/daftar.\n`;
    }

    teks += `\n*Pilih menu (balas angkanya):*\n\n`;
    teks += `1️⃣  💰 *Akun & Saldo*\n`;
    teks += `2️⃣  🚀 *Absen & Jadwal*\n`;
    teks += `3️⃣  👤 *Data Driver & Media*\n`;
    teks += `4️⃣  ⚙️ *Sistem & Info*\n`;
    if (ctx.admin) teks += `5️⃣  🛡️ *Panel Admin*\n`;
    teks += `9️⃣  ❓ *Daftar Perintah Lengkap*\n`;
    teks += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `_Balas angka untuk memilih._`;

    return msg.reply(teks);
}

/**
 * Submenu: Akun & Saldo
 */
async function _menuAkun(msg) {
    const ctx = _konteks(msg);
    menuState.set(_chatId(msg), 'akun');

    const { formatRupiah } = require('../utils/helpers');

    let teks = `💰 *AKUN & SALDO*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (ctx.login) {
        teks += `👤 ${ctx.nama}  ·  💰 ${formatRupiah(ctx.saldo)}\n\n`;
        teks += `1️⃣  💵 Cek Saldo & Sinkron Pembayaran\n`;
        teks += `2️⃣  ➕ Top-up Saldo _(QRIS)_\n`;
        teks += `3️⃣  📜 Riwayat Transaksi\n`;
        teks += `4️⃣  🔗 Link Dashboard Web\n`;
        teks += `5️⃣  🚚 Tautkan Akun ke Driver\n`;
        teks += `6️⃣  🚪 Logout\n`;
    } else {
        teks += `_Anda belum login._\n\n`;
        teks += `1️⃣  🔑 Login Akun\n`;
        teks += `2️⃣  📝 Daftar Akun Baru\n`;
    }

    teks += `0️⃣  ⬅ Kembali ke Menu Utama\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `_Balas angka untuk memilih._`;

    return msg.reply(teks);
}

/**
 * Submenu: Absen & Jadwal
 */
async function _menuAbsen(msg) {
    const ctx = _konteks(msg);
    menuState.set(_chatId(msg), 'absen');

    const config = require('../config');
    const { formatRupiah } = require('../utils/helpers');

    let teks = `🚀 *ABSEN & JADWAL*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `💳 Tarif: *${formatRupiah(config.pricePerAbsen)}* / absen\n`;
    teks += `⏰ Jadwal otomatis: *${config.cronSchedule}* (${config.cronTimezone})\n\n`;
    teks += `1️⃣  🤖 Absen Semua Driver _(sekarang)_\n`;
    teks += `2️⃣  🚚 Absen Driver Tertentu\n`;
    teks += `3️⃣  📊 Daftar Driver & Kesiapan Data\n`;
    teks += `4️⃣  🗓️ Cek Jadwal Libur\n`;
    teks += `5️⃣  🏖️ Atur Hari Libur Driver\n`;
    teks += `6️⃣  🚛 Batalkan Libur _(set masuk)_\n`;
    teks += `0️⃣  ⬅ Kembali ke Menu Utama\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += ctx.login
        ? `_Balas angka untuk memilih._`
        : `_⚠️ Absen butuh akun & saldo. Login dulu di menu 1._`;

    return msg.reply(teks);
}

/**
 * Submenu: Data Driver & Media
 */
async function _menuData(msg) {
    const ctx = _konteks(msg);
    menuState.set(_chatId(msg), 'data');

    let teks = `👤 *DATA DRIVER & MEDIA*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `1️⃣  📊 Lihat Daftar Driver\n`;
    teks += `2️⃣  ➕ Tambah Driver Baru\n`;
    teks += `3️⃣  📝 Edit Data Driver\n`;
    teks += `4️⃣  📸 Update Foto Reaksi\n`;
    teks += `5️⃣  🍪 Update Cookie Google\n`;
    if (ctx.admin) teks += `6️⃣  🗑️ Hapus Driver _(admin)_\n`;
    teks += `0️⃣  ⬅ Kembali ke Menu Utama\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `💡 _Foto & cookie dikirim sebagai lampiran bersama perintahnya._`;

    return msg.reply(teks);
}

/**
 * Submenu: Sistem & Info
 */
async function _menuLain(msg) {
    const ctx = _konteks(msg);
    menuState.set(_chatId(msg), 'lain');

    let teks = `⚙️ *SISTEM & INFO*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `1️⃣  🖥️ Status Server & Diagnostik\n`;
    teks += `2️⃣  🔗 Link Dashboard Web\n`;
    teks += `3️⃣  👁️ Lihat Link Google Form Aktif\n`;
    teks += `4️⃣  ❓ Daftar Perintah Lengkap\n`;
    if (ctx.admin) {
        teks += `5️⃣  🛡️ Panel Admin\n`;
        teks += `6️⃣  💾 Cadangkan Data Sekarang\n`;
        teks += `7️⃣  🆔 Lihat ID Grup Ini\n`;
    }
    teks += `0️⃣  ⬅ Kembali ke Menu Utama\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `_Balas angka untuk memilih._`;

    return msg.reply(teks);
}

/**
 * Tangani input angka untuk navigasi menu.
 * @returns {{ handled: boolean, command?: string }}
 */
async function handleNumberInput(client, msg, pesan) {
    const chatId = _chatId(msg);
    const state = menuState.get(chatId);
    const num = pesan.trim();

    if (!state) return { handled: false };
    if (!/^[0-9]{1,2}$/.test(num)) return { handled: false };

    const ctx = _konteks(msg);
    const pilih = (command) => { menuState.delete(chatId); return { handled: true, command }; };
    const tetap = () => ({ handled: true, command: null });

    switch (state) {
        case 'main':
            if (num === '1') { await _menuAkun(msg); return tetap(); }
            if (num === '2') { await _menuAbsen(msg); return tetap(); }
            if (num === '3') { await _menuData(msg); return tetap(); }
            if (num === '4') { await _menuLain(msg); return tetap(); }
            if (num === '5' && ctx.admin) return pilih('/admin');
            if (num === '9') return pilih('/bantuan');
            return { handled: false };

        case 'akun':
            if (num === '0') { await handleMenu(msg); return tetap(); }
            if (ctx.login) {
                if (num === '1') return pilih('/saldo');
                if (num === '2') { menuState.delete(chatId); await _startTopupInput(msg); return tetap(); }
                if (num === '3') return pilih('/riwayat');
                if (num === '4') return pilih('/linkakun');
                if (num === '5') { menuState.delete(chatId); await _mintaNamaDriver(msg); return tetap(); }
                if (num === '6') return pilih('/logout');
            } else {
                if (num === '1') { menuState.delete(chatId); await _startLoginInput(msg); return tetap(); }
                if (num === '2') { menuState.delete(chatId); await _startDaftarInput(msg); return tetap(); }
            }
            return { handled: false };

        case 'absen':
            if (num === '0') { await handleMenu(msg); return tetap(); }
            if (num === '1') return pilih('/absenmanual');
            if (num === '2') { menuState.delete(chatId); await _mintaNamaAbsen(msg); return tetap(); }
            if (num === '3') return pilih('/listdriver');
            if (num === '4') return pilih('/ceklibur');
            if (num === '5') { menuState.delete(chatId); await _mintaLibur(msg); return tetap(); }
            if (num === '6') { menuState.delete(chatId); await _mintaMasuk(msg); return tetap(); }
            return { handled: false };

        case 'data':
            if (num === '0') { await handleMenu(msg); return tetap(); }
            if (num === '1') return pilih('/listdriver');
            if (num === '2') { menuState.delete(chatId); await _panduanTambahDriver(msg); return tetap(); }
            if (num === '3') { menuState.delete(chatId); await _panduanEditDriver(msg); return tetap(); }
            if (num === '4') { menuState.delete(chatId); await _panduanUpdateFoto(msg); return tetap(); }
            if (num === '5') { menuState.delete(chatId); await _panduanUpdateCookie(msg); return tetap(); }
            if (num === '6' && ctx.admin) return pilih('/hapusdriver');
            return { handled: false };

        case 'lain':
            if (num === '0') { await handleMenu(msg); return tetap(); }
            if (num === '1') return pilih('/status');
            if (num === '2') return pilih('/linkakun');
            if (num === '3') return pilih('/getform');
            if (num === '4') return pilih('/bantuan');
            if (num === '5' && ctx.admin) return pilih('/admin');
            if (num === '6' && ctx.admin) return pilih('/backup');
            if (num === '7' && ctx.admin) return pilih('/idgrup');
            return { handled: false };

        default:
            menuState.delete(chatId);
            return { handled: false };
    }
}

/**
 * Tampilkan daftar perintah lengkap (teks).
 * Blok admin hanya ditampilkan bila pengirim memang admin.
 */
async function handleBantuan(msg) {
    const ctx = _konteks(msg);
    const config = require('../config');
    const { formatRupiah } = require('../utils/helpers');

    let menu = `╔════════════════════════╗\n`;
    menu += `  📊 *DAFTAR PERINTAH LENGKAP* 📊\n`;
    menu += `╚════════════════════════╝\n\n`;
    menu += `💡 _Tidak hafal perintah? Ketik_ \`/menu\` _dan balas angka._\n\n`;

    menu += `┌─👤 *AKUN & SALDO*\n`;
    menu += `│ 📝 \`/daftar [email] [pass] [nama driver]\`\n`;
    menu += `│ 🔑 \`/login [email] [pass]\`\n`;
    menu += `│ 🚪 \`/logout\`\n`;
    menu += `│ 💰 \`/saldo\`\n`;
    menu += `│ 💳 \`/topup [nominal]\`\n`;
    menu += `│ 📜 \`/riwayat\`\n`;
    menu += `│ 🔗 \`/linkakun\` — _dashboard web_\n`;
    menu += `│ 🚚 \`/linkdriver [Nama]\` — _tautkan ke driver_\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─🚀 *ABSEN*\n`;
    menu += `│ 🤖 \`/absenmanual\` — _semua driver sekarang_\n`;
    menu += `│ 🚚 \`/absen [Nama]\` — _satu driver_\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─👥 *DATA DRIVER*\n`;
    menu += `│ ➕ \`/tambahdriver [Nama]#[ID]#[Usia]#[Reaksi]\`\n`;
    menu += `│ 📝 \`/editdriver [Nama]#[Kolom]#[Nilai]\`\n`;
    menu += `│ 📊 \`/listdriver\`\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─📁 *MEDIA & BERKAS*\n`;
    menu += `│ 📸 \`/updatefoto [Nama]\` _(+ lampirkan gambar)_\n`;
    menu += `│ 🍪 \`/updatecookie [Nama]\` _(+ lampirkan JSON)_\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─📅 *JADWAL LIBUR*\n`;
    menu += `│ 🏖️ \`/setlibur [Nama] [Hari]\`\n`;
    menu += `│ 🚛 \`/setmasuk [Nama]\` — _batalkan libur_\n`;
    menu += `│ 📊 \`/ceklibur\`\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─⚙️ *SISTEM*\n`;
    menu += `│ 🖥️ \`/status\` — _diagnostik server_\n`;
    menu += `│ 👁️ \`/getform\` — _link form aktif_\n`;
    menu += `│ 📋 \`/menu\` · ❓ \`/bantuan\`\n`;
    menu += `└─────────────────────────\n\n`;

    if (ctx.admin) {
        menu += `┌─🛡️ *ADMIN — USER & AKUN*\n`;
        menu += `│ 🎛️ \`/admin\` — _panel interaktif (tanpa ketik)_\n`;
        menu += `│ 📜 \`/adminhelp\` — _semua perintah admin_\n`;
        menu += `│ 👥 \`/listuser\`\n`;
        menu += `│ ✅ \`/aktifkan [email]\`\n`;
        menu += `│ 🚫 \`/nonaktifkan [email]\`\n`;
        menu += `│ 👑 \`/setadmin [email]\`\n`;
        menu += `│ 🔑 \`/adminreset [email] [pass]\`\n`;
        menu += `│ 🗑️ \`/hapusakun [email]\`\n`;
        menu += `│ 🔗 \`/linkdriveruser [email] [Nama]\`\n`;
        menu += `└─────────────────────────\n\n`;

        menu += `┌─💰 *ADMIN — SALDO*\n`;
        menu += `│ 💵 \`/adjust [email] [nominal]\` — _satu user_\n`;
        menu += `│ 👥 \`/adjustsemua [nominal]\` — _semua user_\n`;
        menu += `│ 🎯 \`/adjustsemua [nominal] 1,3\` — _pilih sebagian_\n`;
        menu += `│ 📊 \`/adjustsemua [nominal] 2-5\` — _rentang nomor_\n`;
        menu += `│ 🧾 \`/orderlist\` — _order top-up_\n`;
        menu += `└─────────────────────────\n\n`;

        menu += `┌─💾 *ADMIN — CADANGAN DATA*\n`;
        menu += `│ 📦 \`/backup\` — _buat & kirim ke WA_\n`;
        menu += `│ 📋 \`/listbackup\` — _arsip di VPS_\n`;
        menu += `│ ♻️ \`/restore\` _(+ lampirkan arsip)_\n`;
        menu += `└─────────────────────────\n\n`;

        menu += `┌─🚀 *ADMIN — OVERRIDE & SISTEM*\n`;
        menu += `│ 🚚 \`/absenkan [Nama|email]\`\n`;
        menu += `│ 🆓 \`/absenkan [Nama] gratis\`\n`;
        menu += `│ 👥 \`/absenkansemua\`\n`;
        menu += `│ 🗑️ \`/hapusdriver [Nama]\`\n`;
        menu += `│ 🔗 \`/setform [link]\` · \`/resetform\`\n`;
        menu += `│ 🆔 \`/idgrup\` · \`/listgrup\`\n`;
        menu += `│ 📊 \`/adminstat\`\n`;
        menu += `└─────────────────────────\n\n`;
    } else {
        menu += `🛡️ _Perintah admin disembunyikan._\n\n`;
    }

    menu += `🤖 System Autobot Powered By Ajiputra-tech\n`;
    menu += `💳 Pay-as-you-go: *${formatRupiah(config.pricePerAbsen)}*/absen`;

    return msg.reply(menu);
}

// ════════════════════════════════
//  PANDUAN SINGKAT (dipicu dari menu)
// ════════════════════════════════
//
// Perintah berparameter tidak bisa langsung dijalankan dari menu angka,
// jadi menu menampilkan contoh siap-salin daripada membiarkan user menebak
// formatnya lalu gagal.

async function _panduanTambahDriver(msg) {
    return msg.reply(
        `➕ *TAMBAH DRIVER BARU*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Kirim perintah berikut:\n\n` +
        `\`/tambahdriver Nama#ID#Usia#Reaksi\`\n\n` +
        `*Contoh:*\n\`/tambahdriver Budi Santoso#123456#30#280\`\n\n` +
        `📌 *Keterangan:*\n` +
        `• Nama   — nama lengkap driver\n` +
        `• ID     — ID registrasi (angka)\n` +
        `• Usia   — umur dalam tahun\n` +
        `• Reaksi — waktu reaksi (milidetik)\n\n` +
        `💡 Setelah ditambah, kirim juga foto (\`/updatefoto\`) dan cookie (\`/updatecookie\`).`
    );
}

async function _panduanEditDriver(msg) {
    return msg.reply(
        `📝 *EDIT DATA DRIVER*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Kirim perintah berikut:\n\n` +
        `\`/editdriver Nama#Kolom#Nilai\`\n\n` +
        `*Contoh:*\n` +
        `\`/editdriver Budi#reaksi#300\`\n` +
        `\`/editdriver Budi#usia#31\`\n\n` +
        `📌 *Kolom yang bisa diubah:*\n` +
        `\`nama\` · \`id\` · \`usia\` · \`reaksi\`\n\n` +
        `💡 Lihat data sekarang dengan \`/listdriver\`.`
    );
}

async function _panduanUpdateFoto(msg) {
    return msg.reply(
        `📸 *UPDATE FOTO REAKSI*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*Dua cara:*\n\n` +
        `1️⃣ Kirim gambar, lalu tulis di kolom keterangan:\n` +
        `   \`/updatefoto Budi\`\n\n` +
        `2️⃣ Balas (reply) gambar yang sudah ada di chat dengan:\n` +
        `   \`/updatefoto Budi\`\n\n` +
        `💡 Nama driver cukup nama depan — bot mencocokkan otomatis meski salah ketik sedikit.`
    );
}

async function _panduanUpdateCookie(msg) {
    return msg.reply(
        `🍪 *UPDATE COOKIE GOOGLE*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Kirim berkas \`.json\` cookie, lalu tulis di keterangan:\n\n` +
        `\`/updatecookie Budi\`\n\n` +
        `📌 *Cara ambil cookie:*\n` +
        `Pakai ekstensi *Cookie-Editor* di Chrome → buka Google Form → *Export* → *Export as JSON*.\n\n` +
        `⚠️ Cookie kedaluwarsa membuat absen gagal. Bot akan memperingatkan bila terdeteksi.`
    );
}

async function _mintaNamaDriver(msg) {
    pendingInput.set(_chatId(msg), { action: 'linkdriver', step: 'nama', data: {} });
    return msg.reply(
        `🚚 *TAUTKAN AKUN KE DRIVER*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Ketik nama driver yang akan ditautkan ke akun Anda:\n\n` +
        `_Contoh: Agung maulana_\n` +
        `_Lihat daftar dengan_ \`/listdriver\`\n\n` +
        `_(balas \`0\` untuk batal)_`
    );
}

async function _mintaNamaAbsen(msg) {
    pendingInput.set(_chatId(msg), { action: 'absen', step: 'nama', data: {} });
    return msg.reply(
        `🚚 *ABSEN DRIVER TERTENTU*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Ketik nama driver yang akan diabsenkan:\n\n` +
        `_Contoh: Agung_\n` +
        `_(balas \`0\` untuk batal)_`
    );
}

async function _mintaLibur(msg) {
    pendingInput.set(_chatId(msg), { action: 'setlibur', step: 'nama', data: {} });
    return msg.reply(
        `🏖️ *ATUR HARI LIBUR*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Ketik nama driver:\n\n` +
        `_Contoh: Agung_\n` +
        `_(balas \`0\` untuk batal)_`
    );
}

async function _mintaMasuk(msg) {
    pendingInput.set(_chatId(msg), { action: 'setmasuk', step: 'nama', data: {} });
    return msg.reply(
        `🚛 *BATALKAN LIBUR*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Ketik nama driver yang akan dikembalikan ke jadwal masuk:\n\n` +
        `_(balas \`0\` untuk batal)_`
    );
}

// ════════════════════════════════
//  INPUT BERTAHAP (Top-up, Login, Daftar)
// ════════════════════════════════

/**
 * Mulai alur top-up: tanya nominal dulu
 */
async function _startTopupInput(msg) {
    const chatId = _chatId(msg);
    pendingInput.set(chatId, { action: 'topup', step: 'nominal', data: {} });

    const teks =
        `💳 *TOP-UP SALDO*\n\n` +
        `Berapa nominal yang ingin diisi?\n\n` +
        `💰 Pilihan cepat:\n` +
        `- \`5000\` (Rp 5.000)\n` +
        `- \`15000\` (Rp 15.000)\n` +
        `- \`30000\` (Rp 30.000)\n` +
        `- \`50000\` (Rp 50.000)\n` +
        `- \`75000\` (Rp 75.000)\n` +
        `- \`100000\` (Rp 100.000)\n\n` +
        `Atau ketik nominal sendiri (angka saja).\n` +
        `Balas \`0\` untuk batal.`;

    return msg.reply(teks);
}

/**
 * Mulai alur login: tanya email & password
 */
async function _startLoginInput(msg) {
    const chatId = _chatId(msg);
    pendingInput.set(chatId, { action: 'login', step: 'email', data: {} });

    const teks =
        `🔑 *LOGIN AKUN*\n\n` +
        `Ketik email Anda:\n` +
        `_(balas \`0\` untuk batal)_`;

    return msg.reply(teks);
}

/**
 * Mulai alur daftar: tanya nama driver, email, password
 */
async function _startDaftarInput(msg) {
    const chatId = _chatId(msg);
    pendingInput.set(chatId, { action: 'daftar', step: 'nama', data: {} });

    const teks =
        `📝 *DAFTAR AKUN DRIVER*\n\n` +
        `Ketik *nama driver* Anda (sesuai yang terdaftar di database):\n\n` +
        `_Contoh: Agung maulana_\n` +
        `_Saldo akun ini hanya dipakai untuk absen driver tersebut._\n\n` +
        `_(balas \`0\` untuk batal)_`;

    return msg.reply(teks);
}

/**
 * Tangani input bertahap (topup/login/daftar/nama driver).
 * Dipanggil oleh router sebelum navigasi angka.
 * @returns {{ handled: boolean, command?: string }}
 */
async function handlePendingInput(client, msg, pesan) {
    const chatId = _chatId(msg);
    const pending = pendingInput.get(chatId);
    if (!pending) return { handled: false };

    const text = pesan.trim();

    // Batal jika ketik 0
    if (text === '0') {
        pendingInput.delete(chatId);
        await msg.reply(`❌ *DIBATALKAN*\nKembali ke menu utama. Ketik \`/menu\` untuk mulai lagi.`);
        return { handled: true, command: null };
    }

    if (pending.action === 'topup') {
        const amount = parseInt(text.replace(/[^\d]/g, ''), 10);
        if (isNaN(amount) || amount <= 0) {
            await msg.reply(`❌ Nominal tidak valid. Ketik angka saja, contoh: \`50000\`.\n_(balas \`0\` untuk batal)_`);
            return { handled: true, command: null };
        }
        pendingInput.delete(chatId);
        return { handled: true, command: `/topup ${amount}` };
    }

    // ── Perintah satu-langkah yang hanya butuh nama driver ──
    if (pending.action === 'linkdriver') {
        pendingInput.delete(chatId);
        return { handled: true, command: `/linkdriver ${text}` };
    }
    if (pending.action === 'absen') {
        pendingInput.delete(chatId);
        return { handled: true, command: `/absen ${text}` };
    }
    if (pending.action === 'setmasuk') {
        pendingInput.delete(chatId);
        return { handled: true, command: `/setmasuk ${text}` };
    }

    // ── Libur butuh nama + hari ──
    if (pending.action === 'setlibur') {
        if (pending.step === 'nama') {
            pending.data.nama = text;
            pending.step = 'hari';
            await msg.reply(
                `🗓️ Hari libur untuk *${text}*?\n\n` +
                `Pilihan: \`senin\` \`selasa\` \`rabu\` \`kamis\` \`jumat\` \`sabtu\` \`minggu\`\n` +
                `_(balas \`0\` untuk batal)_`
            );
            return { handled: true, command: null };
        }
        if (pending.step === 'hari') {
            pendingInput.delete(chatId);
            return { handled: true, command: `/setlibur ${pending.data.nama} ${text}` };
        }
    }

    if (pending.action === 'login') {
        if (pending.step === 'email') {
            if (!text.includes('@')) {
                await msg.reply(`❌ Format email tidak valid. Contoh: \`budi@gmail.com\`.\n_(balas \`0\` untuk batal)_`);
                return { handled: true, command: null };
            }
            pending.data.email = text;
            pending.step = 'password';
            await msg.reply(`🔑 Sekarang ketik password Anda:\n_(balas \`0\` untuk batal)_`);
            return { handled: true, command: null };
        }
        if (pending.step === 'password') {
            pending.data.password = text;
            pendingInput.delete(chatId);
            return { handled: true, command: `/login ${pending.data.email} ${pending.data.password}` };
        }
    }

    if (pending.action === 'daftar') {
        if (pending.step === 'nama') {
            pending.data.nama = text;
            pending.step = 'email';
            await msg.reply(`📧 Sekarang ketik email Anda:\n_(balas \`0\` untuk batal)_`);
            return { handled: true, command: null };
        }
        if (pending.step === 'email') {
            if (!text.includes('@')) {
                await msg.reply(`❌ Format email tidak valid. Contoh: \`budi@gmail.com\`.\n_(balas \`0\` untuk batal)_`);
                return { handled: true, command: null };
            }
            pending.data.email = text;
            pending.step = 'password';
            await msg.reply(`🔑 Terakhir, buat password (min. 6 karakter):\n_(balas \`0\` untuk batal)_`);
            return { handled: true, command: null };
        }
        if (pending.step === 'password') {
            pending.data.password = text;
            pendingInput.delete(chatId);
            return { handled: true, command: `/daftar ${pending.data.email} ${pending.data.password} ${pending.data.nama}` };
        }
    }

    pendingInput.delete(chatId);
    return { handled: false };
}

module.exports = { handleMenu, handleBantuan, handleNumberInput, handlePendingInput };
