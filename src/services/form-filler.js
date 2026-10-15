// ══════════════════════════════════════════
// 🎯 FORM FILLER — Core Google Form Engine
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');
const logger = require('../utils/logger');
const { delay, generateNamaScreenshot, hapusFileAman, formatRupiah, withTimeout } = require('../utils/helpers');
const { kartu, kode, tebal, miring, cabang } = require('../utils/tampilan');
const {
    launchBrowser,
    tutupBrowser,
    createPage,
    bukaHalaman,
    injectCookies,
    tutupDialogGangguan,
    klikTombolTeks,
    klikAriaLabel,
    ketikAman,
} = require('./browser');
const { generasiRingkasanAI } = require('./ai-summary');
const ProgressTracker = require('./progress');
const wallet = require('../wallet');
const auth = require('../auth');
const { getSenderWa } = require('../commands/akun');
const settings = require('../settings');

// Batas waktu maksimal pengisian form untuk SATU driver
const DRIVER_TIMEOUT_MS = 8 * 60 * 1000;

// Pengiriman pesan WA ke grup/driver
const KIRIM_TIMEOUT_MS = 30000;
const KIRIM_MAX_PERCOBAAN = 3;

// ── Kunci siklus absen ──
// Google Form kini menyimpan draf jawaban per akun Google. Bila dua siklus
// (misal /absenmanual + catch-up cron) berjalan bersamaan, kedua sesi saling
// menimpa draf: halaman ter-reset ke awal, klik diblokir dialog "Progres
// disimpan", lalu muncul "Waiting for selector ... failed" / "45000ms exceeded".
// Satu siklus pada satu waktu = syarat wajib agar form terkirim.
let siklusBerjalan = false;

/**
 * Kirim pesan WA dengan timeout & retry.
 * `sendMessage` bisa MENGGANTUNG tanpa throw di VPS (frame WA Web detached).
 * Tanpa timeout, pengiriman rekap tidak pernah selesai dan laporan hilang
 * walau semua form sudah terisi sukses.
 * @param {Object} waClient
 * @param {string} tujuan
 * @param {string} pesan
 * @param {string} label - untuk log
 * @returns {Promise<boolean>} true bila terkirim
 */
async function _kirimPesanAman(waClient, tujuan, pesan, label = 'pesan') {
    for (let percobaan = 1; percobaan <= KIRIM_MAX_PERCOBAAN; percobaan++) {
        try {
            await withTimeout(
                waClient.sendMessage(tujuan, pesan),
                KIRIM_TIMEOUT_MS,
                `sendMessage(${tujuan})`
            );
            logger.success('KIRIM', `${label} terkirim ke ${tujuan}.`);
            return true;
        } catch (e) {
            logger.warn('KIRIM', `Gagal kirim ${label} ke ${tujuan} (percobaan ${percobaan}/${KIRIM_MAX_PERCOBAAN}): ${e.message}`);
            if (percobaan < KIRIM_MAX_PERCOBAAN) await delay(5000 * percobaan);
        }
    }
    logger.error('KIRIM', `${label} GAGAL TOTAL ke ${tujuan} setelah ${KIRIM_MAX_PERCOBAAN} percobaan.`);
    return false;
}

/**
 * Ambil pesan validasi Google Form (mis. "Ini adalah pertanyaan wajib diisi")
 * agar alasan kegagalan di laporan WA jelas, bukan sekadar "timeout".
 * @param {import('puppeteer').Page} page
 * @returns {Promise<string|null>}
 */
async function _cariErrorWajib(page) {
    try {
        return await page.evaluate(() => {
            const pesan = [...document.querySelectorAll('[role="alert"]')]
                .map(e => (e.innerText || '').trim())
                .filter(Boolean);
            return pesan.length ? pesan.slice(0, 3).join(' | ') : null;
        });
    } catch (e) {
        return null;
    }
}

/** Jeda agar JavaScript Google Drive di dalam picker selesai memasang listener. */
const JEDA_PICKER_SIAP_MS = 12000;

/** Batas tunggu sampai nama file muncul di bagian "Upload Foto". */
const TIMEOUT_UPLOAD_MS = 60000;

/** Berapa kali seluruh proses buka-picker → upload diulang bila gagal. */
const MAX_PERCOBAAN_UPLOAD = 3;

/**
 * Baca ringkasan bagian pertanyaan "Upload Foto" pada halaman form.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<string>}
 */
function _bacaBagianUpload(page) {
    return page
        .evaluate(() => {
            const sec = [...document.querySelectorAll('div[role="listitem"]')].find((e) =>
                /upload foto/i.test(e.innerText || '')
            );
            return sec ? sec.innerText.replace(/\s+/g, ' ').trim() : '';
        })
        .catch(() => '');
}

/**
 * Buang file sisa draf di pertanyaan "Upload Foto".
 *
 * Form hanya menerima 1 file. Kalau draf Google masih menyimpan lampiran dari
 * absen sebelumnya, upload baru ditolak diam-diam tanpa pesan error.
 *
 * @param {import('puppeteer').Page} page
 */
