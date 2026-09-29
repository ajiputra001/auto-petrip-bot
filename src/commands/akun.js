// ══════════════════════════════════════
// 💳 COMMAND: /daftar, /login, /saldo, /topup, /riwayat
// ══════════════════════════════════════

const config = require('../config');
const auth = require('../auth');
const wallet = require('../wallet');
const payment = require('../payment');
const { formatRupiah, delay } = require('../utils/helpers');
const { MessageMedia } = require('whatsapp-web.js');
const logger = require('../utils/logger');

/**
 * Menyimpan sesi login WA → userId (in-memory + persisten)
 * Format file: { [noWa]: userId }
 */
const path = require('path');
const fs = require('fs');
const { bacaJSON, tulisJSON, ensureDir } = require('../utils/helpers');

function _sessionFile() {
    return path.join(config.dataDir, 'database_session.json');
}

function _readSessions() {
    ensureDir(config.dataDir);
    return bacaJSON(_sessionFile()) || {};
}

function _writeSessions(sessions) {
    tulisJSON(_sessionFile(), sessions);
}

/**
 * Ambil userId dari nomor WA yang sudah login
 */
function getUserIdByWa(noWa) {
    const sessions = _readSessions();
    return sessions[noWa] || null;
}

/**
 * Ambil identitas pengirim ASLI (nomor HP), bukan ID grup.
 * Di grup, msg.from = ID grup (@g.us), msg.author = nomor HP pengirim (@c.us).
 * Di chat pribadi, msg.from = nomor HP.
 * @param {Object} msg - Message object
 * @returns {string} Nomor HP pengirim (misal "6285...@c.us")
 */
function getSenderWa(msg) {
    if (msg.author && msg.author.endsWith('@c.us')) return msg.author;
    if (msg.from && msg.from.endsWith('@c.us')) return msg.from;
    // Fallback: kembalikan apa pun yang ada
    return msg.author || msg.from || '';
}

/**
 * Login user via WA (simpan sesi)
 */
function setWaSession(noWa, userId) {
    const sessions = _readSessions();
    sessions[noWa] = userId;
    _writeSessions(sessions);
}

function clearWaSession(noWa) {
    const sessions = _readSessions();
    delete sessions[noWa];
    _writeSessions(sessions);
}

/**
 * /daftar [email] [password] [nama driver]
 * Registrasi akun baru via WhatsApp — terikat ke satu nama driver
 */
async function handleDaftar(msg, pesan) {
    const args = pesan.split(' ').filter(Boolean);
    // Format: /daftar email password nama driver...
    if (args.length < 3) {
        return msg.reply(
            `❌ *FORMAT SALAH*\n\n` +
            `Gunakan:\n\`/daftar [email] [password] [nama driver]\`\n\n` +
            `Contoh:\n\`/daftar budi@gmail.com rahasia123 Agung maulana\`\n\n` +
            `_Nama driver harus sesuai yang terdaftar di database._`
        );
    }

    const email = args[1];
    const password = args[2];
    const nama = args.slice(3).join(' ');

    // Validasi nama driver terdaftar di database
    const db = require('../database');
    const { driver } = db.findDriver(nama);
    if (!driver) {
        return msg.reply(
            `❌ *NAMA DRIVER TIDAK DITEMUKAN*\n\n` +
            `Driver *"${nama}"* tidak ada di database.\n\n` +
            `Cek daftar driver dengan \`/listdriver\`,\n` +
            `lalu daftar ulang dengan nama yang benar.`
        );
    }

    const result = auth.registerUser({
        email,
        password,
        nama: nama || email.split('@')[0],
        noWa: getSenderWa(msg),
        driverNama: driver.nama, // pakai nama resmi driver dari database
    });

    if (!result.success) {
        return msg.reply(`❌ *GAGAL DAFTAR*\n\n${result.error}`);
    }

    // Auto login setelah daftar
    setWaSession(getSenderWa(msg), result.user.id);

    let teks = `✅ *AKUN BERHASIL DIBUAT*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Nama  : *${result.user.nama}*\n`;
    teks += `🚚 Driver: *${result.user.driverNama}*\n`;
    teks += `📧 Email : ${result.user.email}\n`;
    teks += `💰 Saldo : ${formatRupiah(wallet.getBalance(result.user.id))}\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `🔓 Anda sudah otomatis login.\n`;
    teks += `💡 Ketik \`/topup\` untuk isi saldo.\n`;
    teks += `💡 Ketik \`/saldo\` untuk cek saldo.`;

    return msg.reply(teks);
}

