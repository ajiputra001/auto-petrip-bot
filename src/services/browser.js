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
    // Tanpa viewport eksplisit, Chrome headless memakai 800x600. Form K3 jadi
    // terlalu sempit sehingga tombol/field sering tertutup & klik meleset.
    await page.setViewport({ width: 1366, height: 900 });
    return page;
}

/**
 * Buka URL dengan retry. Google kadang memutus koneksi (ERR_CONNECTION_CLOSED)
 * saat beberapa sesi membuka form berurutan dari IP VPS yang sama.
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {number} timeout
 * @param {number} percobaan
 */
async function bukaHalaman(page, url, timeout, percobaan = 3) {
    let lastError;
    for (let i = 1; i <= percobaan; i++) {
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout });
            return;
        } catch (error) {
            lastError = error;
            logger.warn('BROWSER', `Gagal membuka form (percobaan ${i}/${percobaan}): ${error.message}`);
            if (i < percobaan) await delay(i * 4000);
        }
    }
    throw new Error(`Tidak bisa membuka Google Form: ${lastError.message}`);
}

/**
 * Tutup dialog/overlay yang menghalangi klik.
 *
 * Google Form kini menyimpan draf jawaban otomatis. Bila akun yang sama membuka
 * form di dua sesi, muncul dialog "Progres disimpan — Perbarui ke draf terbaru".
 * Dialog ini menangkap semua pointer event, sehingga klik Puppeteer gagal dengan
 * "Node is either not clickable" lalu alur berikutnya ikut timeout.
 *
 * Tombol "Perbarui" sengaja TIDAK diklik: itu akan memuat draf sesi lain dan
 * menimpa data driver yang sedang diisi. Dialog cukup ditutup.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>} true bila ada dialog yang ditutup
 */
async function tutupDialogGangguan(page) {
    try {
        const adaDialog = await page.evaluate(() =>
            !!document.querySelector('[role="dialog"], [role="alertdialog"]')
        );
        if (!adaDialog) return false;

        await page.keyboard.press('Escape');
        await delay(800);

        // Escape tidak selalu menutup dialog draf → buang node-nya beserta
        // backdrop agar halaman bisa diklik lagi.
        const sisa = await page.evaluate(() => {
            let dibuang = 0;
            document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((d) => {
                const teks = d.innerText || '';
                if (/progres disimpan|draf|draft/i.test(teks)) {
                    d.remove();
                    dibuang++;
                }
            });
            // Backdrop gelap yang tetap menutupi layar setelah dialog hilang
            document.querySelectorAll('div').forEach((el) => {
                const s = getComputedStyle(el);
                if (
                    s.position === 'fixed' &&
                    parseInt(s.zIndex || '0', 10) > 100 &&
                    el.clientHeight >= window.innerHeight * 0.9 &&
                    !el.querySelector('input, [role="button"], [role="radio"], [role="checkbox"]')
                ) {
                    el.remove();
                    dibuang++;
                }
            });
            return dibuang;
        });

        if (sisa > 0) logger.debug('BROWSER', `${sisa} overlay draf Google Form ditutup.`);
        return true;
    } catch (e) {
        return false;
    }
}

// Properti khas ekspor ekstensi browser yang tidak dikenal CDP.
const FIELD_EKSTENSI = [
    'expirationDate', 'session', 'hostOnly', 'storeId', 'id',
    'sourceOrigin', 'sameParty', 'sourceScheme', 'sourcePort',
];

const PETA_SAME_SITE = {
    'no_restriction': 'None',
    'none': 'None',
    'lax': 'Lax',
    'strict': 'Strict',
};

// Hanya cookie domain Google yang relevan untuk Google Form. Membatasi di sini
// menjaga berkas cookie tetap ramping saat disimpan ulang.
const DOMAIN_RELEVAN = /(^|\.)(google\.com|googleusercontent\.com|gstatic\.com)$/i;

/**
 * Ubah satu cookie hasil ekspor ekstensi menjadi bentuk yang dimengerti CDP.
 *
 * Ekstensi (EditThisCookie, Cookie-Editor, dsb) menulis masa berlaku pada field
 * `expirationDate`, sedangkan Puppeteer/CDP hanya membaca `expires`. Tanpa
 * konversi ini SETIAP cookie masuk sebagai *session cookie*: hilang begitu
 * Chrome ditutup dan tidak pernah ikut tersimpan ke profil — akar masalah
 * "cookie minta diperbarui lagi besoknya".
 *
 * @param {Object} c
 * @returns {Object}
 */
