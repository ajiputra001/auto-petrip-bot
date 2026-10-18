// ══════════════════════════════════════════
// 🔐 LOGIN GOOGLE JARAK JAUH — /logindriver
// ══════════════════════════════════════════
//
// Driver login ke akun Google-nya sendiri dari HP, tanpa PC:
//
//   1. Bot menyalakan Chrome ASLI di layar virtual Xvfb.
//   2. Layar ditangkap ffmpeg (x11grab) dan di-stream ke halaman web bot.
//   3. Ketukan & ketikan driver diteruskan ke Chrome lewat xdotool.
//   4. Begitu form terbuka (= login sukses), Chrome ditutup, cookie dibaca
//      dari profilnya, disimpan, lalu diuji di browser absen.
//
// Kenapa serumit ini — hasil uji langsung ke server login Google:
//   • Chrome headless (dengan/tanpa stealth)      → DITOLAK
//   • Chrome berlayar + DevTools/CDP terhubung    → DITOLAK
//   • Chrome berlayar murni + input level X11     → DITERIMA
// Jadi selama login, Chrome sama sekali tidak boleh disentuh lewat CDP.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const puppeteer = require('puppeteer');
const config = require('../config');
const db = require('../database');
const logger = require('../utils/logger');
const settings = require('../settings');
const { delay } = require('../utils/helpers');
const {
    launchBrowser, tutupBrowser, createPage, bukaHalaman,
    injectCookies, simpanCookie, keFormatEkstensi, DOMAIN_RELEVAN,
} = require('./browser');

const LEBAR = 412;
const TINGGI = 860;
const FPS = 4;
const POLA_HALAMAN_LOGIN = /accounts\.google\.com\/(v3\/)?signin|ServiceLogin/i;
// Judul jendela selama masih di halaman akun Google (bukan tujuan akhir).
// Dibuat lebar sengaja: salah anggap "sukses" berarti Chrome di-restart di
// tengah verifikasi 2FA. Bila ragu, driver bisa menekan "Saya sudah login".
const POLA_JUDUL_LOGIN = /google|akun|account|login|sign.?in|masuk|verifi|keamanan|security|pemulihan|recovery|challenge|memuat|loading|about:blank|^$/i;
const PREFIX_PROFIL = '.login-';

// Nama tombol halaman web → nama keysym xdotool
const PETA_TOMBOL = {
    Enter: 'Return', Backspace: 'BackSpace', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};

/** Hanya satu sesi sekaligus: Chrome berlayar butuh RAM besar di VPS. */
let sesiAktif = null;

// ── Utilitas proses ────────────────────────────────────────────────────────

function _exec(perintah, args, env) {
    return new Promise((resolve, reject) => {
        execFile(perintah, args, { env, timeout: 15000 }, (err, stdout) => {
            if (err) return reject(err);
            resolve(String(stdout).trim());
        });
    });
}

function _bunuh(proc, sinyal = 'SIGKILL') {
    if (proc && proc.exitCode === null && proc.signalCode === null) {
        try { proc.kill(sinyal); } catch (e) { /* abaikan */ }
    }
}

/** Tutup proses dengan sopan, paksa bila tidak mau berhenti. */
async function _hentikan(proc, batasMs = 10000) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    _bunuh(proc, 'SIGTERM');
    for (let t = 0; t < batasMs && proc.exitCode === null && proc.signalCode === null; t += 200) {
        await delay(200);
    }
    _bunuh(proc, 'SIGKILL');
}

function _hapusFolder(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
}

/** Profil sementara sisa crash dibuang saat modul dimuat. */
(function _bersihkanSisa() {
    try {
        for (const nama of fs.readdirSync(config.sessionDir)) {
            if (nama.startsWith(PREFIX_PROFIL)) _hapusFolder(path.join(config.sessionDir, nama));
        }
    } catch (e) { /* folder belum ada */ }
})();

/** Pastikan alat sistem yang dibutuhkan tersedia, dengan pesan yang jelas. */
async function _cekPrasyarat() {
    const kurang = [];
    for (const [bin, paket] of [['Xvfb', 'xvfb'], ['xdotool', 'xdotool'], ['ffmpeg', 'ffmpeg']]) {
        try { await _exec('which', [bin]); } catch (e) { kurang.push(paket); }
    }
    if (kurang.length) {
        throw new Error(`Paket sistem belum terpasang: ${kurang.join(', ')}. Jalankan: sudo apt-get install -y ${kurang.join(' ')}`);
    }
    if (!config.chromePath) throw new Error('Google Chrome tidak ditemukan di server.');
}

