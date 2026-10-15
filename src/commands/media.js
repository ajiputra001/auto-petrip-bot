// ══════════════════════════════════════════
// 📁 COMMAND: /updatefoto, /updatecookie
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');
const { generateNamaScreenshotTanggal, hapusFileAman } = require('../utils/helpers');
const { downloadMediaRobust } = require('../utils/media-downloader');
const logger = require('../utils/logger');
const { kartu, kode, tebal, miring, cabang } = require('../utils/tampilan');

/**
 * Update foto/screenshot driver
 * /updatefoto [Nama] (+ lampiran gambar atau reply ke gambar)
 * @param {Object} msg - WhatsApp message object
 * @param {string} pesan - Text content
 * @param {Object} waClient - WhatsApp client instance
 */
async function handleUpdateFoto(msg, pesan, waClient = null) {
    // Parse nama dari command (support "/updatefoto" dan "/update foto")
    let parameter;
    if (pesan.toLowerCase().startsWith('/update foto ')) {
        parameter = pesan.substring(13).trim();
    } else {
        parameter = pesan.substring(12).trim();
    }

    const inputNama = parameter.split(' ')[0];

    if (!inputNama) {
        return msg.reply(
            `❌ *NAMA DRIVER DIPERLUKAN*\n\n` +
            `Contoh penggunaan:\n` +
            `1️⃣ \`/updatefoto Agung\` _(+ kirim foto bersamaan)_\n` +
            `2️⃣ Balas (reply) foto yang ada dengan ketikan: \`/updatefoto Agung\``
        );
    }

    const { driver, isFuzzy } = db.findDriver(inputNama);
    if (!driver) {
        return msg.reply(
            `❌ Driver *${inputNama}* tidak terdaftar dalam database.\n` +
            `Gunakan \`/listdriver\` untuk melihat daftar driver yang tersedia.`
        );
    }

    // Unduh media menggunakan Robust Downloader Engine (Mendukung Reply & Attachment)
    const downloadRes = await downloadMediaRobust(msg, waClient);

    if (!downloadRes.success || !downloadRes.media) {
        let errDesc = downloadRes.message || 'Gagal mengunduh media dari WhatsApp Web.';
        if (downloadRes.error === 'NO_MEDIA') {
            errDesc = `Silakan lampirkan gambar tangkapan layar bersamaan dengan perintah ini, ATAU balas (reply) foto yang sudah ada di chat.`;
        }
        return msg.reply(`❌ *GAGAL MENGUNDUH FOTO*\n\n${errDesc}`);
    }

    const media = downloadRes.media;
    const mediaBuffer = Buffer.from(media.data, 'base64');
    const ukuranKb = (mediaBuffer.length / 1024).toFixed(1);

    // Hapus file screenshot lama jika ada
    if (driver.fileSS) {
        const fileLama = path.join(config.screenshotDir, driver.fileSS);
        hapusFileAman(fileLama);
    }

    // Simpan file screenshot baru
    const namaFileBaru = generateNamaScreenshotTanggal();
    const savePath = path.join(config.screenshotDir, namaFileBaru);

    try {
        fs.writeFileSync(savePath, mediaBuffer);
    } catch (err) {
        logger.error('MEDIA', `Gagal menyimpan file screenshot: ${err.message}`);
        return msg.reply(`❌ *GAGAL MENYIMPAN FOTO*\n_Sistem gagal menulis berkas ke media penyimpanan server: ${err.message}_`);
    }

    // Update database driver
    db.updateScreenshot(driver.nama, namaFileBaru);

    const cookieOk = db.isCookieReady(driver);

    return msg.reply(
        kartu({
            judul: `📸 *FOTO REAKSI DIPERBARUI*`,
            isi: [
                `👤 Driver: ${tebal(driver.nama)}`,
                cabang([
                    `🆔 ID Reg: ${driver.id}`,
                    `📂 Berkas: ${kode(namaFileBaru)}`,
                    `📊 Ukuran: ${tebal(`${ukuranKb} KB`)} (${media.mimetype || 'image/jpeg'})`,
                    `🛡️ Status: ${tebal('VALID & TERHUBUNG')}`,
                ]),
                isFuzzy ? `\n🔍 ${miring(`Nama "${inputNama}" dicocokkan otomatis.`)}` : null,
            ].filter(Boolean),
            kaki: [
                cookieOk
                    ? `✅ ${miring('Berkas lengkap — driver siap absen otomatis.')}`
                    : `⚠️ Cookie belum ada. Kirim JSON dengan ${kode(`/updatecookie ${driver.nama.split(' ')[0]}`)}.`,
            ],
        })
    );
}

