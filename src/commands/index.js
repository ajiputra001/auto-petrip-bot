// ══════════════════════════════════════════
// 🎮 COMMAND ROUTER — Pusat Routing & Smart Assistant
// ══════════════════════════════════════════

const logger = require('../utils/logger');
const { hitungKemiripan } = require('../utils/helpers');

// Import semua command handler
const { handleMenu, handleBantuan, handleNumberInput, handlePendingInput } = require('./menu');
const { handleTambahDriver, handleEditDriver, handleHapusDriver, handleListDriver } = require('./driver');
const { handleSetLibur, handleSetMasuk, handleCekLibur } = require('./jadwal');
const { handleUpdateFoto, handleUpdateCookie } = require('./media');
const { handleStatus } = require('./status');
const { handleAbsen, handleAbsenManual } = require('./absen');
const {
    handleDaftar, handleLogin, handleLogout, handleSaldo,
    handleTopup, handleRiwayat, handleLinkAkun, handleLinkDriver,
} = require('./akun');
const {
    handleListUser, handleAktifkan, handleNonaktifkan,
    handleSetAdmin, handleAdminReset, handleAdjust, handleOrderList, handleAdminStat,
    handleSetForm, handleGetForm, handleResetForm, handleAbsenkan, handleAbsenkanSemua,
    handleLinkDriverUser,
} = require('./admin');
const { showAdminMenu, handleAdminInput, clearAdminState } = require('./admin-ui');

/**
 * Daftar semua perintah resmi untuk kecerdasan rekomendasi typo
 */
const KNOWN_COMMANDS = [
    '/menu', '/bantuan',
    '/tambahdriver', '/editdriver', '/hapusdriver', '/listdriver',
    '/setlibur', '/setmasuk', '/ceklibur',
    '/updatefoto', '/updatecookie',
    '/status', '/absen', '/absenmanual',
    '/daftar', '/login', '/logout', '/saldo', '/topup', '/riwayat', '/linkakun', '/linkdriver',
    '/admin', '/listuser', '/aktifkan', '/nonaktifkan', '/setadmin', '/adminreset', '/adjust', '/orderlist', '/adminstat',
    '/setform', '/getform', '/resetform', '/absenkan', '/absenkansemua', '/linkdriveruser'
];

/**
 * Definisi routing perintah
 * Format: { match, handler }
 */
const ROUTES = [
    // Menu
    { match: (cmd) => cmd === '/menu', handler: handleMenu },
    { match: (cmd) => cmd === '/bantuan', handler: handleBantuan },

    // Driver CRUD
    { match: (cmd) => cmd.startsWith('/tambahdriver ') || cmd === '/tambahdriver', handler: handleTambahDriver },
    { match: (cmd) => cmd.startsWith('/editdriver ') || cmd === '/editdriver',   handler: handleEditDriver },
    { match: (cmd) => cmd.startsWith('/hapusdriver ') || cmd === '/hapusdriver',  handler: handleHapusDriver },
    { match: (cmd) => cmd === '/listdriver',                                     handler: handleListDriver },

    // Jadwal
    { match: (cmd) => cmd.startsWith('/setlibur ') || cmd === '/setlibur',  handler: handleSetLibur },
    { match: (cmd) => cmd.startsWith('/setmasuk ') || cmd === '/setmasuk',  handler: handleSetMasuk },
    { match: (cmd) => cmd === '/ceklibur',                                   handler: handleCekLibur },

    // Media
    { match: (cmd) => cmd.startsWith('/updatefoto') || cmd.startsWith('/update foto'),     handler: handleUpdateFoto },
    { match: (cmd) => cmd.startsWith('/updatecookie') || cmd.startsWith('/update cookie'), handler: handleUpdateCookie },

    // System
    { match: (cmd) => cmd === '/status',      handler: handleStatus },
    { match: (cmd) => cmd === '/absenmanual', handler: handleAbsenManual },
    { match: (cmd) => cmd.startsWith('/absen ') || cmd === '/absen', handler: handleAbsen },

    // Akun & Pembayaran
    { match: (cmd) => cmd.startsWith('/daftar ') || cmd === '/daftar', handler: handleDaftar },
    { match: (cmd) => cmd.startsWith('/login ') || cmd === '/login',   handler: handleLogin },
    { match: (cmd) => cmd === '/logout',                                handler: handleLogout },
    { match: (cmd) => cmd === '/saldo',                                 handler: handleSaldo },
    { match: (cmd) => cmd.startsWith('/topup ') || cmd === '/topup',    handler: handleTopup },
    { match: (cmd) => cmd === '/riwayat',                               handler: handleRiwayat },
    { match: (cmd) => cmd === '/linkakun',                              handler: handleLinkAkun },
    { match: (cmd) => cmd.startsWith('/linkdriver ') || cmd === '/linkdriver', handler: handleLinkDriver },

    // Admin
    { match: (cmd) => cmd === '/admin', handler: (msg, pesan, client) => showAdminMenu(client, msg) },
    { match: (cmd) => cmd === '/listuser',                                  handler: handleListUser },
    { match: (cmd) => cmd.startsWith('/aktifkan ') || cmd === '/aktifkan',  handler: handleAktifkan },
    { match: (cmd) => cmd.startsWith('/nonaktifkan ') || cmd === '/nonaktifkan', handler: handleNonaktifkan },
    { match: (cmd) => cmd.startsWith('/setadmin ') || cmd === '/setadmin',  handler: handleSetAdmin },
    { match: (cmd) => cmd.startsWith('/adminreset ') || cmd === '/adminreset', handler: handleAdminReset },
    { match: (cmd) => cmd.startsWith('/adjust ') || cmd === '/adjust',      handler: handleAdjust },
    { match: (cmd) => cmd === '/orderlist',                                 handler: handleOrderList },
    { match: (cmd) => cmd === '/adminstat',                                 handler: handleAdminStat },
    { match: (cmd) => cmd.startsWith('/setform ') || cmd === '/setform',    handler: handleSetForm },
    { match: (cmd) => cmd === '/getform',                                   handler: handleGetForm },
    { match: (cmd) => cmd === '/resetform',                                 handler: handleResetForm },
    { match: (cmd) => cmd === '/absenkansemua',                             handler: handleAbsenkanSemua },
    { match: (cmd) => cmd.startsWith('/absenkan ') || cmd === '/absenkan',  handler: handleAbsenkan },
    { match: (cmd) => cmd.startsWith('/linkdriveruser ') || cmd === '/linkdriveruser', handler: handleLinkDriverUser },
];