async function _hapusBerkasDraf(page) {
    const adaYangDihapus = await page
        .evaluate(() => {
            const sec = [...document.querySelectorAll('div[role="listitem"]')].find((e) =>
                /upload foto/i.test(e.innerText || '')
            );
            if (!sec) return false;
            const tombol = [...sec.querySelectorAll('div[role="button"], button')].find((b) =>
                /hapus file|remove file/i.test(b.getAttribute('aria-label') || '')
            );
            if (!tombol) return false;
            tombol.click();
            return true;
        })
        .catch(() => false);

    if (adaYangDihapus) await delay(3000);
    return adaYangDihapus;
}

/**
 * Tutup jendela picker Google Drive sampai benar-benar hilang.
 *
 * Selama iframe picker masih menempel, overlay-nya menutupi tombol
 * "Berikutnya" sehingga klik halaman berikutnya tidak pernah kena.
 *
 * @param {import('puppeteer').Page} page
 */
async function _tutupPicker(page) {
    await page
        .evaluate(() => {
            const frame = document.querySelector('iframe[src*="picker"]');
            const dialog = frame && (frame.closest('div[role="dialog"]') || frame.parentElement);
            const tombol = [...document.querySelectorAll('div[role="button"], button')].find((b) =>
                /tutup pemilih|tutup|close/i.test(b.getAttribute('aria-label') || '')
            );
            if (tombol) tombol.click();
            if (dialog) dialog.remove();
        })
        .catch(() => { /* picker bisa sudah hilang */ });

    for (let i = 0; i < 8; i++) {
        await delay(1000);
        if (!page.frames().some((f) => f.url().includes('picker'))) break;
        if (i === 2) await page.keyboard.press('Escape').catch(() => {});
        if (i === 5) {
            await page
                .evaluate(() => {
                    document.querySelectorAll('iframe[src*="picker"]').forEach((f) => {
                        const box = f.closest('div[role="dialog"]') || f.parentElement;
                        (box || f).remove();
                    });
                })
                .catch(() => {});
        }
    }
}

/**
 * Upload berkas screenshot ke pertanyaan "Upload Foto".
 *
 * Picker Google Drive memakai <input type="file"> tersembunyi di dalam iframe
 * `docs.google.com/picker`. Input itu sudah ada di DOM beberapa detik SEBELUM
 * skrip Drive selesai memasang event listener-nya. Kalau `uploadFile()`
 * dipanggil pada jendela itu, berkas masuk ke input tapi tidak ada yang
 * memprosesnya: tidak ada permintaan upload, tidak ada pesan error, dan picker
 * menggantung terbuka sampai alur berikutnya kena timeout 45 detik.
 *
 * Uji coba langsung ke form: tanpa jeda 0/2 percobaan berhasil, dengan jeda
 * 12 detik 4/4 berhasil. Karena itu di sini ditunggu dulu sampai picker siap,
 * baru berkas dikirim, dan seluruh proses diulang bila masih gagal.
 *
 * Tombol "Upload" di dalam picker hanyalah tab navigasi, bukan tombol
 * konfirmasi — jadi bukti keberhasilan adalah munculnya nama file di bagian
 * "Upload Foto" pada halaman form, bukan tertutupnya picker.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} filePath
 * @param {Object} driver
 */
async function _uploadBerkas(page, filePath, driver) {
    const namaFile = path.basename(filePath);

    for (let percobaan = 1; percobaan <= MAX_PERCOBAAN_UPLOAD; percobaan++) {
        if (await _hapusBerkasDraf(page)) {
            logger.info(driver.nama, 'Lampiran sisa draf dibuang sebelum upload.');
        }

        await klikTombolTeks(page, 'Tambahkan file', 'Add file');

        let frameUpload = null;
        for (let i = 0; i < 20 && !frameUpload; i++) {
            await delay(1500);
            for (const f of page.frames()) {
                if (!f.url().includes('picker')) continue;
                const siap = await f
                    .evaluate(
                        () =>
                            document.querySelector('input[type="file"]') &&
                            [...document.querySelectorAll('div[role="button"], button')].some((b) =>
                                /jelajah|browse/i.test(b.innerText || '')
                            )
                    )
                    .catch(() => false);
                if (siap) { frameUpload = f; break; }
            }
        }

        if (!frameUpload) {
            logger.warn(driver.nama, `Jendela upload tidak muncul (percobaan ${percobaan}/${MAX_PERCOBAAN_UPLOAD}).`);
            await _tutupPicker(page);
            continue;
        }

        // Beri waktu skrip Drive memasang listener sebelum berkas dikirim.
        await delay(JEDA_PICKER_SIAP_MS);

        const fileInput = await frameUpload.$('input[type="file"]').catch(() => null);
        if (!fileInput) {
            logger.warn(driver.nama, `Kolom upload hilang (percobaan ${percobaan}/${MAX_PERCOBAAN_UPLOAD}).`);
            await _tutupPicker(page);
            continue;
        }

        await fileInput.uploadFile(filePath);

        let berhasil = false;
        const batas = Date.now() + TIMEOUT_UPLOAD_MS;
        while (Date.now() < batas) {
            await delay(2500);
            if ((await _bacaBagianUpload(page)).includes(namaFile)) { berhasil = true; break; }
        }

        if (berhasil) {
            logger.success(driver.nama, `Berkas "${namaFile}" berhasil terupload.`);
            await _tutupPicker(page);
            await tutupDialogGangguan(page);
            return;
        }

        logger.warn(driver.nama, `Upload belum tercatat (percobaan ${percobaan}/${MAX_PERCOBAAN_UPLOAD}), mengulang...`);
        await _tutupPicker(page);
    }

    throw new Error(
        `Upload "${namaFile}" gagal setelah ${MAX_PERCOBAAN_UPLOAD} percobaan. ` +
        'Google Drive menolak menerima berkas — periksa koneksi VPS atau kuota Drive akun ini.'
    );
}