/**
 * /login [email] [password]
 */
async function handleLogin(msg, pesan) {
    const args = pesan.split(' ').filter(Boolean);
    if (args.length < 3) {
        return msg.reply(
            `❌ *FORMAT SALAH*\n\nGunakan:\n\`/login [email] [password]\``
        );
    }

    const email = args[1];
    const password = args[2];

    const result = auth.loginUser(email, password);
    if (!result.success) {
        return msg.reply(`❌ *LOGIN GAGAL*\n\n${result.error}`);
    }

    setWaSession(getSenderWa(msg), result.user.id);

    let teks = `✅ *LOGIN BERHASIL*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Halo *${result.user.nama}*!\n`;
    teks += `💰 Saldo : ${formatRupiah(wallet.getBalance(result.user.id))}\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `💡 \`/saldo\` cek saldo | \`/topup\` isi saldo`;

    return msg.reply(teks);
}

/**
 * /logout
 */
async function handleLogout(msg) {
    clearWaSession(getSenderWa(msg));
    return msg.reply(`👋 *LOGOUT BERHASIL*\nAnda telah keluar dari akun. Ketik \`/login\` untuk masuk kembali.`);
}

/**
 * /saldo — cek saldo akun yang sedang login
 */
async function handleSaldo(msg) {
    const userId = getUserIdByWa(getSenderWa(msg));
    if (!userId) {
        return msg.reply(
            `❌ *BELUM LOGIN*\n\n` +
            `Anda belum login ke akun.\n` +
            `Ketik \`/daftar\` atau \`/login\` terlebih dahulu.`
        );
    }

    // Best-effort sinkronisasi order pending agar saldo/riwayat lebih akurat,
    // terutama jika bot sempat restart saat proses polling top-up.
    try {
        const rec = await payment.reconcilePendingTopupsForUser(userId, 10);

        // Jika ada order yang baru terdeteksi PAID saat rekonsiliasi,
        // kirim notifikasi eksplisit ke chat agar status pembayaran terlihat.
        if (rec && rec.success && Array.isArray(rec.paidOrders) && rec.paidOrders.length > 0) {
            for (const ord of rec.paidOrders) {
                await msg.reply(
                    `✅ *PEMBAYARAN TERKONFIRMASI*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🆔 Order : ${ord.orderId}\n` +
                    `💰 Top-up: ${formatRupiah(ord.amount)}\n` +
                    `🎉 Status: *SUKSES*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Saldo Anda sudah diperbarui.`
                );
            }
        }
    } catch (_) {
        // Abaikan jika gagal sinkron, tetap tampilkan saldo saat ini.
    }

    const user = auth.findUserById(userId);
    const balance = wallet.getBalance(userId);
    const txs = wallet.getTransactions(userId, 5);

    let teks = `💰 *SALDO AKUN*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Nama  : *${user.nama}*\n`;
    teks += `🚚 Driver : ${user.driverNama || '-'}\n`;
    teks += `📧 Email : ${user.email}\n`;
    teks += `💰 Saldo : *${formatRupiah(balance)}*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (txs.length) {
        teks += `📜 *Transaksi Terakhir:*\n`;
        txs.forEach(t => {
            const sign = t.amount >= 0 ? '+' : '';
            teks += `• ${t.description}: ${sign}${formatRupiah(t.amount)}\n`;
        });
    }

    teks += `\n💡 \`/topup\` untuk isi saldo.`;
    return msg.reply(teks);
}

/**
 * /topup [nominal] — buat QRIS top-up + kirim gambar QR + polling pembayaran
 */
