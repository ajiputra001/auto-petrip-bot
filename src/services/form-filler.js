// ══════════════════════════════════════════
// 🎯 FORM FILLER — Core Google Form Engine
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');
const logger = require('../utils/logger');
const { delay, generateNamaScreenshot, hapusFileAman } = require('../utils/helpers');
const { launchBrowser, createPage, injectCookies, klikTombolTeks, ketikAman } = require('./browser');
const { generasiRingkasanAI } = require('./ai-summary');
const ProgressTracker = require('./progress');

/**
 * Isi Google Form untuk satu driver
 * @param {Object} waClient - WhatsApp client instance
 * @param {Object} driver - Data driver
 * @param {Object|null} liveMsgObj - Live message untuk progress (null = tanpa WA update)
 * @returns {Promise<Object>} Hasil { status, alasan, statusKerja, ringkasanAI }
 */
async function isiGoogleForm(waClient, driver, liveMsgObj = null) {
    let browser = null;
    let tempScreenshotPath = null;

    const isLibur = db.isLiburHariIni(driver.nama);
    const ringkasanAI = generasiRingkasanAI(driver, isLibur);
    const progress = new ProgressTracker(waClient, liveMsgObj, driver, isLibur);

    try {
        // ══ STAGE 0: Validasi file ══
        await progress.update(0, 'Mengecek kesiapan file database lokal...');

        const cookiePath = db.getCookiePath(driver);
        const ssPath = db.getScreenshotPath(driver);

        if (!fs.existsSync(cookiePath)) {
            throw new Error(`Token Sesi Cookie kosong: ${driver.fileCookie}`);
        }
        if (!isLibur && !fs.existsSync(ssPath)) {
            throw new Error(`Media file master kosong: ${driver.fileSS}`);
        }

        // Buat copy temporary screenshot dengan nama Android-style
        if (!isLibur) {
            const tempName = generateNamaScreenshot();
            tempScreenshotPath = path.join(config.screenshotDir, tempName);
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
        await page.goto(config.formUrl, {
            waitUntil: 'networkidle2',
            timeout: config.formTimeout,
        });

        // Cek apakah redirect ke login (cookie expired)
        if (page.url().includes('ServiceLogin') || page.url().includes('accounts.google.com/v3/signin') || page.url().includes('accounts.google.com/signin')) {
            throw new Error('Cookie kedaluwarsa. Silakan update cookie baru.');
        }

        // ── Page 1: Checkbox Email ──
        await progress.update(2, '[STAGE 1/4] Sinkronisasi Checkbox Email...');
        const chkEmail = await page.$('div[role="checkbox"]');
        if (chkEmail) {
            const isChecked = await page.evaluate(el => el.getAttribute('aria-checked'), chkEmail);
            if (isChecked !== 'true') await chkEmail.click();
        }
        await klikTombolTeks(page, 'Berikutnya', 'Next');
        await delay(4000);

        // ── Page 2: Kredensial Profil ──
        await progress.update(3, '[STAGE 2/4] Mengetik Kredensial Profil...');
        await page.waitForSelector('input[type="text"]', { timeout: 15000 });
        const textInputsP2 = await page.$$('input[type="text"]');

        if (textInputsP2.length < 2) {
            throw new Error('Form berubah: input teks halaman 2 tidak ditemukan.');
        }

        await ketikAman(page, textInputsP2[0], driver.nama);
        await ketikAman(page, textInputsP2[1], driver.id);

        // Pilih radio: Bekerja / Libur
        const labelKerja = isLibur ? 'Libur' : 'Bekerja';
        const rdoKerja = await page.$(`div[aria-label="${labelKerja}"]`);
        if (rdoKerja) await rdoKerja.click();

        await klikTombolTeks(page, 'Berikutnya', 'Next');

        // ── Jika LIBUR: langsung submit ──
        if (isLibur) {
            await progress.update(4, 'Mengonfirmasi opsi libur & Mengirimkan form...');
            await delay(3000);
            await klikTombolTeks(page, 'Kirim', 'Submit');
            await delay(6000);

            const currentUrl = page.url();
            if (!currentUrl.includes('formResponse')) {
                throw new Error('Gagal memverifikasi pengiriman libur: Halaman Google Form tidak beralih ke halaman sukses.');
            }

            await progress.update(4, '🚀 Form Sukses Terkirim!');
            await _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI);
            return { status: 'SUKSES', alasan: '-', statusKerja: 'Libur 🏖️', ringkasanAI };
        }

        // ── Page 3: Data K3 Fatigue ──
        await progress.update(3, '[STAGE 3/4] Mengisi K3 Fatigue & Pengukuran Reaksi...');
        await delay(4000);
        const textInputsP3 = await page.$$('input[type="text"]');

        if (textInputsP3.length < 2) {
            throw new Error('Form berubah: input teks halaman 3 tidak ditemukan.');
        }

        await ketikAman(page, textInputsP3[0], driver.usia);

        // Radio: Tidak (kelelahan)
        const rdoTidak = await page.$('div[aria-label="Tidak"]');
        if (rdoTidak) await rdoTidak.click();

        // Radio: Istirahat > 6 jam
        const rdoIstirahat =
            await page.$('div[aria-label="Lebih dari 6 Jam"]') ||
            await page.$('div[aria-label="Lebih dari 6 jam"]');
        if (rdoIstirahat) await rdoIstirahat.click();

        // Input reaksi
        await ketikAman(page, textInputsP3[1], driver.reaksi);

        // ── Upload Screenshot ──
        await progress.update(4, '📥 Upload berkas master harian...');
        await klikTombolTeks(page, 'Tambahkan file', 'Add file');

        // Tunggu picker frame muncul
        let frameUpload = null;
        for (let i = 0; i < 10; i++) {
            await delay(1500);
            for (const f of page.frames()) {
                if (f.url().includes('picker')) {
                    frameUpload = f;
                    break;
                }
            }
            if (frameUpload) break;
        }

        if (frameUpload) {
            await frameUpload.waitForSelector('input[type="file"]', { timeout: 10000 });
            const fileInput = await frameUpload.$('input[type="file"]');

            if (fileInput) {
                const uploadPath = tempScreenshotPath || ssPath;
                await fileInput.uploadFile(uploadPath);
                await delay(5000);

                // Klik tombol Upload/Sisipkan di picker
                await frameUpload.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('div[role="button"]'));
                    const upBtn = btns.find(b =>
                        b.innerText &&
                        (b.innerText.toLowerCase().includes('upload') ||
                            b.innerText.toLowerCase().includes('pilih') ||
                            b.innerText.toLowerCase().includes('sisipkan'))
                    );
                    if (upBtn) upBtn.click();
                });
                await delay(15000); // Tunggu upload selesai
            }
        } else {
            logger.warn(driver.nama, 'Frame picker tidak ditemukan, skip upload.');
        }

        // Tutup picker jika masih terbuka
        await page.keyboard.press('Escape');
        await delay(1500);

        // Next ke halaman terakhir
        await klikTombolTeks(page, 'Berikutnya', 'Next');
        await delay(4000);

        // ── Page 4: Pakta Integritas ──
        await progress.update(4, '[STAGE 4/4] Menandatangani lembar Pakta Integritas...');
        const rdoSetuju = await page.$('div[aria-label*="Benar Saya"]');
        if (rdoSetuju) await rdoSetuju.click();

        // Submit!
        await klikTombolTeks(page, 'Kirim', 'Submit');
        await delay(6000);

        // Verifikasi apakah halaman beralih ke halaman respon sukses
        const currentUrl = page.url();
        if (!currentUrl.includes('formResponse')) {
            throw new Error('Gagal memverifikasi pengiriman: Halaman Google Form tidak beralih ke halaman sukses. Silakan cek apakah cookie masih aktif atau ada data wajib yang tidak terisi dengan benar.');
        }

        await progress.update(4, '🚀 Form Sukses Terkirim!');
        await _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI);

        return { status: 'SUKSES', alasan: '-', statusKerja: 'Masuk 🚚', ringkasanAI };

    } catch (error) {
        logger.error(driver.nama, `Gagal: ${error.message}`);
        await progress.update(4, `💥 Gangguan Sistem: ${error.message}`);

        // JIKA COOKIE KEDALUWARSA, KIRIM NOTIFIKASI KHUSUS KE DRIVER DAN ADMIN!
        if (error.message.includes('Cookie kedaluwarsa')) {
            await _kirimAlertCookieExpired(waClient, driver);
        }

        return { status: 'GAGAL', alasan: error.message, statusKerja: '-', ringkasanAI };

    } finally {
        // Cleanup browser & temp SS
        if (browser) {
            try { await browser.close(); } catch (e) { /* abaikan */ }
        }
        if (tempScreenshotPath) {
            hapusFileAman(tempScreenshotPath);
        }
    }
}

