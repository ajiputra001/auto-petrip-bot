// ══════════════════════════════════════════
// 📁 COMMAND: /updatefoto, /updatecookie
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');
const { generateNamaScreenshotTanggal, hapusFileAman } = require('../utils/helpers');

/**
 * Update foto/screenshot driver
 * /updatefoto [Nama] (+ lampiran gambar)
 */
async function handleUpdateFoto(msg, pesan) {
    // Parse nama dari command (support "/updatefoto" dan "/update foto")
    let parameter;
    if (pesan.toLowerCase().startsWith('/update foto ')) {
        parameter = pesan.substring(13).trim();
    } else {
        parameter = pesan.substring(12).trim();
    }

    const inputNama = parameter.split(' ')[0];

    if (!inputNama) {
        return msg.reply(`❌ Masukkan nama driver!\nContoh: \`/updatefoto Budi\` _(+ lampirkan gambar)_`);
    }

    const { driver } = db.findDriver(inputNama);
    if (!driver) {
        return msg.reply(`❌ Driver *${inputNama}* tidak terdaftar dalam database.`);
    }

    // Cek lampiran media
    if (!msg.hasMedia || msg.type === 'chat') {
        return msg.reply(`❌ Lampirkan gambar tangkapan layar bersama perintah ini!`);
    }

    // Hapus file lama jika ada
    const fileLama = path.join(config.screenshotDir, driver.fileSS);
    hapusFileAman(fileLama);

    // Download & simpan file baru
    const namaFileBaru = generateNamaScreenshotTanggal();
    let media;
    try {
        media = await msg.downloadMedia();
        if (!media || !media.data) {
            throw new Error('Gagal mengunduh media dari WhatsApp (media kosong/tidak valid).');
        }
    } catch (error) {
        console.error('Error downloading media:', error);
        return msg.reply(`❌ *GAGAL MENGUNDUH FOTO*\n\nTerjadi kesalahan internal saat mengunduh gambar dari WhatsApp Web.\nDetail: _${error.message || error}_`);
    }

    fs.writeFileSync(
        path.join(config.screenshotDir, namaFileBaru),
        media.data,
        'base64'
    );

    // Update database
    db.updateScreenshot(inputNama, namaFileBaru);

    let teks = `📸 *UPDATE FOTO BERHASIL*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Driver : *${driver.nama}*\n`;
    teks += `📂 File   : \`${namaFileBaru}\`\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━`;

    return msg.reply(teks);
}

/**
 * Update cookie session driver
 * /updatecookie [Nama] (+ teks JSON atau file JSON)
 */
async function handleUpdateCookie(msg, pesan) {
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
    inputNama = inputNama.toLowerCase();

    if (!inputNama) {
        return msg.reply(
            `❌ Masukkan nama driver!\n\n` +
            `Cara pakai:\n` +
            `1️⃣ \`/updatecookie Budi\` + lampirkan file JSON\n` +
            `2️⃣ \`/updatecookie Budi\` + tempel teks JSON di baris berikutnya`
        );
    }

    const { driver } = db.findDriver(inputNama);
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
    } else if (msg.hasMedia && msg.type !== 'chat') {
        // JSON dari file media
        let media;
        try {
            media = await msg.downloadMedia();
            if (!media || !media.data) {
                throw new Error('Gagal mengunduh file media cookie (kosong/tidak valid).');
            }
        } catch (error) {
            console.error('Error downloading cookie media:', error);
            return msg.reply(`❌ *GAGAL MENGUNDUH COOKIE*\n\nTerjadi kesalahan saat mengunduh file cookie dari WhatsApp Web.\nDetail: _${error.message || error}_`);
        }
        jsonString = Buffer.from(media.data, 'base64').toString('utf-8');
    } else {
        return msg.reply(
            `❌ *Format Salah!*\n\n` +
            `Lampirkan file JSON cookie, atau tempel teks JSON di bawah perintah.\n\n` +
            `Contoh:\n\`/updatecookie Budi\`\n\`[{"name":"SID","value":"xxx",...}]\``
        );
    }

    // Validasi JSON
    try {
        JSON.parse(jsonString);
    } catch (e) {
        return msg.reply(`❌ Struktur JSON cookie tidak valid / korup.\nError: _${e.message}_`);
    }

    // Simpan cookie
    const cookiePath = path.join(config.cookieDir, driver.fileCookie);
    fs.writeFileSync(cookiePath, jsonString, 'utf8');

    let teks = `✅ *SINKRONISASI SESI BERHASIL*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Driver : *${driver.nama}*\n`;
    teks += `🍪 File   : \`${driver.fileCookie}\`\n`;
    teks += `🔒 Status : Token Cookie Aktif Terkunci!\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━`;

    return msg.reply(teks);
}

module.exports = {
    handleUpdateFoto,
    handleUpdateCookie,
};
