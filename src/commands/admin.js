// ══════════════════════════════════════
// 🛡️ COMMAND ADMIN — Kelola user & saldo via WA
// ══════════════════════════════════════

const auth = require('../auth');
const wallet = require('../wallet');
const payment = require('../payment');
const settings = require('../settings');
const db = require('../database');
const config = require('../config');
const { formatRupiah, withTimeout } = require('../utils/helpers');
const { getUserIdByWa, getSenderWa } = require('./akun');
const { kartu, kode, tebal, miring, cabang, rupiahBertanda } = require('../utils/tampilan');
const logger = require('../utils/logger');

/**
 * Cek apakah pengirim (msg) adalah admin.
 *
 * Selalu oper msg object, jangan msg.from: di dalam grup msg.from berisi ID
 * grup (@g.us), bukan nomor pengirim, sehingga sesi login admin tidak
 * ditemukan dan admin asli ikut ditolak. getSenderWa() yang menangani ini.
 */
function isAdmin(msgOrWa) {
    let noWa;
    if (typeof msgOrWa === 'string') {
        // ID grup bukan identitas orang — tolak daripada memeriksa hal yang salah.
        if (msgOrWa.endsWith('@g.us')) return false;
        noWa = msgOrWa;
    } else {
        noWa = getSenderWa(msgOrWa);
    }

    const userId = getUserIdByWa(noWa);
    if (!userId) return false;
    const user = auth.findUserById(userId);
    return !!user && user.role === 'admin' && user.isActive !== false;
}

/**
 * /admin — menu admin (teks)
 */
async function handleAdminMenu(msg) {
    if (!isAdmin(msg)) {
        return msg.reply(`❌ *AKSES DITOLAK*\nPerintah ini khusus admin.`);
    }

    let teks = `🛡️ *PERINTAH ADMIN LENGKAP*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `💡 _Panel interaktif lebih mudah: ketik_ \`/admin\`\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    teks += `👥 *USER & AKUN*\n`;
    teks += `• \`/listuser\` — Daftar semua user\n`;
    teks += `• \`/aktifkan [email]\` — Aktifkan akun\n`;
    teks += `• \`/nonaktifkan [email]\` — Nonaktifkan akun\n`;
    teks += `• \`/setadmin [email]\` — Jadikan admin\n`;
    teks += `• \`/adminreset [email] [pass]\` — Reset password\n`;
    teks += `• \`/hapusakun [email]\` — Hapus akun permanen\n`;
    teks += `• \`/linkdriveruser [email] [Nama]\` — Tautkan ke driver\n\n`;

    teks += `💰 *SALDO*\n`;
    teks += `• \`/adjust [email] [nominal]\` — Satu user\n`;
    teks += `• \`/adjustsemua [nominal]\` — Semua user sekaligus\n`;
    teks += `• \`/adjustsemua [nominal] 1,3\` — Pilih sebagian\n`;
    teks += `• \`/adjustsemua [nominal] 2-5\` — Rentang nomor\n`;
    teks += `• \`/orderlist\` — Lihat order top-up\n\n`;

    teks += `🚀 *ABSEN OVERRIDE*\n`;
    teks += `• \`/absenkan [Nama|email]\` — Atas nama driver\n`;
    teks += `• \`/absenkan [Nama] gratis\` — Tanpa potong saldo\n`;
    teks += `• \`/absenkansemua\` — Semua driver (gratis)\n\n`;

    teks += `🚚 *DRIVER*\n`;
    teks += `• \`/hapusdriver [Nama]\` — Hapus + cookie & foto\n`;
    teks += `• \`/listdriver\` — Daftar & kesiapan berkas\n\n`;

    teks += `💾 *CADANGAN DATA*\n`;
    teks += `• \`/backup\` — Cadangkan & kirim ke WA\n`;
    teks += `• \`/listbackup\` — Daftar cadangan di VPS\n`;
    teks += `• \`/restore\` — Pulihkan (lampirkan berkas)\n\n`;

    teks += `⚙️ *FORM & SISTEM*\n`;
    teks += `• \`/setform [link]\` — Ganti link Google Form\n`;
    teks += `• \`/getform\` — Lihat link form aktif\n`;
    teks += `• \`/resetform\` — Kembalikan ke default (.env)\n`;
    teks += `• \`/adminstat\` — Statistik sistem\n`;
    teks += `• \`/idgrup\` — ID chat ini & cek tujuan laporan\n`;
    teks += `• \`/listgrup\` — Daftar semua grup + ID-nya\n`;
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
        kartu({
            judul: `🛡️ *ADMIN OVERRIDE ABSEN*`,
            isi: [
                `🚚 Driver: ${tebal(driver.nama)}`,
                cabang([
                    `💳 Saldo: ${skipCharge ? '🆓 tidak dipotong' : `dipotong ${formatRupiah(config.pricePerAbsen)}`}`,
                    `🔑 Cookie: ${db.isCookieReady(driver) ? 'siap' : '⚠️ belum ada'}`,
                    `🖼️ Foto: ${db.isScreenshotReady(driver) ? 'siap' : '⚠️ belum ada'}`,
                ]),
            ],
            kaki: [`⚡ ${miring('Memulai proses, laporan dikirim setelah selesai...')}`],
        })
    );

    const { prosesAbsenMassal } = require('../services/form-filler');
    await prosesAbsenMassal(waClient, driver.nama.toLowerCase(), msg, { skipCharge });
}