/**
 * Centang semua pernyataan pada halaman Pakta Integritas.
 *
 * Halaman ini bisa memakai radio ("Benar Saya ...") maupun checkbox, dan
 * jumlah pernyataannya bisa lebih dari satu. Versi lama hanya mengklik satu
 * radio lalu lanjut tanpa memeriksa hasilnya, sehingga ketika klik meleset
 * form menolak submit tanpa petunjuk apa pun.
 *
 * @param {import('puppeteer').Page} page
 * @param {Object} driver
 */
async function _tandaTanganPakta(page, driver) {
    const pilih = () =>
        page.evaluate(() => {
            const kandidat = [
                ...document.querySelectorAll('div[role="radio"], div[role="checkbox"]'),
            ].filter((el) => {
                const label = el.getAttribute('aria-label') || '';
                return /benar saya|saya setuju|setuju|ya, saya|bersedia/i.test(label);
            });

            let diklik = 0;
            for (const el of kandidat) {
                if (el.getAttribute('aria-checked') === 'true') continue;
                el.click();
                diklik++;
            }

            return {
                total: kandidat.length,
                diklik,
                tercentang: kandidat.filter((el) => el.getAttribute('aria-checked') === 'true').length,
                label: kandidat.map((el) => el.getAttribute('aria-label')),
            };
        });

    let hasil = await pilih();
    if (hasil.total === 0) {
        logger.warn(driver.nama, 'Tidak ada pernyataan Pakta Integritas yang terdeteksi.');
        return;
    }

    for (let i = 0; i < 3 && hasil.tercentang < hasil.total; i++) {
        await delay(1500);
        await tutupDialogGangguan(page);
        hasil = await pilih();
    }

    if (hasil.tercentang < hasil.total) {
        throw new Error(
            `Pakta Integritas gagal ditandatangani (${hasil.tercentang}/${hasil.total} tercentang).`
        );
    }

    logger.info(driver.nama, `Pakta Integritas ditandatangani (${hasil.tercentang}/${hasil.total}).`);
    await delay(1500);
}

/**
 * Isi Google Form untuk satu driver
 * @param {Object} waClient - WhatsApp client instance
 * @param {Object} driver - Data driver
 * @param {Object|null} liveMsgObj - Live message untuk progress (null = tanpa WA update)
 * @param {string|null} senderWa - Nomor HP pengirim absen (untuk cek saldo)
 * @param {{ skipCharge?: boolean, chatId?: string|null }} options - skipCharge: lewati potong saldo (override admin)
 * @returns {Promise<Object>} Hasil { status, alasan, statusKerja, ringkasanAI }
 */