async function handleTopup(msg, pesan, waClient = null) {
    const userId = getUserIdByWa(getSenderWa(msg));
    if (!userId) {
        return msg.reply(
            `❌ *BELUM LOGIN*\n\nKetik \`/daftar\` atau \`/login\` terlebih dahulu.`
        );
    }

    const args = pesan.split(' ').filter(Boolean);
    const amount = args.length >= 2 ? parseInt(args[1]) : NaN;

    if (isNaN(amount) || amount < config.topupMin) {
        return msg.reply(
            `❌ *NOMINAL TIDAK VALID*\n\n` +
            `Gunakan:\n\`/topup [nominal]\`\n\n` +
            `Contoh:\n\`/topup 50000\`\n\n` +
            `Minimal: ${formatRupiah(config.topupMin)}`
        );
    }

    let result = await payment.createTopup(userId, amount);

    // Jangan kirim ulang QRIS yang sudah lewat masa berlaku — buat yang baru.
    if (!result.success && result.code === 'PENDING_EXISTS' && payment.isOrderExpired(result.pendingOrder)) {
        result = await payment.createTopup(userId, amount);
    }

    if (!result.success) {
        if (result.code === 'PENDING_EXISTS' && result.pendingOrder) {
            await _resendPendingQris(msg, waClient, result.pendingOrder);
            return;
        }
        return msg.reply(`❌ *GAGAL MEMBUAT PEMBAYARAN*\n\n${result.error}`);
    }

    const order = result.data;
    const totalStr = formatRupiah(order.total);
    const feeStr = order.fee > 0 ? `\n📋 Biaya admin : ${formatRupiah(order.fee)}` : '';

    // Kirim status awal
    let teks = `💳 *PEMBAYARAN TOP-UP*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `💰 Saldo dibeli : ${formatRupiah(order.amount)}\n`;
    teks += `🧾 Total bayar  : *${totalStr}*${feeStr}\n`;
    teks += `⏳ Berlaku s/d  : ${order.expiryTime}\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `📲 *Scan QRIS di bawah ini untuk membayar:*\n`;
    teks += `⏳ _Menunggu pembayaran..._`;

    let statusMsg = await _safeReply(msg, waClient, teks);

    // Kirim gambar QR sebagai foto (bisa langsung di-scan)
    let qrSent = false;
    try {
        const qrBuffer = await _getQrBuffer(order);
        if (qrBuffer) {
            const media = new MessageMedia('image/png', qrBuffer.toString('base64'), 'qris.png');
            const caption = `💳 *QRIS ${totalStr}*\nBerlaku s/d ${order.expiryTime}`;
            qrSent = await _sendQrisImage(msg, waClient, media, caption);
        } else {
            logger.warn('TOPUP', 'Gagal menyiapkan gambar QR (URL & qrString gagal).');
        }
    } catch (e) {
        logger.warn('TOPUP', `Gagal kirim gambar QR: ${e.message}`);
    }

    // Fallback: jika gambar gagal, kirim link checkout
    if (!qrSent) {
        await _safeReply(msg, waClient, `🔗 Buka link pembayaran:\n${order.checkoutUrl}`);
    }

    // ── Polling status pembayaran di BACKGROUND (tidak memblokir bot) ──
    _pollPaymentInBackground(waClient, msg, userId, order.orderId, order.amount, statusMsg);
}

/**
 * Polling status pembayaran secara background (non-blocking).
 * Update pesan status ketika pembayaran terdeteksi.
 */
async function _pollPaymentInBackground(waClient, msg, userId, orderId, amount, statusMsg) {
    const POLL_MAX_MS = 15 * 60 * 1000; // 15 menit
    const pollStart = Date.now();

    const _check = async () => {
        try {
            const s = await payment.checkStatus(orderId);
            if (s.success && s.order && s.order.status === 'PAID') return 'PAID';
            if (!s.success && s.error === 'Pembayaran kedaluwarsa.') return 'EXPIRED';
            return 'PENDING';
        } catch (e) {
            return 'PENDING';
        }
    };

    const chatId = msg.safeChatId || msg.from;

    while (Date.now() - pollStart < POLL_MAX_MS) {
        await delay(5000); // cek tiap 5 detik
        const status = await _check();

        if (status === 'PAID') {
            const user = auth.findUserById(userId);
            const balance = wallet.getBalance(userId);
            const notif =
                `✅ *PEMBAYARAN BERHASIL*\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 ${user ? user.nama : '-'}\n` +
                `💰 Saldo bertambah: ${formatRupiah(amount)}\n` +
                `💵 Saldo sekarang : *${formatRupiah(balance)}*\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🎉 Akun Anda sudah aktif & siap absen!`;
            try {
                if (statusMsg && statusMsg.id) {
                    await statusMsg.edit(notif);
                } else if (waClient) {
                    await waClient.sendMessage(chatId, notif);
                }
            } catch (e) {
                if (waClient && chatId) { try { await waClient.sendMessage(chatId, notif); } catch (_) {} }
            }
            return;
        }

        if (status === 'EXPIRED') {
            try {
                if (statusMsg && statusMsg.id) {
                    await statusMsg.edit(`❌ *PEMBAYARAN KEDALUWARSA*\nQRIS sudah tidak berlaku. Silakan buat top-up baru.`);
                }
            } catch (e) { /* abaikan */ }
            return;
        }
    }

    // Timeout
    try {
        if (statusMsg && statusMsg.id) {
            await statusMsg.edit(`⏳ *WAKTU PEMBAYARAN HABIS*\nBelum terdeteksi pembayaran. Cek saldo dengan \`/saldo\` untuk memastikan.`);
        }
    } catch (e) { /* abaikan */ }
}