/**
 * Kirim laporan sukses ke WA driver
 */
async function _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI) {
    const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const disclaimer = `\n\n📌 *Disclaimer :*\nHarap Untuk Mengecek Email Dari Hasil  Laporan Setiap Hari.
Dan Tidak ada paksaan untuk menggunakan project autobot ini .
Robot ini di ciptakan hanya untuk meringankan kerjaan para pengguna sehari-hari .
INGAT !!! KARNA INI ROBOT ,BISA SAJA SEWAKTU-WAKTU MEMBUAT KESALAHAN/ERROR .`;

    let pesan = `✅ *REPORT AUTO-PETRIP (AJIPUTRA PROJECT)* ✅\n`;
    pesan += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    pesan += `🗂️ *STATUS* : 🟢 *BERHASIL TERKIRIM*\n`;
    pesan += `⏱️ *WAKTU* : ${waktu}\n\n`;
    pesan += `*👤 IDENTIFIKASI DRIVER*\n`;
    pesan += `• Nama   : *${driver.nama}*\n`;
    pesan += `• ID Reg : ${driver.id}\n`;
    pesan += `• Mode   : ${isLibur ? 'Libur 🏖️' : 'Masuk Kerja 🚚'}\n\n`;
    pesan += `🧠 *CORE ANALYTIC Autobot SUMMARY*\n`;
    pesan += `_${ringkasanAI}_\n`;
    pesan += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    pesan += `🤖 _System Powered by Ajiputra-tech v1.0_${disclaimer}`;

    try {
        await waClient.sendMessage(driver.noWa, pesan);
    } catch (e) {
        logger.warn(driver.nama, `Gagal kirim laporan ke WA: ${e.message}`);
    }
}