async function isiGoogleForm(waClient, driver, liveMsgObj = null, senderWa = null, options = {}) {
    let browser = null;
    let tempScreenshotPath = null;

    const isLibur = db.isLiburHariIni(driver.nama);
    const ringkasanAI = generasiRingkasanAI(driver, isLibur);
    const progress = new ProgressTracker(waClient, liveMsgObj, driver, isLibur, options.chatId || null);

    // Akun yang saldonya dipotong — dipakai untuk refund bila absen gagal.
    let akunTerpotong = null;

    try {
        // ══ STAGE 0: Validasi file & saldo ══
        await progress.update(0, 'Mengecek kesiapan file & saldo akun...');

        // Validasi saldo jika mode berbayar aktif (admin bisa override via skipCharge)
        if (config.pricePerAbsen > 0 && !options.skipCharge) {
            const chargeResult = await _chargeDriver(waClient, driver, liveMsgObj, senderWa);
            if (!chargeResult.success) {
                await progress.finish(`🚫 *DIBATALKAN — SALDO KOSONG*\n_${chargeResult.error}_`);
                return { status: 'GAGAL', alasan: chargeResult.error, statusKerja: '-', ringkasanAI, alasanSaldo: true };
            }
            akunTerpotong = chargeResult.userId || null;
        }

        const cookiePath = db.getCookiePath(driver);
        const ssPath = db.getScreenshotPath(driver);

        if (!fs.existsSync(cookiePath)) {
            throw new Error(`Token Sesi Cookie kosong: ${driver.fileCookie}`);
        }
        if (!isLibur && !fs.existsSync(ssPath)) {
            throw new Error(`Media file SS reaksi kosong: ${driver.fileSS}`);
        }

        // Buat copy temporary screenshot dengan nama Android-style.
        // Disimpan di folder .tmp terpisah agar foto asli driver tidak pernah
        // ikut terhapus oleh pembersihan otomatis.
        if (!isLibur) {
            fs.mkdirSync(config.tempScreenshotDir, { recursive: true });
            tempScreenshotPath = path.join(config.tempScreenshotDir, generateNamaScreenshot());
            fs.copyFileSync(ssPath, tempScreenshotPath);
        }

        // ══ STAGE 1: Launch browser & inject cookie ══
        await progress.update(1, 'Membuka browser Google Chrome Core...');
        browser = await launchBrowser(db.getSessionPath(driver));
        const page = await createPage(browser);

        await progress.update(1, 'Menyuntikkan Cookie & bypass otentikasi...');
        await injectCookies(page, cookiePath);

        // ══ STAGE 2: Buka Google Form ══
        await progress.update(2, 'Menghubungi server Google Form utama...');
        await bukaHalaman(page, settings.getFormUrl(), config.formTimeout);

        // Cek apakah redirect ke login (cookie expired)
        if (page.url().includes('ServiceLogin') || page.url().includes('accounts.google.com/v3/signin') || page.url().includes('accounts.google.com/signin')) {
            throw new Error('Cookie kedaluwarsa. Silakan update cookie baru.');
        }

        // ── Page 1: Checkbox Email ──
        await progress.update(2, '[STAGE 1/4] Sinkronisasi Checkbox Email...');
        await tutupDialogGangguan(page);
        const chkEmail = await page.$('div[role="checkbox"]');
        if (chkEmail) {
            const isChecked = await page.evaluate(el => el.getAttribute('aria-checked'), chkEmail);
            if (isChecked !== 'true') {
                try {
                    await chkEmail.click();
                } catch (e) {
                    await tutupDialogGangguan(page);
                    await page.evaluate(el => el.click(), chkEmail);
                }
            }
        }
        await klikTombolTeks(page, 'Berikutnya', 'Next');
        await delay(4000);

        // ── Page 2: Kredensial Profil ──
        await progress.update(3, '[STAGE 2/4] Mengetik Kredensial Profil...');
        await tutupDialogGangguan(page);
        try {
            await page.waitForSelector('input[type="text"]', { timeout: 20000 });
        } catch (e) {
            throw new Error('Halaman identitas driver tidak terbuka. Google Form kemungkinan menahan sesi karena ada draf dari proses lain yang berjalan bersamaan.');
        }
        const textInputsP2 = await page.$$('input[type="text"]');

        if (textInputsP2.length < 2) {
            throw new Error('Form berubah: input teks halaman 2 tidak ditemukan.');
        }

        await ketikAman(page, textInputsP2[0], driver.nama);
        await ketikAman(page, textInputsP2[1], driver.id);

        // Pilih radio: Bekerja / Libur
        const labelKerja = isLibur ? 'Libur' : 'Bekerja';
        if (!await klikAriaLabel(page, [labelKerja])) {
            throw new Error(`Form berubah: opsi status "${labelKerja}" tidak ditemukan.`);
        }

        await klikTombolTeks(page, 'Berikutnya', 'Next');

        // ── Jika LIBUR: langsung submit ──
        if (isLibur) {
            await progress.update(4, 'Mengonfirmasi opsi libur & Mengirimkan form...');
            await delay(3000);
            await tutupDialogGangguan(page);
            await klikTombolTeks(page, 'Kirim', 'Submit');

            try {
                await page.waitForFunction(
                    () => location.href.includes('formResponse') ||
                        /jawaban anda telah direkam|your response has been recorded/i.test(document.body.innerText),
                    { timeout: 30000 }
                );
            } catch (e) {
                const pesanWajib = await _cariErrorWajib(page);
                throw new Error(
                    pesanWajib
                        ? `Form menolak pengiriman libur: ${pesanWajib}`
                        : 'Gagal memverifikasi pengiriman libur: Halaman Google Form tidak beralih ke halaman sukses.'
                );
            }

            await progress.update(4, '🚀 Form Sukses Terkirim!');
            await _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI, options.chatId);
            return { status: 'SUKSES', alasan: '-', statusKerja: 'Libur 🏖️', ringkasanAI };
        }

        // ── Page 3: Data K3 Fatigue ──
        await progress.update(3, '[STAGE 3/4] Mengisi K3 Fatigue & Pengukuran Reaksi...');
        await delay(4000);
        await tutupDialogGangguan(page);

        // Pastikan benar-benar sudah di halaman Fatigue, bukan masih di halaman
        // identitas karena klik "Berikutnya" tertelan dialog draf.
        try {
            await page.waitForFunction(
                () => !!document.querySelector('div[aria-label="Tidak"]'),
                { timeout: 20000 }
            );
        } catch (e) {
            throw new Error('Halaman K3 Fatigue tidak terbuka. Proses kemungkinan bentrok dengan siklus absen lain pada akun yang sama.');
        }

        const textInputsP3 = await page.$$('input[type="text"]');

        if (textInputsP3.length < 2) {
            throw new Error('Form berubah: input teks halaman 3 tidak ditemukan.');
        }

        await ketikAman(page, textInputsP3[0], driver.usia);

        // Radio: Tidak (kelelahan)
        await klikAriaLabel(page, ['Tidak']);

        // Radio: Istirahat > 6 jam
        await klikAriaLabel(page, ['Lebih dari 6 Jam', 'Lebih dari 6 jam']);

        // Input reaksi
        await ketikAman(page, textInputsP3[1], driver.reaksi);

        // ── Upload Screenshot ──
        await progress.update(4, '📥 Upload berkas SS reaksi harian...');
        const uploadPath = tempScreenshotPath || ssPath;
        await _uploadBerkas(page, uploadPath, driver);

        // Next ke halaman terakhir
        await klikTombolTeks(page, 'Berikutnya', 'Next');
        await delay(4000);

        // ── Page 4: Pakta Integritas ──
        await progress.update(4, '[STAGE 4/4] Menandatangani lembar Pakta Integritas...');
        await tutupDialogGangguan(page);

        // Pastikan halaman terakhir benar-benar terbuka. Kalau upload gagal
        // diam-diam, form menahan kita di halaman K3 dan klik "Kirim" di bawah
        // tidak akan pernah ketemu tombolnya.
        try {
            await page.waitForFunction(
                () => [...document.querySelectorAll('div[role="button"]')]
                    .some(b => /^(kirim|submit)$/i.test((b.innerText || '').trim())),
                { timeout: 20000 }
            );
        } catch (e) {
            const pesanWajib = await _cariErrorWajib(page);
            throw new Error(
                pesanWajib
                    ? `Form menahan di halaman K3: ${pesanWajib}`
                    : 'Halaman Pakta Integritas tidak terbuka. Ada data wajib di halaman sebelumnya yang belum lengkap.'
            );
        }

        await _tandaTanganPakta(page, driver);

        // Submit!
        await klikTombolTeks(page, 'Kirim', 'Submit');

        // Tunggu halaman sukses alih-alih menebak dengan delay tetap.
        try {
            await page.waitForFunction(
                () => location.href.includes('formResponse') ||
                    /jawaban anda telah direkam|your response has been recorded/i.test(document.body.innerText),
                { timeout: 30000 }
            );
        } catch (e) {
            const pesanWajib = await _cariErrorWajib(page);
            throw new Error(
                pesanWajib
                    ? `Form menolak pengiriman: ${pesanWajib}`
                    : 'Gagal memverifikasi pengiriman: Halaman Google Form tidak beralih ke halaman sukses. Cek cookie atau data wajib yang belum terisi.'
            );
        }

        await progress.update(4, '🚀 Form Sukses Terkirim!');
        await _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI, options.chatId);

        return { status: 'SUKSES', alasan: '-', statusKerja: 'Masuk 🚚', ringkasanAI };

    } catch (error) {
        logger.error(driver.nama, `Gagal: ${error.message}`);
        await progress.update(4, `💥 Gangguan Sistem: ${error.message}`);

        // Form tidak terkirim = jasa tidak diberikan → kembalikan saldo.
        // Tanpa ini, setiap retry memotong saldo driver walau absen tidak masuk.
        if (akunTerpotong) {
            const r = wallet.mutateBalance(
                akunTerpotong,
                config.pricePerAbsen,
                'REFUND',
                `Refund absen gagal untuk ${driver.nama}`,
                { driver: driver.nama, alasan: error.message }
            );
            if (r.success) {
                logger.info('WALLET', `Refund ${config.pricePerAbsen} ke ${akunTerpotong} (absen ${driver.nama} gagal).`);
            }
        }

        // JIKA COOKIE KEDALUWARSA, KIRIM NOTIFIKASI KHUSUS KE DRIVER DAN ADMIN!
        if (error.message.includes('Cookie kedaluwarsa')) {
            await _kirimAlertCookieExpired(waClient, driver);
        }

        return { status: 'GAGAL', alasan: error.message, statusKerja: '-', ringkasanAI };

    } finally {
        // Cleanup browser & temp SS — wajib pasti mati agar tidak jadi zombie Chrome
        await tutupBrowser(browser);
        if (tempScreenshotPath) {
            hapusFileAman(tempScreenshotPath);
        }
    }
}