/**
 * /linkdriveruser [email] [Nama Driver] — admin menautkan akun user lain ke driver
 */
async function handleLinkDriverUser(msg, pesan) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*\nPerintah ini khusus admin.`);

    const args = pesan.split(' ').filter(Boolean).slice(1);
    if (args.length < 2) {
        return msg.reply(`Gunakan: \`/linkdriveruser [email] [Nama Driver]\`\nContoh: \`/linkdriveruser budi@gmail.com Agung maulana\``);
    }

    const email = args[0];
    const namaDriver = args.slice(1).join(' ');

    const user = auth.findUserByEmail(email);
    if (!user) return msg.reply(`❌ User *${email}* tidak ditemukan.`);

    const { driver } = db.findDriver(namaDriver);
    if (!driver) return msg.reply(`❌ Driver *${namaDriver}* tidak terdaftar.`);

    const r = auth.updateUser(user.id, { driverNama: driver.nama });
    if (!r.success) return msg.reply(`❌ ${r.error}`);

    return msg.reply(
        kartu({
            judul: `✅ *AKUN DITAUTKAN*`,
            isi: [
                `👤 ${tebal(r.user.nama)}`,
                cabang([
                    `📧 ${email}`,
                    `🚚 Driver: ${tebal(r.user.driverNama)}`,
                    `💰 Saldo: ${formatRupiah(wallet.getBalance(r.user.id))}`,
                ]),
            ],
            kaki: [`📌 ${miring('Absen otomatis driver ini akan memotong saldo akun tersebut.')}`],
        })
    );
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
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);

    const users = auth.listUsers();
    if (!users.length) return msg.reply(`📋 Belum ada user.`);

    const isi = [];
    let totalSaldo = 0;

    users.forEach((u, i) => {
        const aktif = u.isActive !== false;
        const saldo = wallet.getBalance(u.id);
        totalSaldo += saldo;

        if (i > 0) isi.push(``);
        isi.push(`${aktif ? '🟢' : '🔴'} ${i + 1}. ${tebal(u.nama)}${u.role === 'admin' ? ' 🛡️' : ''}`);
        isi.push(cabang([
            `📧 ${u.email}`,
            u.driverNama ? `🚚 Driver: ${u.driverNama}` : `⚠️ Belum tertaut driver`,
            `💰 Saldo: ${formatRupiah(saldo)}  ·  ${aktif ? 'aktif' : 'nonaktif'}`,
        ]));
    });

    const nonaktif = users.filter((u) => u.isActive === false).length;
    const tanpaDriver = users.filter((u) => !u.driverNama).length;

    const kaki = [
        `👥 Total: ${tebal(`${users.length} akun`)}  ·  💰 ${tebal(formatRupiah(totalSaldo))}`,
    ];
    if (nonaktif) kaki.push(`🔴 Nonaktif: ${nonaktif} akun`);
    if (tanpaDriver) kaki.push(`⚠️ ${tanpaDriver} akun belum tertaut driver`);
    kaki.push(`💡 ${kode('/adjust [email] [nominal]')} ubah saldo`);

    return msg.reply(kartu({ judul: `👥 *DAFTAR USER*`, isi, kaki }));
}

/**
 * /aktifkan [email] — aktifkan user
 */
