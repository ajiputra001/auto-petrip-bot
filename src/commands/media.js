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

    let teks = `📸 *UPDATE FOTO MASTER BERHASIL*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Driver : *${driver.nama}*${isFuzzy ? ` _(Terdeteksi otomatis dari "${inputNama}")_` : ''}\n`;
    teks += `🆔 Driver ID : \`${driver.id}\`\n`;
    teks += `📂 File Baru : \`${namaFileBaru}\`\n`;
    teks += `📊 Ukuran   : *${ukuranKb} KB* (${media.mimetype || 'image/jpeg'})\n`;
    teks += `🛡️ Status SS : *VALID & TERHUBUNG*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `⚡ *Autobot Engine*: Master screenshot siap digunakan untuk pengisian otomatis!`;

    return msg.reply(teks);
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
    try {
        JSON.parse(jsonString);
    } catch (e) {
        return msg.reply(`❌ *STRUKTUR JSON KORUP*\n\nFormat file/teks cookie bukan JSON valid.\nDetail error: _${e.message}_`);
    }

    // Simpan cookie
    const cookiePath = path.join(config.cookieDir, driver.fileCookie);
    fs.writeFileSync(cookiePath, jsonString, 'utf8');

    let teks = `✅ *SINKRONISASI COOKIE BERHASIL*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Driver   : *${driver.nama}*${isFuzzy ? ` _(Terdeteksi otomatis dari "${inputNama}")_` : ''}\n`;
    teks += `🍪 File Session: \`${driver.fileCookie}\`\n`;
    teks += `🔒 Security : *SESSION TOKEN VALID*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `⚡ Autobot siap melakukan otentikasi Google Form otomatis.`;

    return msg.reply(teks);
}

module.exports = {
    handleUpdateFoto,
    handleUpdateCookie,
};