/**
 * Cek & potong saldo driver untuk proses absen.
 * Konsep: SETIAP AKUN TERIKAT KE SATU NAMA DRIVER (field driverNama).
 * Saldo dipotong dari akun yang driverNama-nya cocok dengan driver yang diabsen.
 * @param {Object} waClient
 * @param {Object} driver - Data driver yang diabsen
 * @param {Object|null} liveMsgObj
 * @param {string|null} senderWa - Nomor HP pengirim absen (untuk cron pakai noWa driver)
 */
async function _chargeDriver(waClient, driver, liveMsgObj, senderWa = null) {
    const price = config.pricePerAbsen;

    // Cari akun yang MEMILIKI driver ini (driverNama cocok / noWa cocok)
    const allUsers = auth.listUsers();

    // 1. Prioritas: akun yang driverNama-nya cocok dengan nama driver
    let user = allUsers.find(u =>
        u.driverNama && driver.nama.toLowerCase().includes(String(u.driverNama).toLowerCase())
    );

    // 2. Fallback: akun yang noWa-nya sama dengan noWa driver
    if (!user) {
        user = allUsers.find(u => u.noWa && driver.noWa && u.noWa === driver.noWa);
    }

    // 3. Fallback: akun pengirim absen (senderWa) — hanya jika akun tsb punya driverNama cocok
    if (!user && senderWa) {
        const senderUser = allUsers.find(u => u.noWa === senderWa);
        if (senderUser && senderUser.driverNama &&
            driver.nama.toLowerCase().includes(String(senderUser.driverNama).toLowerCase())) {
            user = senderUser;
        }
    }

    if (!user) {
        return {
            success: false,
            error: `Driver *${driver.nama}* belum punya akun & saldo.\n\n` +
                `Silakan daftar akun dengan nama driver:\n` +
                `\`/daftar email password ${driver.nama}\`\n` +
                `lalu \`/topup\` untuk isi saldo.`,
        };
    }

    const userId = user.id;
    const balance = wallet.getBalance(userId);
    if (balance < price) {
        return {
            success: false,
            error: `Saldo *${user.nama}* tidak cukup (${formatRupiah(balance)} < ${formatRupiah(price)}). Silakan \`/topup\`.`,
        };
    }

    const result = wallet.chargeAbsen(userId, driver.nama);
    if (!result.success) {
        return { success: false, error: result.error };
    }

    if (liveMsgObj) {
        // info ke live message bahwa saldo sudah dipotong
        logger.info('WALLET', `Saldo ${user.nama} dipotong ${price} untuk absen ${driver.nama}`);
    }
    return { success: true, userId };
}

