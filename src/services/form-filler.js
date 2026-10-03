// ══════════════════════════════════════════
// 🎯 FORM FILLER — Core Google Form Engine
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');
const logger = require('../utils/logger');
const { delay, generateNamaScreenshot, hapusFileAman, formatRupiah, withTimeout } = require('../utils/helpers');
const { launchBrowser, tutupBrowser, createPage, injectCookies, klikTombolTeks, ketikAman } = require('./browser');
const { generasiRingkasanAI } = require('./ai-summary');
const ProgressTracker = require('./progress');
const wallet = require('../wallet');
const auth = require('../auth');
const { getSenderWa } = require('../commands/akun');
const settings = require('../settings');

// Batas waktu maksimal pengisian form untuk SATU driver
const DRIVER_TIMEOUT_MS = 8 * 60 * 1000;

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
        }

        const cookiePath = db.getCookiePath(driver);
        const ssPath = db.getScreenshotPath(driver);

        if (!fs.existsSync(cookiePath)) {
            throw new Error(`Token Sesi Cookie kosong: ${driver.fileCookie}`);
        }
        if (!isLibur && !fs.existsSync(ssPath)) {
            throw new Error(`Media file SS reaksi kosong: ${driver.fileSS}`);
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
        await page.goto(settings.getFormUrl(), {
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
            await _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI, options.chatId);
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
        await progress.update(4, '📥 Upload berkas SS reaksi harian...');
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
        await _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI, options.chatId);

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
    return { success: true };
}

/**
 * Kirim laporan sukses ke WA driver
 */
async function _kirimLaporanSukses(waClient, driver, isLibur, ringkasanAI, chatId = null) {
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

    for (const tujuan of _tujuanLaporan(chatId)) {
        try {
            await waClient.sendMessage(tujuan, pesan);
        } catch (e) {
            logger.warn(driver.nama, `Gagal kirim laporan ke ${tujuan}: ${e.message}`);
        }
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
 * @param {{ skipCharge?: boolean }} options - skipCharge: lewati potong saldo (override admin)
 */
async function prosesAbsenMassal(waClient, targetNama = null, originalMsg = null, options = {}) {
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

        if (hasil.status === 'SUKSES') suksesCount++;
        else gagalCount++;
    }

    // Kirim pesan akhir ke live msg
    if (liveMsgObj && liveMsgObj.id && liveMsgObj.id._serialized) {
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

    // Kirim ke grup laporan & chat pemicu
    let rekapTerkirim = false;
    for (const tujuan of _tujuanLaporan(originalMsg ? targetChatId : null)) {
        try {
            await waClient.sendMessage(tujuan, rekap);
            rekapTerkirim = true;
        } catch (e) {
            logger.warn('REKAP', `Gagal kirim rekap ke ${tujuan}: ${e.message}`);
        }
    }

    if (!rekapTerkirim && originalMsg) {
        try { await originalMsg.reply(rekap); } catch (err) { /* abaikan */ }
    }

    return { total: drivers.length, suksesCount, gagalCount, rekapLaporan };
}

module.exports = {
    isiGoogleForm,
    prosesAbsenMassal,
};
