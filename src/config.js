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
    waAdmin: process.env.WA_ADMIN || '6285641858425@c.us',
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
    logFile: path.join(ROOT_DIR, 'data', 'bot.log'),

    // ── WhatsApp Auth ──
    waClientId: 'bot-ajiputra-v4',
    waAuthTimeout: 240000,

    // ── Puppeteer Args ──
    puppeteerArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-quic',
        '--no-zygote',
        '--no-first-run',
        '--disable-extensions',
    ],
};

module.exports = config;