/**
 * Kirim laporan sukses ke WA driver
 */
async function _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI, chatId = null) {
    const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const disclaimer = '\n\n' + [
        `📌 *Disclaimer*`,
        `Mohon tetap cek email laporan Anda setiap hari.`,
        `Bot ini dibuat untuk meringankan pekerjaan harian, bukan paksaan.`,
        `⚠️ Namanya robot, sewaktu-waktu bisa saja keliru atau error.`,
    ].join('\n');

    const pesan = kartu({
        judul: `✅ *ABSEN BERHASIL TERKIRIM*`,
        isi: [
            `👤 ${tebal(driver.nama)}`,
            cabang([
                `🆔 ID Reg: ${driver.id}`,
                `📅 Mode: ${isLibur ? '🏖️ libur' : '🚚 masuk kerja'}`,
                `⏱️ Waktu: ${waktu}`,
            ]),
            ``,
            `🧠 *Ringkasan*`,
            miring(ringkasanAI),
        ],
        kaki: [`🤖 ${miring('Powered by Ajiputra-tech')}${disclaimer}`],
    });

    for (const tujuan of _tujuanLaporan(chatId)) {
        await _kirimPesanAman(waClient, tujuan, pesan, `laporan ${driver.nama}`);
    }
}

/**
 * Daftar tujuan laporan: grup laporan + chat pemicu (bila berbeda).
 * @param {string|null} chatId
 * @returns {string[]}
 */
function _tujuanLaporan(chatId) {
    const tujuan = [];
    if (config.waGrup) tujuan.push(config.waGrup);
    if (chatId && chatId !== config.waGrup) tujuan.push(chatId);
    return tujuan;
}

/**
 * Kirim alert ketika cookie kedaluwarsa ke Driver & Admin
 */
async function _kirimAlertCookieExpired(waClient, driver) {
    const depan = driver.nama.split(' ')[0];

    const adminMsg = kartu({
        judul: `⚠️ *COOKIE KEDALUWARSA*`,
        isi: [
            `🚚 ${tebal(driver.nama)}`,
            cabang([
                `🆔 ID Reg: ${driver.id}`,
                `🔴 Sesi Google Account sudah logout`,
            ]),
            ``,
            `Absen otomatis driver ini ${tebal('berhenti')} sampai cookie diperbarui.`,
        ],
        kaki: [
            `💡 Perbarui dengan ${kode(`/updatecookie ${depan}`)} + lampirkan JSON.`,
        ],
    });

    const driverMsg = kartu({
        judul: `⚠️ *SESI GOOGLE ANDA HABIS*`,
        isi: [
            `Halo ${tebal(driver.nama)},`,
            ``,
            `Sesi login Google Account Anda sudah ${tebal('kedaluwarsa')}, sehingga absen otomatis tidak bisa dijalankan.`,
            ``,
            `📌 *Cara memperbaiki:*`,
            cabang([
                `1️⃣ Ambil file JSON cookie baru dari browser Anda`,
                `2️⃣ Kirim berkas itu ke bot ini`,
                `3️⃣ Beri caption: ${kode(`/updatecookie ${depan}`)}`,
            ]),
        ],
        kaki: [`⏳ ${miring('Absen otomatis Anda tertunda sampai cookie diperbarui.')}`],
    });

    if (config.waGrup) {
        await _kirimPesanAman(waClient, config.waGrup, adminMsg, 'alert cookie (grup)');
    }
    if (driver.noWa) {
        await _kirimPesanAman(waClient, driver.noWa, driverMsg, 'alert cookie (driver)');
    }
}

