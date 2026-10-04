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
const { withTimeout } = require('./utils/helpers');

// Event `ready` bisa terpicu lebih dari sekali (re-sync WA Web). Tanpa penjaga ini,
// cron & watchdog akan terdaftar berkali-kali → absen ganda dan interval menumpuk.
let schedulerSudahAktif = false;
let watchdogSudahAktif = false;
let sudahReady = false;
let sedangRestart = false;

const WATCHDOG_INTERVAL_MS = 120000;   // periksa tiap 2 menit
const WATCHDOG_PROBE_TIMEOUT = 20000;  // batas waktu satu kali probe
const WATCHDOG_MAX_FAILS = 4;          // ~8 menit tidak sehat → restart
const BOOT_TIMEOUT_MS = 10 * 60 * 1000; // batas waktu mencapai status READY

/**
 * Keluar dari proses agar PM2 melakukan restart bersih.
 * @param {string} alasan
 */
function restartProses(alasan) {
    if (sedangRestart) return;
    sedangRestart = true;
    logger.error('WATCHDOG', `${alasan} Keluar dari proses agar PM2 melakukan restart bersih...`);
    setTimeout(() => process.exit(1), 2000);
}

/**
 * Pantau kematian halaman/browser WA Web secara event-driven.
 * Tanpa ini, Chrome yang di-OOM-kill membuat bot "hidup tapi bisu":
 * proses Node tetap jalan, tidak ada error, tapi semua perintah diabaikan.
 * @param {Client} client
 */
function pasangPengawasHalaman(client) {
    const page = client.pupPage;
    const browser = client.pupBrowser;

    if (page && !page.__pengawasTerpasang) {
        page.__pengawasTerpasang = true;
        page.on('close', () => restartProses('Halaman WA Web tertutup tak terduga.'));
        page.on('error', (err) => restartProses(`Halaman WA Web crash: ${(err && err.message) || err}.`));
    }

    if (browser && !browser.__pengawasTerpasang) {
        browser.__pengawasTerpasang = true;
        browser.on('disconnected', () => restartProses('Browser WA Web terputus (Chrome mati/OOM).'));
    }
}

/**
 * Verifikasi grup tujuan laporan bisa dijangkau.
 * Bila ID grup salah atau bot sudah dikeluarkan, rekap absen akan hilang
 * tanpa jejak — jadi masalahnya dilaporkan saat startup, bukan saat jam 8.
 * @param {Client} client
 */
async function verifikasiGrupLaporan(client) {
    if (!config.waGrup) {
        logger.error('LAPORAN', 'WA_GRUP belum diatur! Rekap absen tidak akan terkirim ke grup.');
        return;
    }

    try {
        const chat = await withTimeout(client.getChatById(config.waGrup), 20000, 'getChatById(grup)');
        if (chat) {
            logger.success('LAPORAN', `Grup laporan terjangkau: "${chat.name || chat.id._serialized}".`);
            return;
        }
        logger.error('LAPORAN', `Grup laporan ${config.waGrup} tidak ditemukan.`);
    } catch (e) {
        logger.error('LAPORAN', `Grup laporan ${config.waGrup} TIDAK terjangkau: ${e.message}. Periksa WA_GRUP di .env & pastikan bot masih anggota grup.`);
    }
}

/**
 * Health probe: pastikan browser & halaman WA Web benar-benar masih responsif.
 * Cek `getState()` saja tidak cukup — di VPS halaman bisa mati/detached
 * sementara `getState()` tetap mengembalikan nilai lama atau menggantung.
 * @param {Client} client
 * @returns {Promise<{sehat: boolean, alasan: string, fatal?: boolean}>}
 */