/**
 * Download gambar dari URL → Buffer (untuk QRIS)
 */
async function _downloadImage(url) {
    if (!url) {
        logger.warn('TOPUP', 'qrUrl kosong, tidak bisa download gambar QR.');
        return null;
    }
    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(20000),
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/png,image/*,*/*' },
        });
        if (!res.ok) {
            logger.warn('TOPUP', `Download QR gagal: HTTP ${res.status} (${url})`);
            return null;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) {
            logger.warn('TOPUP', 'Download QR gagal: body kosong.');
            return null;
        }
        logger.debug('TOPUP', `QR terdownload: ${buf.length} bytes (${res.headers.get('content-type')})`);
        return buf;
    } catch (e) {
        logger.warn('TOPUP', `Download QR error: ${e.message}`);
        return null;
    }
}

/**
 * Ambil buffer gambar QRIS: coba qrUrl provider dulu,
 * lalu fallback generate lokal dari qrString (payload EMVCo).
 */
async function _getQrBuffer(order) {
    const fromUrl = await _downloadImage(order.qrUrl);
    if (fromUrl) return fromUrl;

    if (!order.qrString) return null;
    try {
        const QRCode = require('qrcode');
        const buf = await QRCode.toBuffer(order.qrString, {
            type: 'png',
            width: 512,
            margin: 2,
            errorCorrectionLevel: 'M',
        });
        logger.info('TOPUP', `QR dibuat lokal dari qrString (${buf.length} bytes).`);
        return buf;
    } catch (e) {
        logger.warn('TOPUP', `Generate QR lokal gagal: ${e.message}`);
        return null;
    }
}

/**
 * Tampilkan ulang QRIS pending terakhir agar user bisa melunasi
 * tanpa membuat transaksi baru (anti-spam tetap aman).
 */
async function _resendPendingQris(msg, waClient, order) {
    const totalStr = formatRupiah(order.total || order.amount || 0);

    let teks = `⚠️ *PEMBAYARAN SEBELUMNYA MASIH PENDING*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `🆔 Order       : ${order.orderId}\n`;
    teks += `💰 Saldo dibeli: ${formatRupiah(order.amount || 0)}\n`;
    teks += `🧾 Total bayar : *${totalStr}*\n`;
    teks += `⏳ Berlaku s/d : ${order.expiryTime || '-'}\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `📲 Silakan lanjutkan pembayaran QRIS berikut:`;

    await _safeReply(msg, waClient, teks);

    let qrSent = false;
    try {
        const qrBuffer = await _getQrBuffer(order);
        if (qrBuffer) {
            const media = new MessageMedia('image/png', qrBuffer.toString('base64'), 'qris-pending.png');
            const caption = `💳 *QRIS Pending ${totalStr}*\nOrder: ${order.orderId}`;
            qrSent = await _sendQrisImage(msg, waClient, media, caption);
        } else {
            logger.warn('TOPUP', 'Gagal menyiapkan gambar QR pending (URL & qrString gagal).');
        }
    } catch (e) {
        logger.warn('TOPUP', `Resend QR pending gagal: ${e.message}`);
    }

    if (!qrSent) {
        await _safeReply(msg, waClient,
            `🔗 Link pembayaran sebelumnya:\n${order.checkoutUrl}\n\n` +
            `❗ Top-up baru diblokir sampai pembayaran ini selesai / kedaluwarsa.`
        );
    }
}

/**
 * Ambil chatId string yang valid untuk dipakai sendMessage.
 */
