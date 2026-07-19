// ══════════════════════════════════════════
// 👤 COMMAND: /tambahdriver, /editdriver, /hapusdriver, /listdriver
// ══════════════════════════════════════════

const db = require('../database');

/**
 * Tambah driver baru ke database
 * /tambahdriver [Nama]#[ID]#[Usia]#[Reaksi]
 */
async function handleTambahDriver(msg, pesan) {
    const parameter = pesan.substring(14).trim();
    const dataPotong = parameter.split('#');

    if (dataPotong.length < 4) {
        return msg.reply(
            `❌ *Format Salah!*\n\n` +
            `Gunakan:\n\`/tambahdriver [Nama]#[ID]#[Usia]#[Reaksi]\`\n\n` +
            `Contoh:\n\`/tambahdriver Budi Santoso#123456#30#280\``
        );
    }

    const nama = dataPotong[0].trim();
    const id = dataPotong[1].trim();
    const usia = dataPotong[2].trim();
    const reaksi = dataPotong[3].trim();

    // Validasi input
    if (!nama || !id || !usia || !reaksi) {
        return msg.reply(`❌ Semua kolom (Nama, ID, Usia, Reaksi) harus diisi.`);
    }

    // Validasi angka
    if (isNaN(id)) {
        return msg.reply(`❌ ID harus berupa angka! (Input: "${id}")`);
    }
    if (isNaN(usia)) {
        return msg.reply(`❌ Usia harus berupa angka! (Input: "${usia}")`);
    }
    if (isNaN(reaksi)) {
        return msg.reply(`❌ Reaksi harus berupa angka milidetik! (Input: "${reaksi}")`);
    }

    // Cek duplikat
    const { driver: existing } = db.findDriver(nama);
    if (existing) {
        return msg.reply(`⚠️ Driver *${existing.nama}* sudah terdaftar.`);
    }

    const newDriver = db.addDriver({ nama, id, usia, reaksi, noWa: msg.from });

    let teks = `✅ *REGISTRASI BERHASIL*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Nama    : *${newDriver.nama}*\n`;
    teks += `🆔 ID Reg  : ${newDriver.id}\n`;
    teks += `📅 Usia    : ${newDriver.usia} tahun\n`;
    teks += `⚡ Reaksi  : ${newDriver.reaksi}ms\n`;
    teks += `🍪 Cookie  : \`${newDriver.fileCookie}\`\n`;
    teks += `📸 Foto    : \`${newDriver.fileSS}\`\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `📌 _Langkah selanjutnya:_\n`;
    teks += `1️⃣ Kirim file JSON cookie dengan caption: \`/updatecookie ${nama.split(' ')[0]}\`\n`;
    teks += `2️⃣ Kirim gambar screenshot dengan caption: \`/updatefoto ${nama.split(' ')[0]}\``;

    return msg.reply(teks);
}

/**
 * Edit kolom data driver
 * /editdriver [Nama]#[Kolom]#[Nilai]
 */
async function handleEditDriver(msg, pesan) {
    const parameter = pesan.substring(12).trim();
    const dataPotong = parameter.split('#');

    if (dataPotong.length < 3) {
        return msg.reply(
            `❌ *Format Salah!*\n\n` +
            `Gunakan:\n\`/editdriver [Nama Depan]#[Kolom]#[Nilai Baru]\`\n\n` +
            `Kolom valid: \`usia\`, \`reaksi\`, \`id\`\n\n` +
            `Contoh:\n\`/editdriver Budi#reaksi#275\``
        );
    }

    const inputNama = dataPotong[0].trim();
    const kolom = dataPotong[1].trim().toLowerCase();
    const nilaiBaru = dataPotong[2].trim();

    // Validasi kolom & angka
    const kolomValid = ['usia', 'reaksi', 'id'];
    if (!kolomValid.includes(kolom)) {
        return msg.reply(`❌ Kolom tidak valid! Pilih salah satu: \`id\`, \`usia\`, \`reaksi\`.`);
    }

    if (isNaN(nilaiBaru)) {
        return msg.reply(`❌ Nilai baru untuk *${kolom.toUpperCase()}* harus berupa angka!`);
    }

    const result = db.updateDriver(inputNama, kolom, nilaiBaru);

    if (!result.success) {
        return msg.reply(`❌ ${result.error}`);
    }

    let teks = `⚙️ *PERUBAHAN DATA BERHASIL*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👤 Driver     : *${result.driver.nama}*\n`;
    teks += `🔧 Kolom      : *${kolom.toUpperCase()}*\n`;
    teks += `🔄 Nilai Baru : *${nilaiBaru}*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━`;

    return msg.reply(teks);
}

/**
 * Hapus driver dari database
 * /hapusdriver [Nama]
 */
async function handleHapusDriver(msg, pesan) {
    const inputNama = pesan.substring(13).trim();

    if (!inputNama) {
        return msg.reply(`❌ Masukkan nama driver!\nContoh: \`/hapusdriver Budi\``);
    }

    const result = db.removeDriver(inputNama);

    if (!result.success) {
        return msg.reply(`❌ Driver *${inputNama}* tidak ditemukan dalam database.`);
    }

    return msg.reply(
        `✅ *DRIVER DIHAPUS*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🗑️ *${result.namaLengkap}* berhasil dihapus dari database.\n` +
        `━━━━━━━━━━━━━━━━━━━━━━`
    );
}

/**
 * List semua driver dengan deteksi kesiapan berkas pintar
 * /listdriver
 */
async function handleListDriver(msg) {
    const drivers = db.getAllDrivers();

    if (drivers.length === 0) {
        return msg.reply(`📋 Database driver kosong.`);
    }

    let teks = `📋 *DAFTAR DRIVER & KESIAPAN DATA*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    drivers.forEach((d, i) => {
        const cookieOk = db.isCookieReady(d);
        const ssOk = db.isScreenshotReady(d);
        
        const cookieStatus = cookieOk ? '🟢 Ready' : '🔴 Missing';
        const ssStatus = ssOk ? '🟢 Ready' : '🔴 Missing';

        teks += `\n${i + 1}. *${d.nama.toUpperCase()}*\n`;
        teks += `   🆔 ID Reg  : ${d.id}\n`;
        teks += `   📅 Usia    : ${d.usia} tahun\n`;
        teks += `   ⚡ Reaksi  : ${d.reaksi}ms\n`;
        teks += `   🔑 Cookie  : ${cookieStatus}\n`;
        teks += `   🖼️ Foto SS  : ${ssStatus}\n`;
    });

    teks += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `👥 *Total Driver*: ${drivers.length} orang\n`;
    teks += `💡 _Pastikan semua berstatus 🟢 Ready sebelum melakukan proses absen._`;

    return msg.reply(teks);
}

module.exports = {
    handleTambahDriver,
    handleEditDriver,
    handleHapusDriver,
    handleListDriver,
};