// ── Anti-Duplikat: Cache ID pesan yang sudah diproses ──
const processedMsgIds = new Set();
const MAX_CACHE_SIZE = 200;

/**
 * Bersihkan cache lama agar tidak memory leak
 */
function cleanupCache() {
    if (processedMsgIds.size > MAX_CACHE_SIZE) {
        const idsArray = [...processedMsgIds];
        idsArray.slice(0, Math.floor(MAX_CACHE_SIZE / 2)).forEach(id => processedMsgIds.delete(id));
    }
}

/**
 * Register command router ke WhatsApp client
 * @param {Object} client - WhatsApp client instance
 */
function registerCommandRouter(client) {
    const routerStartupTime = Math.floor(Date.now() / 1000);

    client.on('message_create', async (msg) => {
        try {
            // ── Skip pesan yang dikirim sebelum bot dinyalakan (pesan offline / sync) ──
            if (msg.timestamp && msg.timestamp < routerStartupTime) {
                return;
            }

            // ── Skip pesan yang dikirim BOT SENDIRI (fromMe) ──
            // Penting: tanpa ini, prompt menu/balasan bot ikut diproses sebagai input
            // sehingga alur input bertahap (topup/login/daftar) jadi kacau.
            if (msg.fromMe) {
                return;
            }

            // ── Anti-Duplikat: Skip jika pesan sudah pernah diproses ──
            const msgId = msg.id && msg.id._serialized ? msg.id._serialized : null;
            if (msgId) {
                if (processedMsgIds.has(msgId)) return;
                processedMsgIds.add(msgId);
                cleanupCache();
            }

            // ── Skip pesan lokasi / live location / tipe media selain text, image, document, tombol ──
            const interactiveTypes = ['buttons_response', 'list_response', 'interactive'];
            const isInteractive = interactiveTypes.includes(msg.type) ||
                msg.selectedButtonId || msg.selectedRowId;
            if (
                msg.type === 'location' ||
                msg.type === 'location_live' ||
                msg.type === 'live_location' ||
                msg.isLocation ||
                (!isInteractive && msg.type !== 'chat' && msg.type !== 'image' && msg.type !== 'document')
            ) {
                return;
            }

            const pesan = msg.body ? msg.body.trim() : '';
            const pesanLower = pesan.toLowerCase();

            // ── Deteksi klik tombol/list interaktif (masih didukung untuk kompatibilitas) ──
            const clickedCmd = msg.selectedButtonId || msg.selectedRowId || null;
            if (clickedCmd && !pesanLower.startsWith('/')) {
                msg._fromButton = true;
                return await _executeCommand(client, msg, clickedCmd, clickedCmd.toLowerCase());
            }

            // Cek apakah pesan dimulai dengan /
            if (!pesanLower.startsWith('/')) {
                // ── Prioritas 0: Panel admin interaktif (navigasi angka & input) ──
                msg.safeChatId = msg.safeChatId || msg.from;
                const adminNav = await handleAdminInput(client, msg, pesan);
                if (adminNav.handled) {
                    if (adminNav.command) {
                        logger.info('COMMAND', `[ADMIN-UI] → ${adminNav.command} dari ${msg.from}`);
                        return await _executeCommand(client, msg, adminNav.command, adminNav.command.toLowerCase());
                    }
                    return;
                }

                // ── Prioritas 1: Input bertahap (topup/login/daftar) ──
                const pending = await handlePendingInput(client, msg, pesan);
                if (pending.handled) {
                    if (pending.command) {
                        logger.info('COMMAND', `[INPUT] → ${pending.command} dari ${msg.from} (pesan: "${pesan}")`);
                        return await _executeCommand(client, msg, pending.command, pending.command.toLowerCase());
                    }
                    return; // pertanyaan berikutnya sudah dikirim
                }

                // ── Prioritas 2: Navigasi menu bernomor (balas angka 0-9) ──
                const nav = await handleNumberInput(client, msg, pesan);
                if (nav.handled) {
                    if (nav.command) {
                        logger.info('COMMAND', `[MENU] → ${nav.command} dari ${msg.from}`);
                        return await _executeCommand(client, msg, nav.command, nav.command.toLowerCase());
                    }
                    return; // submenu sudah dikirim
                }
                return;
            }

            // Skip jika pesan diawali koordinat lokasi/angka (misal: /-6.1234,106.1234)
            if (/^\/[-+]?\d+[\.,]\d+/.test(pesanLower)) {
                return;
            }

            return await _executeCommand(client, msg, pesan, pesanLower);
        } catch (err) {
            logger.error('COMMAND', `Error saat memproses perintah: ${err.message}`);
            logger.debug('COMMAND', err.stack);
            try {
                await msg.reply(`❌ *Error Internal*\n_${err.message}_`);
            } catch (e) { /* abaikan jika gagal reply */ }
        }
    });

    logger.success('ROUTER', `${ROUTES.length} perintah terdaftar & siap digunakan dengan Smart Assistance.`);
}

