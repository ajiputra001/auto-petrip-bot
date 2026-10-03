// ══════════════════════════════════════════
// 🌐 BROWSER — Launcher & Cookie Manager
// ══════════════════════════════════════════

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { delay, bacaJSON, withTimeout } = require('../utils/helpers');

puppeteer.use(StealthPlugin());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const LAUNCH_TIMEOUT_MS = 90000;
const CLOSE_TIMEOUT_MS = 15000;

/**
 * Hapus lock sisa crash agar Chrome mau memakai ulang userDataDir.
 * Tanpa ini, satu kali crash bisa membuat semua absen berikutnya gagal launch.
 * @param {string} sessionPath
 */
function _bersihkanLockSession(sessionPath) {
    if (!sessionPath) return;
    for (const nama of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        try {
            const target = path.join(sessionPath, nama);
            if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
                fs.rmSync(target, { force: true, recursive: true });
            }
        } catch (e) { /* abaikan */ }
    }
}

/**
 * Launch browser instance dengan retry mechanism
 * @param {string} sessionPath - Path untuk user data directory
 * @param {number} retryCount - Jumlah retry (default dari config)
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function launchBrowser(sessionPath, retryCount = config.maxRetry) {
    let lastError;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            logger.info('BROWSER', `Launching Chrome (attempt ${attempt}/${retryCount})...`);

            _bersihkanLockSession(sessionPath);

            // puppeteer.launch bisa menggantung tanpa throw bila VPS kehabisan
            // memori saat fork Chrome → bungkus timeout agar retry tetap jalan.
            const browser = await withTimeout(
                puppeteer.launch({
                    headless: 'new',
                    userDataDir: sessionPath,
                    executablePath: config.chromePath,
                    timeout: LAUNCH_TIMEOUT_MS,
                    protocolTimeout: config.browserTimeout,
                    args: config.puppeteerArgs,
                    dumpio: false,
                }),
                LAUNCH_TIMEOUT_MS,
                'puppeteer.launch'
            );

            logger.success('BROWSER', 'Chrome berhasil diluncurkan.');
            return browser;

        } catch (error) {
            lastError = error;
            logger.warn('BROWSER', `Attempt ${attempt} gagal: ${error.message}`);

            if (attempt < retryCount) {
                const waitTime = attempt * 3000; // Progressive delay
                logger.info('BROWSER', `Menunggu ${waitTime / 1000}s sebelum retry...`);
                await delay(waitTime);
            }
        }
    }

    throw new Error(`Gagal meluncurkan browser setelah ${retryCount} percobaan: ${lastError.message}`);
}

/**
 * Tutup browser secara pasti. `browser.close()` bisa menggantung di VPS dan
 * meninggalkan proses Chrome zombie yang menumpuk sampai memori VPS habis —
 * penyebab utama bot "lama-lama mati". Jadi: close berbatas waktu, lalu SIGKILL.
 * @param {import('puppeteer').Browser|null} browser
 */
async function tutupBrowser(browser) {
    if (!browser) return;

    const proc = typeof browser.process === 'function' ? browser.process() : null;

    try {
        await withTimeout(browser.close(), CLOSE_TIMEOUT_MS, 'browser.close');
    } catch (e) {
        logger.warn('BROWSER', `browser.close() gagal/timeout: ${e.message}. Memaksa kill proses Chrome.`);
    }

    // Pastikan benar-benar mati walau close() sukses tapi proses masih tersisa.
    if (proc && proc.pid && proc.exitCode === null && !proc.killed) {
        try {
            proc.kill('SIGKILL');
            logger.debug('BROWSER', `Proses Chrome PID ${proc.pid} di-SIGKILL.`);
        } catch (e) { /* abaikan */ }
    }
}

/**
 * Buat halaman baru dengan user agent
 * @param {import('puppeteer').Browser} browser
 * @returns {Promise<import('puppeteer').Page>}
 */
async function createPage(browser) {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    return page;
}

/**
 * Baca, validasi, dan injeksi cookie ke halaman
 * @param {import('puppeteer').Page} page
 * @param {string} cookiePath - Path ke file cookie JSON
 */
async function injectCookies(page, cookiePath) {
    if (!fs.existsSync(cookiePath)) {
        throw new Error(`File cookie tidak ditemukan: ${cookiePath}`);
    }

    const rawCookies = bacaJSON(cookiePath);
    if (!rawCookies || !Array.isArray(rawCookies)) {
        throw new Error('Format cookie tidak valid (bukan array JSON).');
    }

    // Sanitasi cookie agar kompatibel dengan Puppeteer
    const safeCookies = rawCookies
        .filter(c => c !== null && typeof c === 'object')
        .map(c => {
            const cookie = { ...c };

            // Normalisasi sameSite
            const sameSiteMap = {
                'no_restriction': 'None',
                'none': 'None',
                'lax': 'Lax',
                'strict': 'Strict',
            };

            if (cookie.sameSite) {
                const normalized = sameSiteMap[cookie.sameSite.toLowerCase()];
                if (normalized) {
                    cookie.sameSite = normalized;
                } else {
                    delete cookie.sameSite;
                }
            }

            // Hapus properti non-standard
            delete cookie.sourceOrigin;
            delete cookie.sameParty;
            delete cookie.sourceScheme;
            delete cookie.sourcePort;

            return cookie;
        });

    if (safeCookies.length === 0) {
        throw new Error('Cookie kosong setelah sanitasi.');
    }

    await page.setCookie(...safeCookies);
    logger.debug('BROWSER', `${safeCookies.length} cookie berhasil disuntikkan.`);
}

/**
 * Klik tombol berdasarkan teks (mendukung Bahasa Indonesia & Inggris)
 * @param {import('puppeteer').Page} page
 * @param {string} teksIndo - Teks tombol dalam Bahasa Indonesia
 * @param {string} teksInggris - Teks tombol dalam Bahasa Inggris
 * @param {number} timeout - Timeout dalam ms
 */
async function klikTombolTeks(page, teksIndo, teksInggris, timeout = 45000) {
    // Tunggu tombol muncul
    await page.waitForFunction(
        (t1, t2) => {
            const btns = Array.from(document.querySelectorAll('div[role="button"], span'));
            return btns.some(b => b.innerText && (b.innerText.trim() === t1 || b.innerText.trim() === t2));
        },
        { timeout },
        teksIndo,
        teksInggris
    );

    // Cari dan klik
    const btns = await page.$$('div[role="button"], span');
    for (const btn of btns) {
        try {
            const text = await page.evaluate(el => el.innerText, btn);
            if (text && (text.trim() === teksIndo || text.trim() === teksInggris)) {
                await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), btn);
                await delay(800);
                await btn.click({ delay: 50 });
                return;
            }
        } catch (e) {
            // Element mungkin sudah stale, lanjutkan
        }
    }
}

/**
 * Ketik teks dengan delay natural (anti-bot detection)
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').ElementHandle} element
 * @param {string} teks
 */
async function ketikAman(page, element, teks) {
    await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), element);
    await delay(500);

    // Clear existing content
    await element.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');

    // Ketik karakter per karakter dengan delay random
    for (const char of teks) {
        await element.type(char);
        await delay(Math.floor(Math.random() * 50) + 30);
    }
}

module.exports = {
    launchBrowser,
    tutupBrowser,
    createPage,
    injectCookies,
    klikTombolTeks,
    ketikAman,
};