function _resolveChatId(msg) {
    return (
        (typeof msg?.safeChatId === 'string' && msg.safeChatId) ||
        (typeof msg?.from === 'string' && msg.from) ||
        (msg?.id?.remote && typeof msg.id.remote._serialized === 'string' && msg.id.remote._serialized) ||
        (typeof msg?.id?.remote === 'string' && msg.id.remote) ||
        config.waGrup
    );
}

/**
 * Kirim media langsung di browser context dengan urutan field yang benar.
 *
 * whatsapp-web.js v1.34.x menyusun pesan dengan `id/from/to` SEBELUM spread data
 * media, sehingga field internal media (`__x_id`) menimpa id pesan dan WA Web
 * melempar "Data passed to getter must include an id property ...". Di sini
 * identitas pesan diterapkan SETELAH spread media agar tidak tertimpa.
 *
 * @returns {Promise<boolean>} true jika berhasil dikirim
 */
async function _sendMediaRaw(waClient, chatId, media, caption) {
    if (!waClient || !waClient.pupPage || !chatId || !media) return false;
    try {
        return await waClient.pupPage.evaluate(
            async (chatId, mediaPayload, caption) => {
                const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
                if (!chat) return false;

                const mediaData = await window.WWebJS.processMediaData(mediaPayload, {});
                mediaData.caption = caption;
                const mediaJson = mediaData.toJSON ? mediaData.toJSON() : {};

                const { getMaybeMeLidUser, getMaybeMePnUser } = window.require('WAWebUserPrefsMeUser');
                const lidUser = getMaybeMeLidUser();
                const meUser = getMaybeMePnUser();

                let from = chat.id.isLid() ? lidUser : meUser;
                let participant;
                if (typeof chat.id.isGroup === 'function' && chat.id.isGroup()) {
                    from = chat.groupMetadata && chat.groupMetadata.isLidAddressingMode ? lidUser : meUser;
                    participant = window.require('WAWebWidFactory').asUserWidOrThrow(from);
                }

                const newId = await window.require('WAWebMsgKey').newId();
                const newMsgKey = new (window.require('WAWebMsgKey'))({
                    from,
                    to: chat.id,
                    id: newId,
                    participant,
                    selfDir: 'out',
                });
                const ephemeralFields = window
                    .require('WAWebGetEphemeralFieldsMsgActionsUtils')
                    .getEphemeralFields(chat);

                const message = {
                    ack: 0,
                    local: true,
                    self: 'out',
                    isNewMsg: true,
                    t: parseInt(Date.now() / 1000),
                    ...ephemeralFields,
                    ...mediaData,
                    ...mediaJson,
                    caption,
                    body: mediaData.preview,
                    type: mediaJson.type || 'image',
                    id: newMsgKey,
                    from,
                    to: chat.id,
                    ...(participant ? { participant } : {}),
                };

                const [msgPromise] = window
                    .require('WAWebSendMsgChatAction')
                    .addAndSendMsgToChat(chat, message);
                await msgPromise;
                return true;
            },
            chatId,
            { mimetype: media.mimetype, data: media.data, filename: media.filename },
            caption || undefined
        );
    } catch (e) {
        logger.warn('TOPUP', `sendMediaRaw gagal: ${e.message}`);
        return false;
    }
}

/**
 * Kirim gambar QRIS dengan urutan paling andal:
 * 1) raw browser send (tanpa serialisasi hasil)
 * 2) client.sendMessage biasa
 * 3) msg.reply
 */
async function _sendQrisImage(msg, waClient, media, caption) {
    const chatId = _resolveChatId(msg);

    if (await _sendMediaRaw(waClient, chatId, media, caption)) return true;

    if (waClient && typeof waClient.sendMessage === 'function' && chatId) {
        try {
            await waClient.sendMessage(chatId, media, { caption });
            return true;
        } catch (e) {
            logger.warn('TOPUP', `sendMessage(media) gagal: ${e.message}`);
        }
    }

    try {
        await msg.reply(media, undefined, { caption });
        return true;
    } catch (e) {
        logger.warn('TOPUP', `reply(media) gagal: ${e.message}`);
    }

    return false;
}

/**
 * Kirim balasan dengan fallback bertingkat (reply -> sendMessage chatId)
 * agar lebih tahan error pada context grup / linked device.
 */
