// ══════════════════════════════════════
// 🛡️ COMMAND ADMIN — Kelola user & saldo via WA
// ══════════════════════════════════════

const auth = require('../auth');
const wallet = require('../wallet');
const payment = require('../payment');
const settings = require('../settings');
const db = require('../database');
const { formatRupiah } = require('../utils/helpers');
const { getUserIdByWa, getSenderWa } = require('./akun');

/**
 * Cek apakah pengirim (msg) adalah admin.
 * Menerima msg object, otomatis ambil nomor HP asli pengirim.
 */
function isAdmin(msgOrWa) {
    const noWa = typeof msgOrWa === 'string' ? msgOrWa : getSenderWa(msgOrWa);
    const userId = getUserIdByWa(noWa);
    if (!userId) return false;
    const user = auth.findUserById(userId);
    return !!user && user.role === 'admin';
}

/**
 * /admin — menu admin (teks)
 */
async function handleAdminMenu(msg) {
    if (!isAdmin(msg.from)) {
        return msg.reply(`❌ *AKSES DITOLAK*\nPerintah ini khusus admin.`);
    }

    let teks = `🛡️ *MENU ADMIN*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👥 \`/listuser\` — Daftar semua user\n`;
    teks += `✅ \`/aktifkan [email]\` — Aktifkan akun\n`;
    teks += `🚫 \`/nonaktifkan [email]\` — Nonaktifkan akun\n`;
    teks += `👑 \`/setadmin [email]\` — Jadikan admin\n`;
    teks += `🔑 \`/adminreset [email] [pass]\` — Reset password\n`;
    teks += `💰 \`/adjust [email] [nominal]\` — Tambah/potong saldo\n`;
    teks += `🧾 \`/orderlist\` — Lihat order top-up\n`;
    teks += `📊 \`/adminstat\` — Statistik sistem\n`;
    teks += `🔗 \`/setform [link]\` — Ganti link Google Form\n`;
    teks += `👁️ \`/getform\` — Lihat link form aktif\n`;
    teks += `↩️ \`/resetform\` — Kembalikan ke link default (.env)\n`;
    teks += `🚚 \`/absenkan [Nama|email]\` — Absen manual atas nama driver\n`;
    teks += `🆓 \`/absenkan [Nama] gratis\` — Absen tanpa potong saldo\n`;
    teks += `👥 \`/absenkansemua\` — Absen semua driver (tanpa potong saldo)\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━`;
    return msg.reply(teks);
}

/**
 * /absenkan [Nama driver | email akun] [gratis]
 * Admin menjalankan absen atas nama driver mana pun (penanganan error/driver bermasalah).
 */
async function handleAbsenkan(msg, pesan, waClient) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*\nPerintah ini khusus admin.`);

    const args = pesan.split(' ').filter(Boolean).slice(1);
    if (!args.length) {
        return msg.reply(
            `Gunakan: \`/absenkan [Nama driver | email akun]\`\n\n` +
            `Contoh:\n` +
            `• \`/absenkan Agung\`\n` +
            `• \`/absenkan budi@gmail.com\`\n` +
            `• \`/absenkan Agung gratis\` — tanpa potong saldo`
        );
    }

    // Kata terakhir "gratis" = override tanpa potong saldo
    const skipCharge = args[args.length - 1].toLowerCase() === 'gratis';
    const targetRaw = (skipCharge ? args.slice(0, -1) : args).join(' ').trim();

    if (!targetRaw) return msg.reply(`❌ Nama driver / email tidak boleh kosong.`);

    // Terima input berupa email akun → konversi ke nama driver terkait
    let targetNama = targetRaw;
    if (targetRaw.includes('@') && !targetRaw.endsWith('.us')) {
        const user = auth.findUserByEmail(targetRaw);
        if (!user) return msg.reply(`❌ Akun *${targetRaw}* tidak ditemukan.`);
        if (!user.driverNama) {
            return msg.reply(`❌ Akun *${user.nama}* belum tertaut ke driver mana pun.\nGunakan \`/linkdriver\` terlebih dahulu.`);
        }
        targetNama = user.driverNama;
    }

    const { driver } = db.findDriver(targetNama);
    if (!driver) return msg.reply(`❌ Driver *${targetNama}* tidak terdaftar dalam database.`);

    await msg.reply(
        `🛡️ *ADMIN OVERRIDE ABSEN*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🚚 Driver : *${driver.nama}*\n` +
        `💳 Saldo  : ${skipCharge ? '🆓 Tidak dipotong' : 'Dipotong normal'}\n\n` +
        `⚡ Memulai proses...`
    );

    const { prosesAbsenMassal } = require('../services/form-filler');
    await prosesAbsenMassal(waClient, driver.nama.toLowerCase(), msg, { skipCharge });
}