async function cekKesehatan(client) {
    const page = client.pupPage;
    const browser = client.pupBrowser;

    if (!page || page.isClosed()) {
        return { sehat: false, alasan: 'Halaman WA Web sudah tertutup.', fatal: true };
    }
    if (browser && typeof browser.connected === 'boolean' && !browser.connected) {
        return { sehat: false, alasan: 'Browser WA Web terputus (proses Chrome mati).', fatal: true };
    }

    // Probe utama: eksekusi JS sederhana di halaman. Sengaja TIDAK memakai API
    // internal WA Web (window.require) agar perubahan internal WhatsApp tidak
    // memicu restart-loop palsu. Yang diuji hanya: halaman masih merespons.
    try {
        const pong = await withTimeout(
            page.evaluate(() => 'pong'),
            WATCHDOG_PROBE_TIMEOUT,
            'pupPage.evaluate(healthProbe)'
        );
        if (pong !== 'pong') {
            return { sehat: false, alasan: 'Halaman WA Web tidak merespons probe.' };
        }
    } catch (err) {
        const msg = (err && err.message) || String(err);
        const fatal = msg.includes('Session closed') ||
            msg.includes('Target closed') ||
            msg.includes('Protocol error') ||
            msg.includes('Connection closed');
        return { sehat: false, alasan: `Probe halaman gagal: ${msg}`, fatal };
    }

    // Probe sekunder: status koneksi WhatsApp. Error di sini sering transient
    // (frame detached) sehingga TIDAK dihitung sakit — halaman sudah terbukti hidup.
    try {
        const state = await withTimeout(client.getState(), WATCHDOG_PROBE_TIMEOUT, 'getState');
        if (state && state !== 'CONNECTED') {
            return { sehat: false, alasan: `Status WhatsApp: ${state}.` };
        }
    } catch (err) {
        logger.debug('WATCHDOG', `getState() transient: ${(err && err.message) || err}`);
    }

    return { sehat: true, alasan: 'OK' };
}

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

    // ── Jaring pengaman boot: kalau `ready` tak pernah datang, proses dibiarkan
    //    menggantung tanpa batas. Restart agar PM2 mencoba dari awal. ──
    const bootTimer = setTimeout(() => {
        if (!sudahReady) {
            restartProses(`Bot tidak mencapai status READY dalam ${BOOT_TIMEOUT_MS / 60000} menit.`);
        }
    }, BOOT_TIMEOUT_MS);
    if (bootTimer.unref) bootTimer.unref();

    // ── Event: Ready ──
    client.on('ready', async () => {
        sudahReady = true;
        clearTimeout(bootTimer);
        pasangPengawasHalaman(client);
        verifikasiGrupLaporan(client);

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

        // Aktifkan cron scheduler (sekali saja, walau `ready` terpicu berulang)
        if (!schedulerSudahAktif) {
            schedulerSudahAktif = true;
            initScheduler(client);
        }

        // ── Connection Watchdog / Health Check berkala ──
        if (watchdogSudahAktif) return;
        watchdogSudahAktif = true;

        let consecutiveFails = 0;

        const timer = setInterval(async () => {
            let hasil;
            try {
                hasil = await cekKesehatan(client);
            } catch (err) {
                hasil = { sehat: false, alasan: `Watchdog error: ${(err && err.message) || err}` };
            }

            if (hasil.sehat) {
                if (consecutiveFails > 0) {
                    logger.success('WATCHDOG', 'Koneksi kembali sehat.');
                }
                consecutiveFails = 0;
                return;
            }

            // Browser/halaman benar-benar mati → tidak ada gunanya menunggu, restart sekarang.
            if (hasil.fatal) {
                clearInterval(timer);
                restartProses(`Kondisi fatal terdeteksi: ${hasil.alasan}`);
                return;
            }

            consecutiveFails++;
            logger.warn('WATCHDOG', `Tidak sehat (${consecutiveFails}/${WATCHDOG_MAX_FAILS}): ${hasil.alasan}`);

            if (consecutiveFails >= WATCHDOG_MAX_FAILS) {
                clearInterval(timer);
                restartProses(`Bot tidak sehat ${WATCHDOG_MAX_FAILS}x berturut-turut (${hasil.alasan}).`);
            }
        }, WATCHDOG_INTERVAL_MS);
    });

    // Register command router
    registerCommandRouter(client);

    return client;
}

module.exports = { createClient };
