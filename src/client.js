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
            dumpio: false,
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
        logger.system('Mematikan proses untuk auto-restart bersih oleh PM2 dalam 3 detik...');
        setTimeout(() => {
            process.exit(1);
        }, 3000);
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

        // ── Connection Watchdog / Health Check berkala (setiap 3 menit) ──
        // Lebih tahan banting: retry + toleransi error transient (detached frame),
        // hanya keluar setelah beberapa kegagalan berturut-turut.
        let consecutiveFails = 0;

        setInterval(async () => {
            let state = null;

            // Coba hingga 3x dengan jeda singkat
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    state = await client.getState();
                    break;
                } catch (err) {
                    const msg = (err && err.message) || String(err);
                    // "detached Frame" adalah error transient puppeteer, BUKAN koneksi putus.
                    // Bot sebenarnya masih berfungsi → abaikan, jangan hitung sebagai kegagalan.
                    if (msg.includes('detached Frame') || msg.includes('Target closed') || msg.includes('Execution context was destroyed')) {
                        logger.debug('WATCHDOG', `Error transient diabaikan (attempt ${attempt}/3): ${msg}`);
                        await new Promise(r => setTimeout(r, 3000));
                        continue; // coba lagi, tetap dalam hitungan attempt
                    }
                    if (attempt < 3) {
                        logger.warn('WATCHDOG', `getState() gagal (attempt ${attempt}/3): ${msg}. Mencoba lagi...`);
                        await new Promise(r => setTimeout(r, 3000));
                    } else {
                        throw err;
                    }
                }
            }

            if (state === 'CONNECTED') {
                consecutiveFails = 0; // sehat
            } else if (state === null) {
                // Semua attempt gagal karena error transient → anggap masih hidup (jangan hitung fail)
                logger.debug('WATCHDOG', `getState() gagal karena error transient, anggap masih terhubung.`);
            } else {
                consecutiveFails++;
                logger.warn('WATCHDOG', `Koneksi WhatsApp terganggu (Status: ${state}). (${consecutiveFails}/3)`);
                if (consecutiveFails >= 3) {
                    logger.warn('WATCHDOG', 'Status koneksi belum stabil 3x berturut-turut. Menunggu siklus berikutnya tanpa restart paksa.');
                    // Jangan restart paksa dari watchdog; biarkan event `disconnected`
                    // yang memutuskan restart agar lebih aman dari false-positive.
                    consecutiveFails = 0;
                }
            }
        }, 180000);
    });

    // Register command router
    registerCommandRouter(client);

    return client;
}

module.exports = { createClient };