/**
 * Proses absen massal untuk semua driver (atau filter spesifik)
 * @param {Object} waClient - WhatsApp client
 * @param {string|null} targetNama - Nama driver spesifik (null = semua)
 * @param {Object|null} originalMsg - Pesan WA yang memicu (null = cron)
 * @param {{ skipCharge?: boolean }} options - skipCharge: lewati potong saldo (override admin)
 */
async function prosesAbsenMassal(waClient, targetNama = null, originalMsg = null, options = {}) {
    // Dua siklus pada waktu yang sama membuat Google Form saling menimpa draf
    // jawaban → halaman ter-reset & semua driver gagal. Tolak dengan sopan.
    if (siklusBerjalan) {
        logger.warn('ABSEN', 'Permintaan absen ditolak: siklus lain masih berjalan.');
        if (originalMsg) {
            try {
                await originalMsg.reply(
                    `⏳ *PROSES ABSEN SEDANG BERJALAN*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Sistem masih menyelesaikan siklus absen sebelumnya.\n\n` +
                    `_Mohon tunggu sampai laporan rekap terkirim, lalu coba lagi._`
                );
            } catch (e) { /* abaikan */ }
        }
        return { total: 0, suksesCount: 0, gagalCount: 0, rekapLaporan: [], ditolak: true };
    }

    siklusBerjalan = true;
    try {
        return await _prosesAbsenMassal(waClient, targetNama, originalMsg, options);
    } finally {
        siklusBerjalan = false;
    }
}