/** Jalankan Xvfb; nomor display bebas dipilih Xvfb sendiri (-displayfd). */
function _nyalakanXvfb() {
    return new Promise((resolve, reject) => {
        const proc = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', `${LEBAR}x${TINGGI}x24`, '-nolisten', 'tcp'], {
            stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
        });
        const batas = setTimeout(() => { _bunuh(proc); reject(new Error('Xvfb tidak merespons.')); }, 10000);
        proc.on('error', (e) => { clearTimeout(batas); reject(e); });

        let buf = '';
        proc.stdio[3].on('data', (c) => {
            buf += c.toString();
            if (/^\d+\n/.test(buf)) {
                clearTimeout(batas);
                resolve({ proc, display: `:${buf.trim()}` });
            }
        });
    });
}

// ── Siaran ke halaman web ──────────────────────────────────────────────────

function _kirimSSE(res, event, data) {
    try { res.write(`event: ${event}\ndata: ${data}\n\n`); } catch (e) { /* koneksi putus */ }
}

function _infoPublik(sesi) {
    return {
        status: sesi.status,
        pesan: sesi.pesan,
        driver: sesi.driver.nama,
        sisaDetik: Math.max(0, Math.round((sesi.kedaluwarsaPada - Date.now()) / 1000)),
        email: sesi.email || null,
    };
}

function _siarkanStatus(sesi) {
    const data = JSON.stringify(_infoPublik(sesi));
    for (const res of sesi.penonton) _kirimSSE(res, 'status', data);
}

function _setStatus(sesi, status, pesan) {
    sesi.status = status;
    sesi.pesan = pesan;
    logger.info('LOGIN-GOOGLE', `[${sesi.driver.nama}] ${status}: ${pesan}`);
    _siarkanStatus(sesi);
}

// ── Penangkap layar (ffmpeg → MJPEG → SSE) ─────────────────────────────────

/**
 * ffmpeg menulis JPEG beruntun ke stdout. Setiap gambar dipotong di penanda
 * SOI (FFD8) / EOI (FFD9); di dalam data JPEG byte 0xFF selalu di-escape,
 * jadi FFD9 hanya muncul sebagai akhir gambar.
 */
function _mulaiPerekam(sesi) {
    if (sesi.ffmpeg || sesi.selesai) return;

    const proc = spawn('ffmpeg', [
        '-loglevel', 'error',
        '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(FPS),
        '-video_size', `${LEBAR}x${TINGGI}`, '-i', `${sesi.display}+0,0`,
        '-f', 'mjpeg', '-q:v', '6', '-',
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    sesi.ffmpeg = proc;

    let buf = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
            const awal = buf.indexOf(Buffer.from([0xff, 0xd8]));
            if (awal < 0) { buf = Buffer.alloc(0); break; }
            const akhir = buf.indexOf(Buffer.from([0xff, 0xd9]), awal + 2);
            if (akhir < 0) { buf = buf.subarray(awal); break; }

            const jpeg = buf.subarray(awal, akhir + 2);
            buf = buf.subarray(akhir + 2);

            // Layar diam menghasilkan JPEG identik — tidak perlu dikirim ulang.
            const sidik = crypto.createHash('md5').update(jpeg).digest('hex');
            if (sidik === sesi.sidikFrame) continue;
            sesi.sidikFrame = sidik;
            sesi.frameTerakhir = jpeg.toString('base64');
            for (const res of sesi.penonton) _kirimSSE(res, 'frame', sesi.frameTerakhir);
        }
    });
    proc.on('exit', () => { if (sesi.ffmpeg === proc) sesi.ffmpeg = null; });
}

function _hentikanPerekam(sesi) {
    _bunuh(sesi.ffmpeg);
    sesi.ffmpeg = null;
}

// ── Chrome interaktif ──────────────────────────────────────────────────────

