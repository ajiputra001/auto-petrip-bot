// ══════════════════════════════════════════
// 📱 CLIENT — WhatsApp Client Initialization
// ══════════════════════════════════════════
// Trigger watch reload to apply updated node_modules
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const logger = require('./utils/logger');
const { registerCommandRouter } = require('./commands');
const { initScheduler } = require('./scheduler');

/**
 * Buat & konfigurasi WhatsApp client
 * @returns {Client} WhatsApp client instance
 */
function createClient() {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: config.waClientId }),
        authTimeoutMs: config.waAuthTimeout,
        puppeteer: {
            executablePath: config.chromePath,
            headless: 'new',
            handleSIGINT: false,
            timeout: config.browserTimeout,
            protocolTimeout: config.browserTimeout,
            args: config.puppeteerArgs,
            dumpio: true,
        },
    });

    // ── Event: Loading Screen ──
    client.on('loading_screen', (percent, message) => {
        logger.telemetry(percent, message);
    });

    // ── Event: QR Code ──
    client.on('qr', (qr) => {
        logger.warn('SYSTEM', 'Sesi kosong! Silakan scan QR Code ini lewat HP Anda:');
        console.log('');
        qrcode.generate(qr, { small: true });
        console.log('');
    });

    // ── Event: Authenticated ──
    client.on('authenticated', () => {
        logger.success('AUTH', 'Otentikasi berhasil! Token sesi tervalidasi.');
    });

    // ── Event: Auth Failure ──
    client.on('auth_failure', (msg) => {
        logger.error('AUTH', `Sesi login kedaluwarsa atau korup: ${msg}`);
    });

    // ── Event: Disconnected ──
    client.on('disconnected', (reason) => {
        logger.error('CLIENT', `Terputus dari WhatsApp: ${reason}`);
        logger.system('Mencoba reconnect dalam 10 detik...');
        setTimeout(() => {
            client.initialize();
        }, 10000);
    });

    // ── Event: Ready ──
    client.on('ready', async () => {
        // Patch Msg.get in the browser to fix message resolution (e.g. edit, delete) with $1 ID renaming
        try {
            await client.pupPage.evaluate(() => {
                try {
                    const Msg = window.require('WAWebCollections').Msg;
                    if (Msg && Msg.get && !Msg.get.isPatched) {
                        const originalGet = Msg.get;
                        Msg.get = function (id) {
                            let res;
                            try {
                                res = originalGet.call(this, id);
                            } catch (e) {
                                // Ignore error if originalGet fails on string parameter
                            }
                            if (!res && id) {
                                const norm = (val) => {
                                    if (typeof val === 'string') return val.replace(/@lid/g, '@c.us');
                                    if (val && typeof val === 'object' && typeof val._serialized === 'string') {
                                        return val._serialized.replace(/@lid/g, '@c.us');
                                    }
                                    return '';
                                };
                                const target = norm(id);
                                if (target) {
                                    const list = this.toArray ? this.toArray() : (this.models || []);
                                    res = list.find(m => {
                                        if (!m.id) return false;
                                        const mId = norm(m.id);
                                        const mIdS1 = norm(m.id.$1);
                                        return (mId && mId === target) || (mIdS1 && mIdS1 === target);
                                    });
                                }
                            }
                            return res;
                        };
                        Msg.get.isPatched = true;
                    }
                } catch (e) {
                    console.error('Browser patch Msg.get error:', e);
                }
            });
            logger.success('SYSTEM', 'Browser-side Msg.get patched successfully.');
        } catch (err) {
            logger.warn('SYSTEM', `Browser-side Msg.get patch failed: ${err.message}`);
        }

        logger.success('CLIENT', 'WhatsApp Bot v4.1 Sovereign Telemetry ONLINE!');
        logger.system('Semua sistem operasional. Menunggu perintah...');
        logger.readySign();

        // Aktifkan cron scheduler
        initScheduler(client);
    });

    // Register command router
    registerCommandRouter(client);

    return client;
}

module.exports = { createClient };