async function handleAktifkan(msg, pesan) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);
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
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);
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
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);
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
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);
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
async function handleAdjust(msg, pesan, waClient = null) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const args = pesan.split(' ').filter(Boolean);
    if (args.length < 3) {
        return msg.reply(
            kartu({
                judul: `💰 *UBAH SALDO AKUN*`,
                isi: [
                    `Gunakan: ${kode('/adjust [email] [nominal]')}`,
                    ``,
                    `➕ Tambah: ${kode('/adjust budi@gmail.com 50000')}`,
                    `➖ Potong: ${kode('/adjust budi@gmail.com -10000')}`,
                ],
                kaki: [
                    `💡 ${kode('/listuser')} lihat email akun`,
                    `💡 ${kode('/adjustsemua')} ubah saldo banyak akun`,
                ],
            })
        );
    }

    const email = args[1];
    const amount = Number(args[2]);

    if (isNaN(amount) || amount === 0) return msg.reply(`❌ Nominal tidak valid.`);

    const user = auth.findUserByEmail(email);
    if (!user) return msg.reply(`❌ User *${email}* tidak ditemukan.`);

    const r = wallet.mutateBalance(user.id, amount, amount > 0 ? 'ADJUST' : 'ADJUST', 'Penyesuaian admin', { admin: msg.from });
    if (!r.success) return msg.reply(`❌ ${r.error}`);

    const harga = Number(config.pricePerAbsen) || 0;
    const sisaAbsen = harga > 0 ? Math.floor(r.balance / harga) : null;

    // Pemilik akun diberi tahu agar tidak bingung saldonya berubah sendiri,
    // sama seperti perilaku /adjustsemua.
    let diberitahu = false;
    if (waClient) {
        const { getWaNumbersByUserId } = require('./akun');
        for (const wa of getWaNumbersByUserId(user.id)) {
            try {
                await waClient.sendMessage(wa, kartu({
                    judul: amount > 0 ? `💰 *SALDO DITAMBAHKAN*` : `➖ *SALDO DISESUAIKAN*`,
                    isi: [
                        `${amount > 0 ? '➕' : '➖'} Perubahan: ${tebal(rupiahBertanda(amount))}`,
                        `💰 Saldo kini: ${tebal(formatRupiah(r.balance))}`,
                    ],
                    kaki: [`📌 ${miring('Disesuaikan oleh admin.')}`],
                }));
                diberitahu = true;
            } catch (e) {
                logger.debug('ADMIN', `Notifikasi saldo ke ${wa} gagal: ${e.message}`);
            }
        }
    }

    return msg.reply(
        kartu({
            judul: amount > 0 ? `➕ *SALDO DITAMBAHKAN*` : `➖ *SALDO DIPOTONG*`,
            isi: [
                `👤 ${tebal(user.nama)}`,
                cabang([
                    `📧 ${user.email}`,
                    `${amount > 0 ? '➕' : '➖'} Perubahan: ${tebal(rupiahBertanda(amount))}`,
                    `💰 Saldo kini: ${tebal(formatRupiah(r.balance))}`,
                ]),
            ],
            kaki: [
                sisaAbsen === null
                    ? `🆓 ${miring('Tarif absen sedang Rp 0.')}`
                    : `🎟️ Cukup untuk ${tebal(`${sisaAbsen}x absen`)} @ ${formatRupiah(harga)}`,
                diberitahu
                    ? `📩 ${miring('Pemilik akun sudah diberi tahu.')}`
                    : `📭 ${miring('Pemilik akun belum login WA, tidak ada notifikasi.')}`,
            ],
        })
    );
}

/**
 * /orderlist — lihat order top-up
 */
async function handleOrderList(msg) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);

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
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);

    const users = auth.listUsers();
    const w = wallet.summary();
    const orders = payment.listOrders(500);

    const drivers = db.getAllDrivers();
    const belumSiap = drivers.filter((d) => !db.isCookieReady(d) || !db.isScreenshotReady(d));
    const pending = orders.filter((o) => o.status === 'PENDING').length;
    const sukses = orders.filter((o) => o.status === 'PAID').length;

    const harga = Number(config.pricePerAbsen) || 0;
    const sisaAbsen = harga > 0 ? Math.floor(w.totalBalance / harga) : null;

    return msg.reply(
        kartu({
            judul: `📊 *STATISTIK SISTEM*`,
            isi: [
                `👥 *Akun*`,
                cabang([
                    `Total: ${tebal(users.length)}`,
                    `Aktif: ${users.filter((u) => u.isActive !== false).length}  ·  Nonaktif: ${users.filter((u) => u.isActive === false).length}`,
                ]),
                ``,
                `🚚 *Driver*`,
                cabang([
                    `Terdaftar: ${tebal(drivers.length)}`,
                    belumSiap.length
                        ? `Belum lengkap: ${belumSiap.length} (${belumSiap.map((d) => d.nama).join(', ')})`
                        : `Semua berkas lengkap ✅`,
                ]),
                ``,
                `💰 *Keuangan*`,
                cabang([
                    `Total saldo: ${tebal(formatRupiah(w.totalBalance))}`,
                    sisaAbsen === null
                        ? `Tarif absen: gratis (Rp 0)`
                        : `Setara ${tebal(`${sisaAbsen}x absen`)} @ ${formatRupiah(harga)}`,
                    `Total top-up: ${formatRupiah(w.totalTopup)}`,
                ]),
                ``,
                `🧾 *Order Top-up*`,
                cabang([
                    `Sukses: ${sukses}  ·  Pending: ${pending}`,
                ]),
            ],
            kaki: [
                pending ? `⏳ ${miring(`${pending} order menunggu pembayaran.`)}` : null,
                `💡 ${kode('/listuser')} detail akun  ·  ${kode('/listdriver')} detail driver`,
            ].filter(Boolean),
        })
    );
}