async function _nyalakanChrome(sesi, url) {
    // Sengaja TANPA --remote-debugging-port, --enable-automation, --headless:
    // semuanya membuat Google menolak login.
    const args = [
        `--user-data-dir=${sesi.profil}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--password-store=basic', // kunci enkripsi cookie tetap, bisa dibaca ulang headless
        '--lang=id-ID',
        `--window-size=${LEBAR},${TINGGI}`,
        '--window-position=0,0',
        '--disable-dev-shm-usage',
        '--hide-crash-restore-bubble',
    ];
    // Chrome menolak berjalan sebagai root tanpa --no-sandbox (umum di VPS).
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');
    args.push(`--app=${url}`); // jendela tanpa bilah alamat/tab — murni halaman Google

    sesi.chrome = spawn(config.chromePath, args, { stdio: 'ignore', env: sesi.env });
    const proc = sesi.chrome;
    proc.on('exit', () => {
        if (sesi.chrome === proc && !sesi.selesai && !sesi.sedangMenyimpan) {
            _setStatus(sesi, 'gagal', 'Browser login berhenti tiba-tiba.');
            _akhiri(sesi, 'gagal', 'Browser login berhenti tiba-tiba.');
        }
    });

    // Tunggu jendela muncul, lalu beri fokus keyboard
    for (let i = 0; i < 40; i++) {
        await delay(500);
        try {
            const id = (await _exec('xdotool', ['search', '--onlyvisible', '--class', 'chrome'], sesi.env)).split('\n')[0];
            if (id) {
                sesi.idJendela = id;
                await _exec('xdotool', ['windowfocus', '--sync', id], sesi.env).catch(() => {});
                return;
            }
        } catch (e) { /* jendela belum ada */ }
    }
    throw new Error('Jendela Chrome tidak muncul dalam 20 detik.');
}

async function _judulJendela(sesi) {
    if (!sesi.idJendela) return '';
    return _exec('xdotool', ['getwindowname', sesi.idJendela], sesi.env).catch(() => '');
}

// ── Penyimpanan cookie ─────────────────────────────────────────────────────

function _sudahLogin(cookies) {
    const nama = new Set(cookies.map(c => c.name));
    return nama.has('SID') && nama.has('__Secure-1PSID');
}

async function _bacaEmail(page) {
    try {
        const teks = await page.evaluate(() => document.body.innerText || '');
        const cocok = teks.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        return cocok ? cocok[0] : null;
    } catch (e) {
        return null;
    }
}

/**
 * Buka profil hasil login di Chrome headless, lalu buka form untuk
 * memastikan sesi sah & memancing cookie khusus Docs ikut terbentuk.
 * @returns {Promise<{cookies: Object[], email: string|null}|null>} null bila belum login
 */
async function _panenCookie(sesi) {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            userDataDir: sesi.profil,
            executablePath: config.chromePath,
            args: [...config.puppeteerArgs, '--password-store=basic'],
            timeout: 90000,
        });
        const page = await createPage(browser);
        await bukaHalaman(page, settings.getFormUrl(), config.formTimeout);
        if (POLA_HALAMAN_LOGIN.test(page.url())) return null;

        const cookies = (await browser.cookies())
            .filter(c => c && c.name && DOMAIN_RELEVAN.test(String(c.domain).replace(/^\./, '')));
        if (!_sudahLogin(cookies)) return null;

        return { cookies, email: await _bacaEmail(page) };
    } finally {
        await tutupBrowser(browser);
    }
}

/** Tulis cookie ke berkas driver secara atomik; berkas lama dicadangkan. */
function _tulisCookie(cookiePath, cookies) {
    fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
    const cadangan = fs.existsSync(cookiePath) ? `${cookiePath}.sebelum-login` : null;
    if (cadangan) fs.copyFileSync(cookiePath, cadangan);

    const tmp = `${cookiePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cookies.map(keFormatEkstensi), null, 2), 'utf8');
    fs.renameSync(tmp, cookiePath);
    return cadangan;
}

/**
 * Uji berkas cookie persis seperti absen harian: profil kosong + injeksi.
 * Token hasil rotasi saat uji langsung disimpan kembali.
 */
async function _ujiCookie(driver, cookiePath) {
    const profil = path.join(config.sessionDir, `${PREFIX_PROFIL}uji-${driver.id}-${Date.now()}`);
    let browser = null;
    try {
        browser = await launchBrowser(profil, 1);
        const page = await createPage(browser);
        await injectCookies(page, cookiePath);
        await bukaHalaman(page, settings.getFormUrl(), config.formTimeout);
        const lolos = !POLA_HALAMAN_LOGIN.test(page.url());
        if (lolos) await simpanCookie(browser, cookiePath, driver.nama);
        return lolos;
    } finally {
        await tutupBrowser(browser);
        _hapusFolder(profil);
    }
}