function _sanitasiCookie(c) {
    const cookie = { ...c };

    if (cookie.sameSite) {
        const normalized = PETA_SAME_SITE[String(cookie.sameSite).toLowerCase()];
        if (normalized) {
            cookie.sameSite = normalized;
        } else {
            delete cookie.sameSite;
        }
    }

    if (cookie.expires === undefined && typeof cookie.expirationDate === 'number') {
        cookie.expires = Math.floor(cookie.expirationDate);
    }

    // Cookie yang memang bertipe sesi tidak boleh diberi masa berlaku palsu.
    if (cookie.session === true) delete cookie.expires;

    for (const field of FIELD_EKSTENSI) delete cookie[field];

    return cookie;
}

/**
 * Kembalikan cookie ke format ekspor ekstensi, supaya berkas hasil simpan
 * otomatis tetap bisa ditukar/diedit manual seperti berkas aslinya.
 * @param {Object} c - cookie dari browser.cookies()
 * @returns {Object}
 */
function _keFormatEkstensi(c) {
    const persisten = typeof c.expires === 'number' && c.expires > 0;
    return {
        domain: c.domain,
        ...(persisten ? { expirationDate: c.expires } : {}),
        hostOnly: !String(c.domain || '').startsWith('.'),
        httpOnly: !!c.httpOnly,
        name: c.name,
        path: c.path || '/',
        sameSite: c.sameSite || 'no_restriction',
        secure: !!c.secure,
        session: !persisten,
        storeId: '0',
        value: c.value,
    };
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

    const safeCookies = rawCookies
        .filter(c => c !== null && typeof c === 'object' && c.name && c.domain)
        .map(_sanitasiCookie);

    if (safeCookies.length === 0) {
        throw new Error('Cookie kosong setelah sanitasi.');
    }

    // Lewat browser context, bukan page.setCookie(): page.setCookie() menghapus
    // cookie bernama sama lebih dulu, sehingga token hasil rotasi Google yang
    // sudah tersimpan di profil ikut terbuang sebelum sempat dipakai.
    await page.browserContext().setCookie(...safeCookies);

    const persisten = safeCookies.filter(c => typeof c.expires === 'number' && c.expires > 0).length;
    logger.debug('BROWSER', `${safeCookies.length} cookie disuntikkan (${persisten} persisten, ${safeCookies.length - persisten} sesi).`);
}

/**
 * Simpan ulang cookie terbaru dari browser ke berkas.
 *
 * Google merotasi token `__Secure-1PSIDTS`/`__Secure-3PSIDTS`/`SIDCC` secara
 * berkala. Nilai hasil rotasi hanya hidup di dalam profil Chrome; bila tidak
 * ditulis kembali ke berkas, injeksi hari berikutnya memakai token lama yang
 * sudah dicabut Google → redirect ke halaman login → bot melapor "Cookie
 * kedaluwarsa" walau cookie baru saja diperbarui.
 *
 * Penulisan bersifat atomik (tulis sementara lalu rename) agar berkas cookie
 * tidak pernah korup bila proses mati di tengah penyimpanan.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} cookiePath
 * @param {string} label - nama driver, untuk log
 * @returns {Promise<boolean>} true bila berkas diperbarui
 */