/**
 * Kirim alert ketika cookie kedaluwarsa ke Driver & Admin
 */
async function _kirimAlertCookieExpired(waClient, driver) {
    const adminMsg = `⚠️ *SISTEM PERINGATAN COOKIE* ⚠️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n❌ *Cookie Kedaluwarsa*: *${driver.nama.toUpperCase()}*\n🆔 ID: ${driver.id}\n\nSistem otomatisasi terhenti untuk driver ini karena sesi Google Account telah kedaluwarsa.\n\nMohon hubungi driver bersangkutan atau perbarui file cookie.`;

    const driverMsg = `⚠️ *PERINGATAN SINKRONISASI AKUN* ⚠️\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nHalo *${driver.nama}*,\n\nSesi login Google Account Anda di sistem kami telah *KEDALUWARSA / LOGOUT*.\n\nMohon segera perbarui cookie Anda dengan cara:\n1️⃣ Dapatkan file JSON cookie baru dari browser laptop/HP Anda.\n2️⃣ Kirim file JSON tersebut ke nomor bot ini dengan teks caption:\n\`/updatecookie ${driver.nama.split(' ')[0]}\`\n\n_Sistem tidak dapat mengisi absen otomatis Anda sampai cookie diperbarui._`;

    try {
        await waClient.sendMessage(config.waGrup, adminMsg);
    } catch (e) {
        logger.warn('ALERT', `Gagal mengirim alert cookie expired ke Grup: ${e.message}`);
    }

    try {
        await waClient.sendMessage(driver.noWa, driverMsg);
    } catch (e) {
        logger.warn('ALERT', `Gagal mengirim alert cookie expired ke Driver: ${e.message}`);
    }
}

/**
 * Proses absen massal untuk semua driver (atau filter spesifik)
 * @param {Object} waClient - WhatsApp client
 * @param {string|null} targetNama - Nama driver spesifik (null = semua)
 * @param {Object|null} originalMsg - Pesan WA yang memicu (null = cron)
 */
