// ══════════════════════════════════════════
// 🎮 COMMAND ROUTER — Pusat Routing Semua Perintah
// ══════════════════════════════════════════

const logger = require('../utils/logger');

// Import semua command handler
const { handleMenu } = require('./menu');
const { handleTambahDriver, handleEditDriver, handleHapusDriver, handleListDriver } = require('./driver');
const { handleSetLibur, handleSetMasuk, handleCekLibur } = require('./jadwal');
const { handleUpdateFoto, handleUpdateCookie } = require('./media');
const { handleStatus } = require('./status');
const { handleAbsen, handleAbsenManual } = require('./absen');

/**
 * Definisi routing perintah
 * Format: { match, handler, needsClient }
 */
const ROUTES = [
    // Menu
    { match: (cmd) => cmd === '/menu' || cmd === '/bantuan', handler: handleMenu },

    // Driver CRUD
    { match: (cmd) => cmd.startsWith('/tambahdriver '), handler: handleTambahDriver },
    { match: (cmd) => cmd.startsWith('/editdriver '),   handler: handleEditDriver },
    { match: (cmd) => cmd.startsWith('/hapusdriver '),   handler: handleHapusDriver },
    { match: (cmd) => cmd === '/listdriver',              handler: handleListDriver },

    // Jadwal
    { match: (cmd) => cmd.startsWith('/setlibur '),  handler: handleSetLibur },
    { match: (cmd) => cmd.startsWith('/setmasuk '),  handler: handleSetMasuk },
    { match: (cmd) => cmd === '/ceklibur',            handler: handleCekLibur },

    // Media
    { match: (cmd) => cmd.startsWith('/updatefoto ') || cmd.startsWith('/update foto '),     handler: handleUpdateFoto },
    { match: (cmd) => cmd.startsWith('/updatecookie ') || cmd.startsWith('/update cookie '), handler: handleUpdateCookie },

    // System
    { match: (cmd) => cmd === '/status',      handler: handleStatus },
    { match: (cmd) => cmd === '/absenmanual', handler: handleAbsenManual, needsClient: true },
    { match: (cmd) => cmd.startsWith('/absen '), handler: handleAbsen, needsClient: true },
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

            // ── Anti-Duplikat: Skip jika pesan sudah pernah diproses ──
            const msgId = msg.id && msg.id._serialized ? msg.id._serialized : null;
            if (msgId) {
                if (processedMsgIds.has(msgId)) return;
                processedMsgIds.add(msgId);
                cleanupCache();
            }

            const pesan = msg.body ? msg.body.trim() : '';
            const pesanLower = pesan.toLowerCase();

            // Cek apakah pesan dimulai dengan /
            if (!pesanLower.startsWith('/')) return;

            // Ambil chat ID asli (bukan JID Linked Device @lid)
            const actualChatId = msg.id && msg.id.remote ? msg.id.remote : '';
            if (!actualChatId) return;
            msg.safeChatId = actualChatId;

            // Amankan fungsi reply khusus untuk pesan yang dikirim diri sendiri / Linked Device
            const fromStr = msg.from || '';
            const isSelf = msg.fromMe || fromStr.includes('@lid') || actualChatId.includes('@lid');
            const originalReply = msg.reply ? msg.reply.bind(msg) : null;
            msg.reply = async (teks) => {
                if (isSelf) {
                    try {
                        return await client.sendMessage(actualChatId, teks);
                    } catch (e) {
                        logger.error('ROUTER', `Bypass reply gagal: ${e.message}`);
                    }
                }
                try {
                    if (originalReply) {
                        return await originalReply(teks);
                    }
                } catch (e) {
                    logger.debug('ROUTER', `Original reply gagal: ${e.message}`);
                }
                try {
                    return await client.sendMessage(actualChatId, teks);
                } catch (e) {
                    logger.error('ROUTER', `Semua metode reply gagal: ${e.message}`);
                }
            };

            // Cari route yang cocok
            for (const route of ROUTES) {
                if (route.match(pesanLower)) {
                    logger.info('COMMAND', `${pesanLower.split(' ')[0]} dari ${msg.from}`);

                    // Selalu oper client untuk fungsi yang butuh
                    await route.handler(msg, pesan, client);
                    return; // Stop setelah match pertama
                }
            }
        } catch (err) {
            logger.error('COMMAND', `Error saat memproses perintah: ${err.message}`);
            logger.debug('COMMAND', err.stack);
            try {
                await msg.reply(`❌ *Error Internal*\n_${err.message}_`);
            } catch (e) { /* abaikan jika gagal reply */ }
        }
    });

    logger.success('ROUTER', `${ROUTES.length} perintah terdaftar & siap digunakan.`);
}

module.exports = { registerCommandRouter };