/**
 * /setform [link] — ganti link Google Form
 */
async function handleSetForm(msg, pesan) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);
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
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);
    return msg.reply(
        `🔗 *LINK FORM AKTIF*\n━━━━━━━━━━━━━━━━━━━━━━\n${settings.getFormUrl()}`
    );
}

/**
 * /resetform — kembalikan ke link default (.env)
 */
async function handleResetForm(msg) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);
    const r = settings.resetFormUrl();
    return msg.reply(
        `↩️ *LINK DIKEMBALIKAN KE DEFAULT*\n━━━━━━━━━━━━━━━━━━━━━━\n${r.url}`
    );
}

/**
 * /idgrup — tampilkan ID chat ini & bandingkan dengan WA_GRUP aktif
 */
async function handleIdGrup(msg) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);

    const idChat = msg.safeChatId || msg.from || '-';
    const isGrup = String(idChat).endsWith('@g.us');
    const cocok = idChat === config.waGrup;

    let teks = `🆔 *ID CHAT INI*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `\`\`\`${idChat}\`\`\`\n`;
    teks += `Tipe : ${isGrup ? 'Grup 👥' : 'Chat pribadi 👤'}\n\n`;
    teks += `📨 *WA_GRUP aktif (tujuan laporan)*\n\`\`\`${config.waGrup || '(belum diatur)'}\`\`\`\n\n`;

    if (!isGrup) {
        teks += `ℹ️ Kirim \`/idgrup\` di DALAM grup laporan untuk mendapatkan ID grupnya.`;
    } else if (cocok) {
        teks += `✅ *SUDAH COCOK.* Rekap absen akan dikirim ke grup ini.`;
    } else {
        teks += `⚠️ *BELUM COCOK!* Rekap absen TIDAK dikirim ke grup ini.\n\n`;
        teks += `Perbaiki di VPS:\n`;
        teks += `1. \`nano .env\`\n`;
        teks += `2. Ubah jadi: \`WA_GRUP=${idChat}\`\n`;
        teks += `3. \`pm2 restart auto-petrip-bot --update-env\``;
    }
    return msg.reply(teks);
}

/**
 * /listgrup — daftar semua grup yang diikuti bot beserta ID-nya
 */
async function handleListGrup(msg, pesan, waClient) {
    if (!isAdmin(msg)) return msg.reply(`❌ *AKSES DITOLAK*`);

    let chats;
    try {
        chats = await withTimeout(waClient.getChats(), 30000, 'getChats');
    } catch (e) {
        return msg.reply(`❌ Gagal mengambil daftar chat: _${e.message}_`);
    }

    const grup = (chats || []).filter(c => c.id && String(c.id._serialized || '').endsWith('@g.us'));
    if (grup.length === 0) {
        return msg.reply(`📭 Bot belum tergabung di grup mana pun.`);
    }

    let teks = `👥 *DAFTAR GRUP (${grup.length})*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    grup.forEach((c, i) => {
        const id = c.id._serialized;
        const aktif = id === config.waGrup ? ' ✅ *(tujuan laporan)*' : '';
        teks += `\n${i + 1}. *${c.name || '(tanpa nama)'}*${aktif}\n\`\`\`${id}\`\`\`\n`;
    });
    teks += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `Salin ID grup yang diinginkan ke \`WA_GRUP\` di file .env, lalu restart bot.`;
    return msg.reply(teks);
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
    handleIdGrup,
    handleListGrup,
    handleAbsenkan,
    handleAbsenkanSemua,
    handleLinkDriverUser,
    isAdmin,
};
