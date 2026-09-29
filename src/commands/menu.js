// ══════════════════════════════════════════
// 📋 COMMAND: /menu & /bantuan
// ══════════════════════════════════════════
// Menu bernomor: user balas angka (1,2,3) untuk memilih.

// Simpan konteks menu aktif per chat (in-memory)
const menuState = new Map(); // chatId -> 'main' | 'akun' | 'absen' | 'lain'

// Simpan alur input bertahap (topup/login/daftar) per chat
const pendingInput = new Map(); // chatId -> { action, step, data }

/**
 * Tampilkan menu utama (bernomor)
 */
async function handleMenu(msg, pesan, client) {
    const chatId = msg.safeChatId || msg.from;
    menuState.set(chatId, 'main');

    const teks =
        `╔════════════════════════╗\n` +
        `  📊 *AUTOBOT COMMAND CENTER* 📊\n` +
        `╚════════════════════════╝\n\n` +
        `*Pilih menu (balas angkanya):*\n\n` +
        `1️⃣  💰 *Akun & Saldo*\n` +
        `2️⃣  🚀 *Absen & Driver*\n` +
        `3️⃣  ⚙️ *Lainnya & Admin*\n` +
        `4️⃣  ❓ *Bantuan*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Balas angka 1-4 untuk memilih._`;

    return msg.reply(teks);
}

/**
 * Submenu: Akun & Saldo
 */
async function _menuAkun(msg) {
    const chatId = msg.safeChatId || msg.from;
    menuState.set(chatId, 'akun');

    const teks =
        `💰 *AKUN & SALDO*\n\n` +
        `*Pilih aksi (balas angkanya):*\n\n` +
        `1️⃣  💵 Cek Saldo\n` +
        `2️⃣  ➕ Top-up Saldo\n` +
        `3️⃣  📜 Riwayat Transaksi\n` +
        `4️⃣  🔑 Login Akun\n` +
        `5️⃣  📝 Daftar Akun\n` +
        `0️⃣  ⬅ Kembali ke Menu Utama\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Balas angka untuk memilih._`;

    return msg.reply(teks);
}

/**
 * Submenu: Absen & Driver
 */
async function _menuAbsen(msg) {
    const chatId = msg.safeChatId || msg.from;
    menuState.set(chatId, 'absen');

    const teks =
        `🚀 *ABSEN & DRIVER*\n\n` +
        `*Pilih aksi (balas angkanya):*\n\n` +
        `1️⃣  🤖 Absen Semua Driver\n` +
        `2️⃣  📊 List Driver\n` +
        `3️⃣  ⚙️ Status Server\n` +
        `4️⃣  🗓️ Jadwal Libur\n` +
        `0️⃣  ⬅ Kembali ke Menu Utama\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Balas angka untuk memilih._`;

    return msg.reply(teks);
}

/**
 * Submenu: Lainnya & Admin
 */
async function _menuLain(msg) {
    const chatId = msg.safeChatId || msg.from;
    menuState.set(chatId, 'lain');

    const teks =
        `⚙️ *LAINNYA & ADMIN*\n\n` +
        `*Pilih aksi (balas angkanya):*\n\n` +
        `1️⃣  🔗 Link Dashboard Web\n` +
        `2️⃣  🛡️ Menu Admin\n` +
        `3️⃣  ❓ Bantuan\n` +
        `0️⃣  ⬅ Kembali ke Menu Utama\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_Balas angka untuk memilih._`;

    return msg.reply(teks);
}

/**
 * Tangani input angka untuk navigasi menu.
 * @returns {{ handled: boolean, command?: string }}
 */
async function handleNumberInput(client, msg, pesan) {
    const chatId = msg.safeChatId || msg.from;
    const state = menuState.get(chatId);
    const num = pesan.trim();

    if (!state) return { handled: false };
    if (!/^[0-9]{1,2}$/.test(num)) return { handled: false };

    switch (state) {
        case 'main':
            if (num === '1') { await _menuAkun(msg); return { handled: true, command: null }; }
            if (num === '2') { await _menuAbsen(msg); return { handled: true, command: null }; }
            if (num === '3') { await _menuLain(msg); return { handled: true, command: null }; }
            if (num === '4') { menuState.delete(chatId); return { handled: true, command: '/bantuan' }; }
            return { handled: false };

        case 'akun':
            if (num === '1') { menuState.delete(chatId); return { handled: true, command: '/saldo' }; }
            if (num === '2') { menuState.delete(chatId); await _startTopupInput(msg); return { handled: true, command: null }; }
            if (num === '3') { menuState.delete(chatId); return { handled: true, command: '/riwayat' }; }
            if (num === '4') { menuState.delete(chatId); await _startLoginInput(msg); return { handled: true, command: null }; }
            if (num === '5') { menuState.delete(chatId); await _startDaftarInput(msg); return { handled: true, command: null }; }
            if (num === '0') { await handleMenu(msg); return { handled: true, command: null }; }
            return { handled: false };

        case 'absen':
            if (num === '1') { menuState.delete(chatId); return { handled: true, command: '/absenmanual' }; }
            if (num === '2') { menuState.delete(chatId); return { handled: true, command: '/listdriver' }; }
            if (num === '3') { menuState.delete(chatId); return { handled: true, command: '/status' }; }
            if (num === '4') { menuState.delete(chatId); return { handled: true, command: '/ceklibur' }; }
            if (num === '0') { await handleMenu(msg); return { handled: true, command: null }; }
            return { handled: false };

        case 'lain':
            if (num === '1') { menuState.delete(chatId); return { handled: true, command: '/linkakun' }; }
            if (num === '2') { menuState.delete(chatId); return { handled: true, command: '/admin' }; }
            if (num === '3') { menuState.delete(chatId); return { handled: true, command: '/bantuan' }; }
            if (num === '0') { await handleMenu(msg); return { handled: true, command: null }; }
            return { handled: false };

        default:
            menuState.delete(chatId);
            return { handled: false };
    }
}