/**
 * /absenkansemua — admin absenkan semua driver tanpa potong saldo
 */
async function handleAbsenkanSemua(msg, pesan, waClient) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*\nPerintah ini khusus admin.`);

    await msg.reply(
        `🛡️ *ADMIN OVERRIDE — ABSEN SEMUA DRIVER*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💳 Saldo: 🆓 Tidak dipotong\n\n⚡ Memulai proses...`
    );

    const { prosesAbsenMassal } = require('../services/form-filler');
    await prosesAbsenMassal(waClient, null, msg, { skipCharge: true });
}

/**
 * /listuser — daftar user
 */
async function handleListUser(msg) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);

    const users = auth.listUsers();
    if (!users.length) return msg.reply(`📋 Belum ada user.`);

    let teks = `👥 *DAFTAR USER*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    users.forEach((u, i) => {
        const status = u.isActive !== false ? '🟢 Aktif' : '🔴 Nonaktif';
        const role = u.role === 'admin' ? '👑 Admin' : '👤 Driver';
        teks += `${i + 1}. *${u.nama}* (${role})\n`;
        teks += `   📧 ${u.email}\n`;
        teks += `   💰 ${formatRupiah(wallet.getBalance(u.id))} | ${status}\n\n`;
    });
    teks += `━━━━━━━━━━━━━━━━━━━━━━`;
    return msg.reply(teks);
}

/**
 * /aktifkan [email] — aktifkan user
 */
async function handleAktifkan(msg, pesan) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const email = pesan.split(' ').slice(1).join(' ').trim();
    if (!email) return msg.reply(`Gunakan: \`/aktifkan [email]\``);

    const user = auth.findUserByEmail(email);
    if (!user) return msg.reply(`❌ User *${email}* tidak ditemukan.`);

    const r = auth.setActive(user.id, true);
    return msg.reply(r.success ? `✅ Akun *${user.nama}* telah DIAKTIFKAN.` : `❌ ${r.error}`);
}

/**
 * /nonaktifkan [email] — nonaktifkan user
 */
async function handleNonaktifkan(msg, pesan) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const email = pesan.split(' ').slice(1).join(' ').trim();
    if (!email) return msg.reply(`Gunakan: \`/nonaktifkan [email]\``);

    const user = auth.findUserByEmail(email);
    if (!user) return msg.reply(`❌ User *${email}* tidak ditemukan.`);

    if (user.role === 'admin') {
        return msg.reply(`⚠️ Tidak bisa menonaktifkan akun admin.`);
    }

    const r = auth.setActive(user.id, false);
    return msg.reply(r.success ? `🚫 Akun *${user.nama}* telah DINONAKTIFKAN.` : `❌ ${r.error}`);
}

/**
 * /setadmin [email] — jadikan admin
 */
async function handleSetAdmin(msg, pesan) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const email = pesan.split(' ').slice(1).join(' ').trim();
    if (!email) return msg.reply(`Gunakan: \`/setadmin [email]\``);

    const user = auth.findUserByEmail(email);
    if (!user) return msg.reply(`❌ User *${email}* tidak ditemukan.`);

    const r = auth.setRole(user.id, 'admin');
    return msg.reply(r.success ? `👑 User *${user.nama}* sekarang jadi ADMIN.` : `❌ ${r.error}`);
}

/**
 * /adminreset [email] [password] — reset password user
 */
async function handleAdminReset(msg, pesan) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const args = pesan.split(' ').filter(Boolean);
    if (args.length < 3) return msg.reply(`Gunakan: \`/adminreset [email] [passwordBaru]\``);

    const email = args[1];
    const pw = args[2];

    const user = auth.findUserByEmail(email);
    if (!user) return msg.reply(`❌ User *${email}* tidak ditemukan.`);

    const r = auth.adminResetPassword(user.id, pw);
    return msg.reply(r.success ? `🔑 Password *${user.nama}* berhasil direset.` : `❌ ${r.error}`);
}

/**
 * /adjust [email] [nominal] — tambah/potong saldo
 */
