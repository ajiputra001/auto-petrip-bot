// ══════════════════════════════════════════
// ⚙️ CONFIG — Loader Konfigurasi dari .env
// ══════════════════════════════════════════

const path = require('path');
const fs = require('fs');

// Load .env dari root project
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Deteksi otomatis path Chrome/Chromium
function detectChromePath() {
    const candidates = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return undefined; // Biarkan puppeteer pakai bundled Chromium
}

const ROOT_DIR = path.join(__dirname, '..');

const config = {
    // ── WhatsApp Targets ──
    waAdmin: process.env.WA_ADMIN || process.env.WA_GRUP || '120363428647430557@g.us',
    waGrup: process.env.WA_GRUP || '120363428647430557@g.us',

    // ── Google Form ──
    formUrl: process.env.FORM_URL || 'https://docs.google.com/forms/d/e/1FAIpQLSfOFKn5TCtURJLCqk6msTfvyW-_Tj0RFF7CkYDy2tctozHaWA/viewform',

    // ── Cron Schedule ──
    cronSchedule: process.env.CRON_SCHEDULE || '0 8 * * *',
    cronTimezone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',

    // ── Browser ──
    chromePath: detectChromePath(),
    browserTimeout: parseInt(process.env.BROWSER_TIMEOUT) || 180000,
    formTimeout: parseInt(process.env.FORM_TIMEOUT) || 50000,
    maxRetry: parseInt(process.env.MAX_RETRY) || 3,

    // ── Paths ──
    rootDir: ROOT_DIR,
    dataDir: path.join(ROOT_DIR, 'data'),
    cookieDir: path.join(ROOT_DIR, 'cookies'),
    screenshotDir: path.join(ROOT_DIR, 'screenshots'),
    sessionDir: path.join(ROOT_DIR, 'sessions'),

    // ── File Database ──
    driverFile: path.join(ROOT_DIR, 'data', 'database_driver.json'),
    jadwalFile: path.join(ROOT_DIR, 'data', 'jadwal_libur.json'),
    userFile: path.join(ROOT_DIR, 'data', 'database_user.json'),
    walletFile: path.join(ROOT_DIR, 'data', 'database_wallet.json'),
    logFile: path.join(ROOT_DIR, 'data', 'bot.log'),

    // ── WhatsApp Auth ──
    waClientId: 'bot-ajiputra-v4',
    waAuthTimeout: 240000,

    // ── Web Dashboard ──
    webPort: parseInt(process.env.WEB_PORT) || 3000,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://autobot.ajiputra.my.id',
    jwtSecret: process.env.JWT_SECRET || 'auto-petrip-secret-ubah-ini',
    webDir: path.join(ROOT_DIR, 'public'),

    // ── Admin (bootstrap saat pertama kali) ──
    adminEmail: process.env.ADMIN_EMAIL || 'admin@autopetrip.id',
    adminPassword: process.env.ADMIN_PASSWORD || 'admin12345',
    adminName: process.env.ADMIN_NAME || 'Agung (Admin)',

    // ── Payment Gateway (AutoGoPay) ──
    autogopayApiKey: process.env.AUTOGOPAY_API_KEY || '',
    autogopayBaseUrl: process.env.AUTOGOPAY_BASE_URL || 'https://v1-gateway.autogopay.site',
    topupMin: parseInt(process.env.TOPUP_MIN) || 5000,
    topupMax: parseInt(process.env.TOPUP_MAX) || 10000000,
    topupFeePercent: parseFloat(process.env.TOPUP_FEE_PERCENT) || 0,
    pricePerAbsen: parseInt(process.env.PRICE_PER_ABSEN) || 500,

    // ── Limit Top-up (Anti-Abuse / mencegah akun terblokir) ──
    topupMaxPending: parseInt(process.env.TOPUP_MAX_PENDING) || 1,      // max order belum dibayar per user
    topupMaxDaily: parseInt(process.env.TOPUP_MAX_DAILY) || 10,         // max topup berhasil per hari per user
    topupCooldownMin: parseInt(process.env.TOPUP_COOLDOWN_MIN) || 5,    // jeda minimal antar pembuatan QRIS (menit)

    // ── Puppeteer Args ──
    puppeteerArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-quic',
        '--no-first-run',
        '--disable-extensions',
        '--mute-audio',
        '--disable-audio-output',
        '--disable-alsa',
        '--log-level=3',
        '--disable-webgl',
        '--disable-accelerated-2d-canvas',
        '--js-flags=--max-old-space-size=512',
    ],
};

module.exports = config;