/**
 * Tutup Chrome login, panen cookie, simpan, uji.
 * @param {Object} sesi
 * @param {boolean} manual - dipicu tombol "Saya sudah login" di halaman web
 */
async function _selesaikanLogin(sesi, manual = false) {
    if (sesi.sedangMenyimpan || sesi.selesai) return;
    sesi.sedangMenyimpan = true;
    _setStatus(sesi, 'menyimpan', 'Memeriksa login & mengamankan sesi...');

    const { driver } = sesi;
    const cookiePath = db.getCookiePath(driver);

    try {
        // Profil Chrome hanya bisa dibuka satu proses; cookie juga baru
        // di-flush ke disk saat Chrome keluar dengan normal (SIGTERM).
        _hentikanPerekam(sesi);
        const chrome = sesi.chrome;
        sesi.chrome = null;
        await _hentikan(chrome);

        const panen = await _panenCookie(sesi);
        if (!panen) {
            // Belum login: buka lagi Chrome-nya supaya driver bisa melanjutkan.
            sesi.sedangMenyimpan = false;
            const urlLogin = 'https://accounts.google.com/ServiceLogin?hl=id&continue=' + encodeURIComponent(settings.getFormUrl());
            await _nyalakanChrome(sesi, urlLogin);
            if (sesi.penonton.size) _mulaiPerekam(sesi);
            _setStatus(sesi, 'login', manual
                ? 'Login belum terdeteksi. Selesaikan login sampai formulir terbuka.'
                : 'Lanjutkan login dengan akun Google driver.');
            return;
        }

        sesi.email = panen.email;
        sesi.jumlahCookie = panen.cookies.length;
        const cadangan = _tulisCookie(cookiePath, panen.cookies);

        // Profil absen lama berisi token yang sudah dicabut Google; dibuang
        // agar tidak bertabrakan dengan cookie baru (kecuali sedang dipakai).
        const { sedangAbsen } = require('./form-filler');
        if (!sedangAbsen()) _hapusFolder(db.getSessionPath(driver));

        _setStatus(sesi, 'menyimpan', 'Login berhasil! Menguji cookie di mesin absen...');
        if (!await _ujiCookie(driver, cookiePath)) {
            if (cadangan) fs.copyFileSync(cadangan, cookiePath);
            throw new Error('Cookie tersimpan tetapi ditolak saat diuji di mesin absen. Cookie lama dikembalikan.');
        }
        if (cadangan) _hapusFolder(cadangan);

        _setStatus(sesi, 'sukses', 'Selesai! Cookie tersimpan & lolos uji. Halaman ini boleh ditutup.');
        await _akhiri(sesi, 'sukses');
    } catch (e) {
        _setStatus(sesi, 'gagal', e.message);
        await _akhiri(sesi, 'gagal', e.message);
    }
}

/** Dipanggil berkala: cek waktu habis & apakah form sudah terbuka. */
async function _pantau(sesi) {
    if (sesi.selesai || sesi.sedangMenyimpan) return;

    if (Date.now() > sesi.kedaluwarsaPada) {
        _setStatus(sesi, 'kedaluwarsa', 'Waktu habis. Minta link baru ke admin.');
        return _akhiri(sesi, 'kedaluwarsa');
    }

    // Judul jendela = judul halaman. Setelah login sukses Google mengarahkan
    // ke formulir, yang judulnya bukan judul halaman akun Google.
    const judul = await _judulJendela(sesi);
    if (judul && judul !== sesi.judulTerakhir) {
        sesi.judulTerakhir = judul;
        logger.debug('LOGIN-GOOGLE', `[${sesi.driver.nama}] halaman: ${judul}`);
    }
    // Judul yang pernah gagal diperiksa tidak memicu ulang (cegah loop restart).
    if (sesi.status === 'login' && judul && !POLA_JUDUL_LOGIN.test(judul.trim())
        && judul !== sesi.judulGagal) {
        sesi.judulGagal = judul;
        return _selesaikanLogin(sesi);
    }
}

// ── Siklus hidup sesi ──────────────────────────────────────────────────────

async function _bereskanProses(sesi) {
    clearInterval(sesi.pemantau);
    sesi.pemantau = null;
    _hentikanPerekam(sesi);
    await _hentikan(sesi.chrome, 3000);
    sesi.chrome = null;
    _bunuh(sesi.xvfb);
    await delay(300);
    _hapusFolder(sesi.profil);
}