async function _prosesAbsenMassal(waClient, targetNama = null, originalMsg = null, options = {}) {
    let drivers = db.getAllDrivers();

    // Filter jika target spesifik
    if (targetNama) {
        drivers = drivers.filter(d =>
            d.nama.toLowerCase().includes(targetNama.toLowerCase())
        );
        if (drivers.length === 0) {
            if (originalMsg) await originalMsg.reply(`❌ Driver *${targetNama}* tidak ditemukan dalam database.`);
            return { total: 0, suksesCount: 0, gagalCount: 0, rekapLaporan: [] };
        }
    }

    // Lewati driver yang sudah sukses (dipakai scheduler saat melanjutkan
    // siklus yang terputus, agar form tidak diisi dua kali)
    if (Array.isArray(options.skipNama) && options.skipNama.length > 0) {
        const skip = options.skipNama.map(n => String(n).toLowerCase());
        drivers = drivers.filter(d => !skip.includes(d.nama.toLowerCase()));
        if (drivers.length === 0) {
            logger.info('ABSEN', 'Semua driver sudah diproses sebelumnya. Tidak ada yang perlu dikerjakan.');
            return { total: 0, suksesCount: 0, gagalCount: 0, rekapLaporan: [] };
        }
    }

    const targetChatId = originalMsg ? originalMsg.safeChatId || originalMsg.from : config.waGrup;
    let liveMsgObj = null;

    // Nomor HP pengirim absen (untuk cek saldo). null = cron (pakai noWa driver)
    const senderWa = originalMsg ? getSenderWa(originalMsg) : null;

    if (originalMsg) {
        try {
            liveMsgObj = await waClient.sendMessage(
                targetChatId,
                `🤖 *[SYSTEM RUNNING]* Mempersiapkan instrumen browser server...`
            );
        } catch (e) {
            logger.warn('PROGRESS', `Gagal kirim pesan loader awal: ${e.message}`);
        }
        // Simpan safeChatId agar fallback kirim pesan baru di progress.js tahu tujuannya
        if (liveMsgObj) {
            liveMsgObj.safeChatId = targetChatId;
        }
        logger.info('PROGRESS', `liveMsgObj created - ChatJID: ${liveMsgObj?.id?.remote || 'N/A'}, ID: ${liveMsgObj?.id?._serialized || 'N/A'}, fromMe: ${liveMsgObj?.fromMe}, chatId: ${targetChatId}, senderWa: ${senderWa || 'N/A'}`);
    }

    // Proses setiap driver
    const rekapLaporan = [];
    let suksesCount = 0;
    let gagalCount = 0;

    for (let i = 0; i < drivers.length; i++) {
        const driver = drivers[i];
        logger.system(`▶️ RUNNING WORKER ${i + 1}/${drivers.length}: ${driver.nama.toUpperCase()}`);

        // Batas waktu per driver: satu driver yang menggantung tidak boleh
        // membekukan seluruh siklus (terutama saat dipicu cron jam 8 pagi).
        let hasil;
        try {
            hasil = await withTimeout(
                isiGoogleForm(waClient, driver, liveMsgObj, senderWa, {
                    ...options,
                    chatId: originalMsg ? targetChatId : null,
                }),
                DRIVER_TIMEOUT_MS,
                `isiGoogleForm(${driver.nama})`
            );
        } catch (e) {
            logger.error(driver.nama, `Proses dihentikan paksa: ${e.message}`);
            hasil = {
                status: 'GAGAL',
                alasan: `Proses melebihi batas waktu ${DRIVER_TIMEOUT_MS / 60000} menit dan dihentikan.`,
                statusKerja: '-',
                ringkasanAI: '-',
            };
        }

        rekapLaporan.push({
            nama: driver.nama,
            status: hasil.status,
            alasan: hasil.alasan,
            statusKerja: hasil.statusKerja,
            ringkasanAI: hasil.ringkasanAI,
        });

        if (hasil.status === 'SUKSES') {
            suksesCount++;
            // Dicatat per driver agar progres tidak hilang bila proses mati
            // (OOM) di tengah siklus — lihat catatSukses() di scheduler.
            if (typeof options.onSukses === 'function') {
                try { options.onSukses(driver.nama); } catch (e) { /* abaikan */ }
            }
        } else {
            gagalCount++;
        }
    }

    // Kirim pesan akhir ke live msg. Dibungkus timeout: getMessageById/edit bisa
    // menggantung di VPS dan menahan eksekusi sebelum rekap sempat dikirim.
    if (liveMsgObj && liveMsgObj.id && liveMsgObj.id._serialized) {
        try {
            const freshMsg = await withTimeout(
                waClient.getMessageById(liveMsgObj.id._serialized),
                15000,
                'getMessageById(final)'
            );
            if (freshMsg) {
                await withTimeout(
                    freshMsg.edit(`🚨 *ENGINE TERMINATED*\nTugas selesai. Menghimpun rekapitulasi data...`),
                    15000,
                    'edit(final)'
                );
            }
        } catch (e) {
            logger.debug('REKAP', `Pesan akhir live msg dilewati: ${e.message}`);
        }
    }

    // ── Build Rekap Laporan ──
    const tanggal = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const isi = [
        cabang([
            `📅 Waktu: ${tanggal}`,
            `👥 Total: ${tebal(`${drivers.length} driver`)}`,
            `✅ Berhasil: ${tebal(suksesCount)}  ·  ❌ Gagal: ${tebal(gagalCount)}`,
        ]),
        ``,
        `📝 *Rincian per driver*`,
    ];

    rekapLaporan.forEach((item, index) => {
        if (index > 0) isi.push(``);
        const sukses = item.status === 'SUKSES';
        isi.push(`${sukses ? '✅' : '❌'} ${index + 1}. ${tebal(item.nama)}`);
        isi.push(cabang(sukses
            ? [`Terkirim 100% (${item.statusKerja})`]
            : [`Gagal dieksekusi`, `Sebab: ${miring(item.alasan)}`]
        ));
    });

    const rekap = kartu({
        judul: `📊 *LAPORAN HARIAN AUTO-PETRIP*`,
        isi,
        kaki: [
            gagalCount
                ? `⚠️ ${tebal(`${gagalCount} driver gagal`)} — cek cookie & saldonya.`
                : `🎉 ${miring('Semua driver berhasil absen.')}`,
            ``,
            `📌 *Disclaimer*`,
            `Mohon tetap cek email laporan Anda setiap hari.`,
            `Bot ini dibuat untuk meringankan pekerjaan harian, bukan paksaan.`,
            `⚠️ Namanya robot, sewaktu-waktu bisa saja keliru atau error.`,
        ],
    });

    // Kirim ke grup laporan & chat pemicu
    const tujuanRekap = _tujuanLaporan(originalMsg ? targetChatId : null);
    if (tujuanRekap.length === 0) {
        logger.error('REKAP', 'Tidak ada tujuan laporan! Periksa WA_GRUP di .env.');
    }

    let rekapTerkirim = false;
    for (const tujuan of tujuanRekap) {
        if (await _kirimPesanAman(waClient, tujuan, rekap, 'rekap harian')) {
            rekapTerkirim = true;
        }
    }

    // Jaring pengaman: jangan biarkan laporan hilang bila ID grup salah /
    // bot sudah dikeluarkan dari grup. Kirim ke admin sebagai cadangan.
    if (!rekapTerkirim && config.waAdmin && !tujuanRekap.includes(config.waAdmin)) {
        logger.warn('REKAP', `Semua tujuan gagal. Mengirim rekap ke admin (${config.waAdmin}) sebagai cadangan.`);
        rekapTerkirim = await _kirimPesanAman(waClient, config.waAdmin, rekap, 'rekap harian (cadangan admin)');
    }

    if (!rekapTerkirim && originalMsg) {
        try { await originalMsg.reply(rekap); } catch (err) { /* abaikan */ }
    }

    return { total: drivers.length, suksesCount, gagalCount, rekapLaporan };
}

module.exports = {
    isiGoogleForm,
    prosesAbsenMassal,
    /** @returns {boolean} true bila ada siklus absen yang sedang berjalan */
    sedangAbsen: () => siklusBerjalan,
};