async function simpanCookie(browser, cookiePath, label = 'BROWSER') {
    try {
        const segar = (await browser.cookies())
            .filter(c => c && c.name && DOMAIN_RELEVAN.test(String(c.domain).replace(/^\./, '')));

        // Tanpa cookie login inti, sesi di browser sudah logout. Menyimpannya
        // justru akan menimpa berkas yang masih baik dengan cookie kosong.
        if (!segar.some(c => c.name === 'SID' || c.name === '__Secure-1PSID')) {
            logger.debug(label, 'Cookie tidak disimpan: sesi Google di browser tidak lengkap.');
            return false;
        }

        // Gabung dengan isi berkas lama supaya cookie yang tidak ikut terpasang
        // di profil (mis. ditolak Chrome) tidak hilang dari berkas.
        const kunci = (c) => `${c.name}|${c.domain}|${c.path || '/'}`;
        const gabungan = new Map();
        for (const c of bacaJSON(cookiePath) || []) {
            if (c && c.name && c.domain) gabungan.set(kunci(c), c);
        }
        for (const c of segar) gabungan.set(kunci(c), _keFormatEkstensi(c));

        const tmpPath = `${cookiePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify([...gabungan.values()], null, 2), 'utf8');
        fs.renameSync(tmpPath, cookiePath);

        logger.debug(label, `Cookie diperbarui otomatis (${gabungan.size} entri tersimpan).`);
        return true;
    } catch (e) {
        // Kegagalan menyimpan tidak boleh menggagalkan absen yang sudah sukses.
        logger.warn(label, `Gagal menyimpan cookie terbaru: ${e.message}`);
        return false;
    }
}

/**
 * Klik tombol berdasarkan teks (mendukung Bahasa Indonesia & Inggris)
 * @param {import('puppeteer').Page} page
 * @param {string} teksIndo - Teks tombol dalam Bahasa Indonesia
 * @param {string} teksInggris - Teks tombol dalam Bahasa Inggris
 * @param {number} timeout - Timeout dalam ms
 */
async function klikTombolTeks(page, teksIndo, teksInggris, timeout = 45000) {
    // Dialog draf bisa muncul kapan saja & memblokir klik → bersihkan dulu.
    await tutupDialogGangguan(page);

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
                try {
                    await btn.click({ delay: 50 });
                } catch (e) {
                    // "Node is either not clickable" = masih ada overlay.
                    // Bersihkan lalu klik lewat JS yang menembus hit-testing.
                    await tutupDialogGangguan(page);
                    await page.evaluate(el => el.click(), btn);
                }
                return true;
            }
        } catch (e) {
            // Element mungkin sudah stale, lanjutkan
        }
    }

    throw new Error(`Tombol "${teksIndo}" ditemukan tapi gagal diklik.`);
}

/**
 * Klik elemen (radio/checkbox) berdasarkan daftar aria-label yang mungkin.
 * @param {import('puppeteer').Page} page
 * @param {string[]} labels - kandidat aria-label, dicoba berurutan
 * @returns {Promise<boolean>} true bila ada yang terklik
 */
async function klikAriaLabel(page, labels) {
    for (const label of labels) {
        const el = await page.$(`div[aria-label="${label}"]`);
        if (!el) continue;
        // Klik bisa tertelan overlay/dialog draf tanpa error. Bukti sah
        // hanya aria-checked="true"; ulangi sampai tercentang.
        for (let i = 0; i < 4; i++) {
            try {
                if (await page.evaluate(e => e.getAttribute('aria-checked') === 'true', el)) return true;
                await page.evaluate(e => e.scrollIntoView({ block: 'center' }), el);
                await delay(300);
                try {
                    await el.click();
                } catch (e) {
                    await tutupDialogGangguan(page);
                    await page.evaluate(e2 => e2.click(), el);
                }
                await delay(500);
            } catch (e) {
                break; // elemen stale → coba label berikutnya
            }
        }
        if (await page.evaluate(e => e.getAttribute('aria-checked') === 'true', el).catch(() => false)) return true;
    }
    return false;
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
    try {
        await element.click({ clickCount: 3 });
    } catch (e) {
        await tutupDialogGangguan(page);
        await element.click({ clickCount: 3 });
    }
    await page.keyboard.press('Backspace');

    // Ketik karakter per karakter dengan delay random
    for (const char of String(teks)) {
        await element.type(char);
        await delay(Math.floor(Math.random() * 50) + 30);
    }

    // Verifikasi isi field benar-benar masuk. Bila form me-reset halaman
    // (konflik draf), nilai bisa kosong/tercampur field lain.
    const nilai = await page.evaluate(el => el.value, element);
    if (nilai.trim() !== String(teks).trim()) {
        throw new Error(`Input tidak sesuai (diharapkan "${teks}", terbaca "${nilai}"). Halaman form kemungkinan ter-reset.`);
    }
}

module.exports = {
    launchBrowser,
    tutupBrowser,
    createPage,
    bukaHalaman,
    injectCookies,
    simpanCookie,
    keFormatEkstensi: _keFormatEkstensi,
    DOMAIN_RELEVAN,
    tutupDialogGangguan,
    klikTombolTeks,
    klikAriaLabel,
    ketikAman,
};