async function prosesAbsenMassal(waClient, targetNama = null, originalMsg = null) {
    let drivers = db.getAllDrivers();

    // Filter jika target spesifik
    if (targetNama) {
        drivers = drivers.filter(d =>
            d.nama.toLowerCase().includes(targetNama.toLowerCase())
        );
        if (drivers.length === 0) {
            if (originalMsg) await originalMsg.reply(`❌ Driver *${targetNama}* tidak ditemukan dalam database.`);
            return;
        }
    }

    const targetChatId = originalMsg ? originalMsg.safeChatId || originalMsg.from : config.waGrup;
    let liveMsgObj = null;

    if (originalMsg) {
        liveMsgObj = await waClient.sendMessage(
            targetChatId,
            `🤖 *[SYSTEM RUNNING]* Mempersiapkan instrumen browser server...`
        );
        logger.info('PROGRESS', `liveMsgObj created - ChatJID: ${liveMsgObj?.id?.remote || 'N/A'}, ID: ${liveMsgObj?.id?._serialized || 'N/A'}, fromMe: ${liveMsgObj?.fromMe}`);
    }

    // Proses setiap driver
    const rekapLaporan = [];
    let suksesCount = 0;
    let gagalCount = 0;

    for (let i = 0; i < drivers.length; i++) {
        const driver = drivers[i];
        logger.system(`▶️ RUNNING WORKER ${i + 1}/${drivers.length}: ${driver.nama.toUpperCase()}`);

        const hasil = await isiGoogleForm(waClient, driver, liveMsgObj);
        rekapLaporan.push({
            nama: driver.nama,
            status: hasil.status,
            alasan: hasil.alasan,
            statusKerja: hasil.statusKerja,
            ringkasanAI: hasil.ringkasanAI,
        });

        if (hasil.status === 'SUKSES') suksesCount++;
        else gagalCount++;
    }

    // Kirim pesan akhir ke live msg
    if (liveMsgObj) {
        try {
            const freshMsg = await waClient.getMessageById(liveMsgObj.id._serialized);
            await freshMsg.edit(`🚨 *ENGINE TERMINATED*\nTugas selesai. Menghimpun rekapitulasi data...`);
        } catch (e) { /* abaikan */ }
    }

    // ── Build Rekap Laporan ──
    const tanggal = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    let rekap = `╔════════════════════════╗\n`;
    rekap += `📊*REPORT HARIAN AUTO-PETRIP*📊\n`;
    rekap += `╚════════════════════════╝\n\n`;
    rekap += `📅 *Waktu*     : ${tanggal}\n`;
    rekap += `👥 *Total Data* : ${drivers.length} Driver\n`;
    rekap += `✅ *Berhasil*   : ${suksesCount}\n`;
    rekap += `❌ *Gagal*      : ${gagalCount}\n\n`;
    rekap += `📝 *DAFTAR DRIVER:*\n`;
    rekap += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    rekapLaporan.forEach((item, index) => {
        if (item.status === 'SUKSES') {
            rekap += ` ${index + 1}. *${item.nama}*\n    └ Status: 100% SUKSES TERKIRIM (${item.statusKerja})\n`;
        } else {
            rekap += ` ${index + 1}. *${item.nama}*\n    └ Status: 🟥 GAGAL EKSEKUSI\n    └ Detail: _${item.alasan}_\n`;
        }
    });

    rekap += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    rekap += `📌 *Disclaimer :*\n`;
    rekap += `Harap Untuk Mengecek Email Dari Hasil  Laporan Setiap Hari.
Dan Tidak ada paksaan untuk menggunakan project autobot ini .
Robot ini di ciptakan hanya untuk meringankan kerjaan para pengguna sehari-hari .
INGAT !!! KARNA INI ROBOT ,BISA SAJA SEWAKTU-WAKTU MEMBUAT KESALAHAN/ERROR .`;

    // Kirim ke grup
    try {
        await waClient.sendMessage(config.waGrup, rekap);
    } catch (e) {
        logger.warn('REKAP', `Gagal kirim ke grup, coba reply ke pengirim...`);
        if (originalMsg) {
            try { await originalMsg.reply(rekap); } catch (err) { /* abaikan */ }
        }
    }
}

module.exports = {
    isiGoogleForm,
    prosesAbsenMassal,
};