/**
 * Eksekusi sebuah perintah (dari teks / atau klik tombol/list).
 * @param {Object} client - WhatsApp client
 * @param {Object} msg - Message object
 * @param {string} pesan - Perintah asli (misal "/saldo" atau "/topup 50000")
 * @param {string} pesanLower - Perintah lowercase
 */
async function _executeCommand(client, msg, pesan, pesanLower) {
    // Ambil chat ID asli dalam bentuk STRING yang valid untuk sendMessage.
    // Prioritas: msg.from (stabil di group/private), fallback ke remote serialized.
    const actualChatId =
        (typeof msg.from === 'string' && msg.from) ||
        (msg.id && msg.id.remote && typeof msg.id.remote._serialized === 'string' && msg.id.remote._serialized) ||
        (msg.id && typeof msg.id.remote === 'string' && msg.id.remote) ||
        '';
    if (!actualChatId) return;
    msg.safeChatId = actualChatId;

    // Amankan fungsi reply khusus untuk pesan yang dikirim diri sendiri / Linked Device
    const fromStr = msg.from || '';
    const isSelf = msg.fromMe || fromStr.includes('@lid') || actualChatId.includes('@lid');
    const originalReply = msg.reply ? msg.reply.bind(msg) : null;
    msg.reply = async (content, chatId, options) => {
        // Signature asli whatsapp-web.js: reply(content, chatId?, options?)
        // Pastikan options selalu object saat fallback ke sendMessage.
        const sendOpts = options && typeof options === 'object' ? options : {};

        if (isSelf) {
            try {
                return await client.sendMessage(actualChatId, content, sendOpts);
            } catch (e) {
                logger.error('ROUTER', `Bypass reply gagal: ${e.message}`);
            }
        }
        try {
            if (originalReply) {
                return await originalReply(content, chatId, sendOpts);
            }
        } catch (e) {
            logger.debug('ROUTER', `Original reply gagal: ${e.message}`);
        }
        try {
            return await client.sendMessage(actualChatId, content, sendOpts);
        } catch (e) {
            logger.error('ROUTER', `Semua metode reply gagal: ${e.message}`);
        }
    };

    // Perintah slash selain /admin mengakhiri sesi panel admin agar state tidak nyangkut
    if (pesanLower !== '/admin') {
        clearAdminState(msg);
    }

    // Cari route yang cocok
    let matched = false;
    for (const route of ROUTES) {
        if (route.match(pesanLower)) {
            matched = true;
            logger.info('COMMAND', `${pesanLower.split(' ')[0]} dari ${msg.from}`);

            // Selalu oper client untuk fungsi yang membutuhkan
            await route.handler(msg, pesan, client);
            return; // Stop setelah match pertama
        }
    }

    // Jika tidak ada route yang cocok, berikan rekomendasi cerdas (Smart Typo Recommendation)
    if (!matched) {
        const cmdKeyword = pesanLower.split(' ')[0];
        let bestMatch = null;
        let minDistance = Infinity;

        KNOWN_COMMANDS.forEach(k => {
            const dist = hitungKemiripan(cmdKeyword, k);
            if (dist <= 3 && dist < minDistance) {
                minDistance = dist;
                bestMatch = k;
            }
        });

        let balasanSaran = `❌ Perintah *${cmdKeyword}* tidak dikenali.`;
        if (bestMatch) {
            const sisaArg = pesan.substring(cmdKeyword.length);
            balasanSaran += `\n\n💡 *Apakah maksud Anda*: \`${bestMatch}${sisaArg}\`?`;
        }
        balasanSaran += `\n\n📜 Ketik \`/menu\` untuk melihat seluruh daftar perintah resmi.`;

        return await msg.reply(balasanSaran);
    }
}

module.exports = { registerCommandRouter };