async function _safeReply(msg, waClient, content, options = {}) {
    try {
        if (msg && typeof msg.reply === 'function') {
            const r = await msg.reply(content, undefined, options);
            if (r) return r;
        }
    } catch (e) {
        logger.debug('TOPUP', `safeReply: msg.reply gagal: ${e.message}`);
    }

    const chatId =
        (typeof msg?.safeChatId === 'string' && msg.safeChatId) ||
        (typeof msg?.from === 'string' && msg.from) ||
        (msg?.id?.remote && typeof msg.id.remote._serialized === 'string' && msg.id.remote._serialized) ||
        (typeof msg?.id?.remote === 'string' && msg.id.remote) ||
        config.waGrup;

    if (waClient && typeof waClient.sendMessage === 'function' && chatId) {
        try {
            return await waClient.sendMessage(chatId, content, options);
        } catch (e) {
            logger.warn('TOPUP', `safeReply: sendMessage gagal: ${e.message}`);
        }
    }
    return null;
}

/**
 * /riwayat — riwayat transaksi akun
 */
async function handleRiwayat(msg) {
    const userId = getUserIdByWa(getSenderWa(msg));
    if (!userId) {
        return msg.reply(`❌ *BELUM LOGIN*\n\nKetik \`/daftar\` atau \`/login\` terlebih dahulu.`);
    }

    const txs = wallet.getTransactions(userId, 15);
    if (!txs.length) {
        return msg.reply(`📜 *RIWAYAT TRANSAKSI*\n━━━━━━━━━━━━━━━━━━━━━━\nBelum ada transaksi.`);
    }

    let teks = `📜 *RIWAYAT TRANSAKSI*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    txs.forEach((t, i) => {
        const sign = t.amount >= 0 ? '+' : '';
        const icon = t.type === 'TOPUP' ? '💰' : t.type === 'POTONG_ABSEN' ? '🤖' : '📝';
        const date = new Date(t.createdAt).toLocaleString('id-ID');
        teks += `${i + 1}. ${icon} ${t.description}\n`;
        teks += `   ${sign}${formatRupiah(t.amount)} | ${date}\n\n`;
    });
    teks += `━━━━━━━━━━━━━━━━━━━━━━`;

    return msg.reply(teks);
}

/**
 * /linkakun — dapatkan link dashboard web untuk login
 */
async function handleLinkAkun(msg) {
    let teks = `🔗 *LINK DASHBOARD*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `Akses dashboard web Anda di:\n`;
    teks += `🌐 ${config.publicBaseUrl}\n\n`;
    teks += `Di sana Anda bisa login, cek saldo, top-up, dan lihat riwayat transaksi.`;
    return msg.reply(teks);
}

/**
 * /linkdriver [nama driver] — ikat akun ke nama driver tertentu
 * Saldo akun ini hanya dipakai untuk absen driver tersebut.
 */
async function handleLinkDriver(msg, pesan) {
    const userId = getUserIdByWa(getSenderWa(msg));
    if (!userId) {
        return msg.reply(`❌ *BELUM LOGIN*\n\nKetik \`/daftar\` atau \`/login\` terlebih dahulu.`);
    }

    const nama = pesan.split(' ').slice(1).join(' ').trim();
    if (!nama) {
        return msg.reply(
            `❌ *FORMAT SALAH*\n\nGunakan:\n\`/linkdriver [Nama Driver]\`\n\nContoh:\n\`/linkdriver Agung maulana\``
        );
    }

    // Validasi nama driver terdaftar di database
    const db = require('../database');
    const { driver } = db.findDriver(nama);
    if (!driver) {
        return msg.reply(
            `❌ *NAMA DRIVER TIDAK DITEMUKAN*\n\nDriver *"${nama}"* tidak ada di database.\nCek \`/listdriver\` untuk daftar yang benar.`
        );
    }

    const result = auth.updateUser(userId, { driverNama: driver.nama });
    if (!result.success) {
        return msg.reply(`❌ ${result.error}`);
    }

    return msg.reply(
        `✅ *DRIVER TERIKAT*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Akun  : *${result.user.nama}*\n` +
        `🚚 Driver: *${result.user.driverNama}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 Saldo akun ini hanya dipakai untuk absen driver tersebut.`
    );
}

module.exports = {
    handleDaftar,
    handleLogin,
    handleLogout,
    handleSaldo,
    handleTopup,
    handleRiwayat,
    handleLinkAkun,
    handleLinkDriver,
    getUserIdByWa,
    getSenderWa,
    setWaSession,
    clearWaSession,
};