/**
 * Update cookie session driver
 * /updatecookie [Nama] (+ teks JSON atau file JSON)
 * @param {Object} msg - WhatsApp message object
 * @param {string} pesan - Content of the message
 * @param {Object} waClient - WhatsApp client instance
 */
async function handleUpdateCookie(msg, pesan, waClient = null) {
    // Parse nama dari command
    const barisPertama = pesan.split('\n')[0];
    const komponen = barisPertama.split(' ');

    let inputNama;
    if (komponen[1] && komponen[1].toLowerCase() === 'cookie') {
        // "/update cookie Nama"
        inputNama = komponen[2] || '';
    } else {
        // "/updatecookie Nama"
        inputNama = komponen[1] || '';
    }

    if (!inputNama) {
        return msg.reply(
            `❌ *NAMA DRIVER DIPERLUKAN*\n\n` +
            `Cara pakai:\n` +
            `1️⃣ \`/updatecookie Budi\` + lampirkan/balas file JSON\n` +
            `2️⃣ \`/updatecookie Budi\` + tempel teks JSON di baris berikutnya`
        );
    }

    const { driver, isFuzzy } = db.findDriver(inputNama);
    if (!driver) {
        return msg.reply(`❌ Driver *${inputNama}* tidak ditemukan dalam database.`);
    }

    // Ambil JSON string dari teks chat atau file media
    let jsonString = '';

    if (pesan.includes('[') || pesan.includes('{')) {
        // JSON ditempel di bawah command
        const barisSemua = pesan.split('\n');
        barisSemua.shift(); // hapus baris pertama (command)
        jsonString = barisSemua.join('\n').trim();
    } else {
        // Coba unduh dari file media (attachment atau reply)
        const downloadRes = await downloadMediaRobust(msg, waClient);
        if (downloadRes.success && downloadRes.media && downloadRes.media.data) {
            jsonString = Buffer.from(downloadRes.media.data, 'base64').toString('utf-8');
        } else {
            return msg.reply(
                `❌ *FORMAT COOKIE TIDAK DITEMUKAN*\n\n` +
                `Lampirkan file JSON cookie, balas file cookie, atau tempel teks JSON di bawah perintah.\n\n` +
                `Contoh:\n\`/updatecookie Budi\`\n\`[{"name":"SID","value":"xxx",...}]\``
            );
        }
    }

    // Validasi JSON
    let jumlahCookie = 0;
    try {
        const parsed = JSON.parse(jsonString);
        jumlahCookie = Array.isArray(parsed) ? parsed.length : Object.keys(parsed || {}).length;
        if (!jumlahCookie) {
            return msg.reply(
                kartu({
                    judul: `❌ *COOKIE KOSONG*`,
                    isi: [`JSON valid, tapi tidak memuat satu pun cookie.`],
                    kaki: [`💡 ${miring('Ekspor ulang cookie dari browser yang masih login ke Google.')}`],
                })
            );
        }
    } catch (e) {
        return msg.reply(
            kartu({
                judul: `❌ *STRUKTUR JSON KORUP*`,
                isi: [
                    `Isi berkas/teks cookie bukan JSON yang valid.`,
                    ``,
                    `🔎 Detail: ${miring(e.message)}`,
                ],
                kaki: [`💡 ${miring('Pastikan seluruh isi berkas tersalin tanpa terpotong.')}`],
            })
        );
    }

    // Simpan cookie
    const cookiePath = path.join(config.cookieDir, driver.fileCookie);
    fs.writeFileSync(cookiePath, jsonString, 'utf8');

    const ssOk = db.isScreenshotReady(driver);

    return msg.reply(
        kartu({
            judul: `🍪 *COOKIE TERSINKRONISASI*`,
            isi: [
                `👤 Driver: ${tebal(driver.nama)}`,
                cabang([
                    `🆔 ID Reg: ${driver.id}`,
                    `🍪 Berkas sesi: ${kode(driver.fileCookie)}`,
                    `📊 Jumlah cookie: ${tebal(jumlahCookie)}`,
                    `🔒 Status: ${tebal('SESSION TOKEN VALID')}`,
                ]),
                isFuzzy ? `\n🔍 ${miring(`Nama "${inputNama}" dicocokkan otomatis.`)}` : null,
            ].filter(Boolean),
            kaki: [
                ssOk
                    ? `✅ ${miring('Berkas lengkap — driver siap absen otomatis.')}`
                    : `⚠️ Foto belum ada. Kirim gambar dengan ${kode(`/updatefoto ${driver.nama.split(' ')[0]}`)}.`,
            ],
        })
    );
}

module.exports = {
    handleUpdateFoto,
    handleUpdateCookie,
};