/**
 * Tampilkan daftar perintah lengkap (teks)
 */
async function handleBantuan(msg) {
    let menu = `╔════════════════════════╗\n`;
    menu += `  📊*AUTOBOT COMMAND CENTER*📊\n`;
    menu += `╚════════════════════════╝\n\n`;

    menu += `┌─⚡ *MANAJEMEN WORKER LOKAL*\n`;
    menu += `│ 👤 \`/tambahdriver [Nama]#[ID]#[Usia]#[Reaksi]\`\n`;
    menu += `│ 📝 \`/editdriver [Nama]#[Kolom]#[Nilai]\`\n`;
    menu += `│ 🗑️ \`/hapusdriver [Nama Depan]\`\n`;
    menu += `│ 📊 \`/listdriver\`\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─📁 *UPDATE MEDIA & DATA*\n`;
    menu += `│ 📸 \`/updatefoto [Nama]\` _(+ Gambar)_\n`;
    menu += `│ 🍪 \`/updatecookie [Nama]\` _(+ JSON)_\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─📅 *JADWAL OPERASIONAL*\n`;
    menu += `│ 🏖️ \`/setlibur [Nama] [Hari]\`\n`;
    menu += `│ 🚚 \`/setmasuk [Nama]\`\n`;
    menu += `│ 📊 \`/ceklibur\`\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─⚙️ *CONTROL SYSTEM ENGINE*\n`;
    menu += `│ 🚀 \`/absen [Nama]\`\n`;
    menu += `│ 🛑 \`/absenmanual\`\n`;
    menu += `│ 📊 \`/status\`\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─👤 *AKUN & SALDO*\n`;
    menu += `│ 📝 \`/daftar [email] [pass] [nama]\`\n`;
    menu += `│ 🔑 \`/login [email] [pass]\`\n`;
    menu += `│ 🚪 \`/logout\`\n`;
    menu += `│ 💰 \`/saldo\`\n`;
    menu += `│ 💳 \`/topup [nominal]\`\n`;
    menu += `│ 📜 \`/riwayat\`\n`;
    menu += `│ 🔗 \`/linkakun\`\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─🛡️ *ADMIN* _(khusus admin)_\n`;
    menu += `│ 🎛️ \`/admin\` — _panel interaktif (tanpa ketik)_\n`;
    menu += `│ 👥 \`/listuser\`\n`;
    menu += `│ ✅ \`/aktifkan [email]\`\n`;
    menu += `│ 🚫 \`/nonaktifkan [email]\`\n`;
    menu += `│ 💰 \`/adjust [email] [nominal]\`\n`;
    menu += `│ 🔗 \`/setform [link]\`\n`;
    menu += `│ 📊 \`/adminstat\`\n`;
    menu += `│ 🚚 \`/absenkan [Nama|email]\`\n`;
    menu += `│ 👥 \`/absenkansemua\`\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `🤖 System Autobot Powered By Ajiputra-tech\n`;
    menu += `💳 Pay-as-you-go: Rp ${require('../config').pricePerAbsen}/absen`;

    return msg.reply(menu);
}

// ════════════════════════════════
//  INPUT BERTAHAP (Top-up, Login, Daftar)
// ════════════════════════════════

/**
 * Mulai alur top-up: tanya nominal dulu
 */
async function _startTopupInput(msg) {
    const chatId = msg.safeChatId || msg.from;
    pendingInput.set(chatId, { action: 'topup', step: 'nominal', data: {} });

    const teks =
        `💳 *TOP-UP SALDO*\n\n` +
        `Berapa nominal yang ingin diisi?\n\n` +
        `💰 Pilihan cepat:\n` +
        `- \`10000\` (Rp 10.000)\n` +
        `- \`20000\` (Rp 20.000)\n` +
        `- \`50000\` (Rp 50.000)\n` +
        `- \`100000\` (Rp 100.000)\n\n` +
        `Atau ketik nominal sendiri (angka saja).\n` +
        `Balas \`0\` untuk batal.`;

    return msg.reply(teks);
}

/**
 * Mulai alur login: tanya email & password
 */
async function _startLoginInput(msg) {
    const chatId = msg.safeChatId || msg.from;
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
    const chatId = msg.safeChatId || msg.from;
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
 * Tangani input bertahap (topup/login/daftar).
 * Dipanggil oleh router sebelum navigasi angka.
 * @returns {{ handled: boolean, command?: string }} 
 */
async function handlePendingInput(client, msg, pesan) {
    const chatId = msg.safeChatId || msg.from;
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