async function _akhiri(sesi, hasil, alasan = '') {
    if (sesi.selesai) return;
    sesi.selesai = true;
    await _bereskanProses(sesi);

    // Beri waktu halaman web menerima status terakhir sebelum koneksi ditutup
    setTimeout(() => {
        for (const res of sesi.penonton) { try { res.end(); } catch (e) { /* abaikan */ } }
        sesi.penonton.clear();
    }, 3000);

    if (sesiAktif === sesi) sesiAktif = null;

    if (typeof sesi.onSelesai === 'function') {
        try {
            await sesi.onSelesai({
                hasil, alasan,
                driver: sesi.driver,
                email: sesi.email || null,
                jumlahCookie: sesi.jumlahCookie || 0,
                durasiDetik: Math.round((Date.now() - sesi.dimulaiPada) / 1000),
            });
        } catch (e) {
            logger.warn('LOGIN-GOOGLE', `Callback selesai gagal: ${e.message}`);
        }
    }
}

/**
 * Mulai sesi login jarak jauh untuk satu driver.
 * @param {Object} driver
 * @param {{ onSelesai?: Function, onPenontonMasuk?: Function, dimintaOleh?: string }} opsi
 * @returns {Promise<{ token: string, url: string, menit: number }>}
 */
async function mulaiSesi(driver, opsi = {}) {
    if (sesiAktif) {
        throw new Error(`Masih ada sesi login untuk ${sesiAktif.driver.nama}. Tunggu selesai atau ketik /batallogin.`);
    }
    await _cekPrasyarat();

    const menit = config.loginRemoteTimeoutMin;
    const sesi = {
        token: crypto.randomBytes(24).toString('base64url'),
        driver,
        profil: path.join(config.sessionDir, `${PREFIX_PROFIL}${driver.id}-${Date.now()}`),
        status: 'menunggu',
        pesan: 'Menyiapkan browser...',
        dimulaiPada: Date.now(),
        kedaluwarsaPada: Date.now() + menit * 60 * 1000,
        penonton: new Set(),
        onSelesai: opsi.onSelesai,
        onPenontonMasuk: opsi.onPenontonMasuk,
        dimintaOleh: opsi.dimintaOleh || '-',
    };
    sesiAktif = sesi;

    try {
        fs.mkdirSync(sesi.profil, { recursive: true });
        const { proc, display } = await _nyalakanXvfb();
        sesi.xvfb = proc;
        sesi.display = display;
        sesi.env = { ...process.env, DISPLAY: display };

        const urlLogin = 'https://accounts.google.com/ServiceLogin?hl=id&continue=' + encodeURIComponent(settings.getFormUrl());
        await _nyalakanChrome(sesi, urlLogin);

        _setStatus(sesi, 'menunggu', 'Menunggu driver membuka link...');
        sesi.pemantau = setInterval(() => { _pantau(sesi).catch(() => {}); }, 2000);
    } catch (e) {
        sesi.selesai = true;
        await _bereskanProses(sesi);
        if (sesiAktif === sesi) sesiAktif = null;
        throw e;
    }

    const url = `${String(config.publicBaseUrl).replace(/\/+$/, '')}/login-google/${sesi.token}`;
    logger.success('LOGIN-GOOGLE', `Sesi login ${driver.nama} dibuka (${menit} menit).`);
    return { token: sesi.token, url, menit };
}

/** Batalkan sesi aktif. @returns {Object|null} driver yang dibatalkan */
async function batalkanSesi(alasan = 'Dibatalkan admin.') {
    const sesi = sesiAktif;
    if (!sesi) return null;
    _setStatus(sesi, 'dibatalkan', alasan);
    await _akhiri(sesi, 'dibatalkan', alasan);
    return sesi.driver;
}

/** Ringkasan sesi aktif untuk ditampilkan di WA. */
function infoSesiAktif() {
    if (!sesiAktif) return null;
    return { ..._infoPublik(sesiAktif), penonton: sesiAktif.penonton.size, dimintaOleh: sesiAktif.dimintaOleh };
}