async function handleAdjust(msg, pesan) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const args = pesan.split(' ').filter(Boolean);
    if (args.length < 3) return msg.reply(`Gunakan: \`/adjust [email] [nominal]\`\nContoh: \`/adjust budi@gmail.com 50000\` atau \`/adjust budi@gmail.com -10000\``);

    const email = args[1];
    const amount = Number(args[2]);

    if (isNaN(amount) || amount === 0) return msg.reply(`❌ Nominal tidak valid.`);

    const user = auth.findUserByEmail(email);
    if (!user) return msg.reply(`❌ User *${email}* tidak ditemukan.`);

    const r = wallet.mutateBalance(user.id, amount, amount > 0 ? 'ADJUST' : 'ADJUST', 'Penyesuaian admin', { admin: msg.from });
    if (!r.success) return msg.reply(`❌ ${r.error}`);

    return msg.reply(`💰 Saldo *${user.nama}* ${amount >= 0 ? 'ditambah' : 'dipotong'} ${formatRupiah(Math.abs(amount))}.\nSaldo sekarang: *${formatRupiah(r.balance)}*`);
}

/**
 * /orderlist — lihat order top-up
 */
async function handleOrderList(msg) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);

    const orders = payment.listOrders(15);
    if (!orders.length) return msg.reply(`🧾 Belum ada order.`);

    let teks = `🧾 *ORDER TOP-UP TERBARU*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    orders.forEach((o, i) => {
        const u = auth.findUserById(o.userId);
        const st = { PENDING: '🟡', PAID: '🟢', EXPIRED: '🔴', CANCELLED: '⚫' }[o.status] || '⚪';
        teks += `${i + 1}. ${st} ${formatRupiah(o.total)} — ${u?.nama || o.userId}\n`;
        teks += `   (${o.status})\n`;
    });
    teks += `━━━━━━━━━━━━━━━━━━━━━━`;
    return msg.reply(teks);
}

/**
 * /adminstat — statistik sistem
 */
async function handleAdminStat(msg) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);

    const users = auth.listUsers();
    const w = wallet.summary();
    const orders = payment.listOrders(500);

    let teks = `📊 *STATISTIK SISTEM*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👥 User         : ${users.length}\n`;
    teks += `🟢 Aktif        : ${users.filter(u => u.isActive !== false).length}\n`;
    teks += `🔴 Nonaktif     : ${users.filter(u => u.isActive === false).length}\n`;
    teks += `💰 Total Saldo  : ${formatRupiah(w.totalBalance)}\n`;
    teks += `📈 Total Top-up : ${formatRupiah(w.totalTopup)}\n`;
    teks += `🧾 Order Pending: ${orders.filter(o => o.status === 'PENDING').length}\n`;
    teks += `✅ Order Sukses : ${orders.filter(o => o.status === 'PAID').length}\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━`;
    return msg.reply(teks);
}

/**
 * /setform [link] — ganti link Google Form
 */
async function handleSetForm(msg, pesan) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const url = pesan.split(' ').slice(1).join(' ').trim();
    if (!url) {
        return msg.reply(
            `Gunakan: \`/setform [link Google Form]\`\n\nContoh:\n\`/setform https://docs.google.com/forms/d/e/xxx/viewform\``
        );
    }

    const r = settings.setFormUrl(url);
    if (!r.success) return msg.reply(`❌ ${r.error}`);

    return msg.reply(
        `✅ *LINK FORM DIPERBARUI*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔗 Link baru: ${r.url}\n\n` +
        `⚡ Berlaku langsung untuk proses absen berikutnya (tanpa restart).`
    );
}

/**
 * /getform — lihat link form aktif
 */
async function handleGetForm(msg) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);
    return msg.reply(
        `🔗 *LINK FORM AKTIF*\n━━━━━━━━━━━━━━━━━━━━━━\n${settings.getFormUrl()}`
    );
}

/**
 * /resetform — kembalikan ke link default (.env)
 */
async function handleResetForm(msg) {
    if (!isAdmin(msg.from)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const r = settings.resetFormUrl();
    return msg.reply(
        `↩️ *LINK DIKEMBALIKAN KE DEFAULT*\n━━━━━━━━━━━━━━━━━━━━━━\n${r.url}`
    );
}

module.exports = {
    handleAdminMenu,
    handleListUser,
    handleAktifkan,
    handleNonaktifkan,
    handleSetAdmin,
    handleAdminReset,
    handleAdjust,
    handleOrderList,
    handleAdminStat,
    handleSetForm,
    handleGetForm,
    handleResetForm,
    handleAbsenkan,
    handleAbsenkanSemua,
    isAdmin,
};