function _sesiDariToken(token) {
    if (!sesiAktif || !token) return null;
    const a = Buffer.from(String(token));
    const b = Buffer.from(sesiAktif.token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return sesiAktif;
}

// ── Handler HTTP (dipanggil dari server.js) ────────────────────────────────

/** GET /api/login-google/:token/stream — Server-Sent Events: frame & status. */
function tanganiStream(token, req, res) {
    const sesi = _sesiDariToken(token);
    if (!sesi || sesi.selesai) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Link tidak berlaku atau sudah kedaluwarsa.' }));
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // supaya nginx tidak menahan frame
    });
    res.write('retry: 3000\n\n');

    const pertamaKali = !sesi.pernahDibuka;
    sesi.pernahDibuka = true;
    sesi.penonton.add(res);
    if (sesi.chrome) _mulaiPerekam(sesi);

    _kirimSSE(res, 'status', JSON.stringify(_infoPublik(sesi)));
    if (sesi.frameTerakhir) _kirimSSE(res, 'frame', sesi.frameTerakhir);

    const detak = setInterval(() => _kirimSSE(res, 'status', JSON.stringify(_infoPublik(sesi))), 15000);
    req.on('close', () => {
        clearInterval(detak);
        sesi.penonton.delete(res);
        // Tidak ada yang menonton → hentikan ffmpeg supaya CPU VPS tidak terbuang
        if (sesi.penonton.size === 0) _hentikanPerekam(sesi);
    });

    if (pertamaKali) {
        _setStatus(sesi, 'login', 'Silakan login dengan akun Google driver.');
        if (typeof sesi.onPenontonMasuk === 'function') {
            Promise.resolve(sesi.onPenontonMasuk(sesi.driver)).catch(() => {});
        }
    }
}

/** POST /api/login-google/:token/input — klik, ketik, tombol, gulir, navigasi. */
async function tanganiInput(token, body) {
    const sesi = _sesiDariToken(token);
    if (!sesi || sesi.selesai) return { success: false, error: 'Sesi tidak aktif.' };
    if (sesi.sedangMenyimpan) return { success: false, error: 'Sedang memeriksa login, tunggu sebentar.' };
    if (!sesi.chrome) return { success: false, error: 'Browser belum siap.' };

    const xdo = (...args) => _exec('xdotool', args, sesi.env);
    const pas = (n) => Math.min(1, Math.max(0, Number(n) || 0));

    switch (body && body.type) {
        case 'click': {
            const x = Math.round(pas(body.fx) * (LEBAR - 1));
            const y = Math.round(pas(body.fy) * (TINGGI - 1));
            await xdo('mousemove', String(x), String(y), 'click', '1');
            break;
        }
        case 'text': {
            const teks = String(body.text || '').replace(/[\r\n]/g, '').slice(0, 500);
            if (!teks) break;
            // '--' mencegah teks yang diawali '-' dibaca sebagai opsi xdotool.
            // execFile tidak memakai shell, jadi tidak ada risiko injeksi.
            if (sesi.idJendela) await xdo('windowfocus', '--sync', sesi.idJendela).catch(() => {});
            await xdo('type', '--delay', '45', '--', teks);
            break;
        }
        case 'key': {
            const keysym = PETA_TOMBOL[body.key];
            if (!keysym) return { success: false, error: 'Tombol tidak dikenal.' };
            await xdo('key', keysym);
            break;
        }
        case 'scroll': {
            const dy = Number(body.dy) || 0;
            const kali = Math.min(10, Math.max(1, Math.round(Math.abs(dy) / 120)));
            await xdo('mousemove', String(LEBAR / 2), String(TINGGI / 2));
            await xdo('click', '--repeat', String(kali), '--delay', '30', dy > 0 ? '5' : '4');
            break;
        }
        case 'nav': {
            if (body.aksi === 'back') await xdo('key', 'alt+Left');
            else if (body.aksi === 'reload') await xdo('key', 'F5');
            else return { success: false, error: 'Aksi navigasi tidak dikenal.' };
            break;
        }
        case 'selesai': {
            _selesaikanLogin(sesi, true).catch(() => {});
            break;
        }
        default:
            return { success: false, error: 'Jenis input tidak dikenal.' };
    }
    return { success: true };
}

/** Bersihkan proses anak bila bot dimatikan, supaya tidak ada Chrome yatim. */
process.on('exit', () => {
    if (sesiAktif) {
        _bunuh(sesiAktif.ffmpeg);
        _bunuh(sesiAktif.chrome);
        _bunuh(sesiAktif.xvfb);
    }
});

module.exports = {
    mulaiSesi,
    batalkanSesi,
    infoSesiAktif,
    tanganiStream,
    tanganiInput,
};
