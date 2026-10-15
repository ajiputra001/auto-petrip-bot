// ══════════════════════════════════════════
// 👤 COMMAND: /tambahdriver, /editdriver, /hapusdriver, /listdriver
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const db = require('../database');
const config = require('../config');
const logger = require('../utils/logger');
const { hapusFileAman } = require('../utils/helpers');

/** Konfirmasi hapus driver yang menunggu, per chat. */
const _hapusTertunda = new Map();
const HAPUS_BERLAKU_MS = 3 * 60 * 1000;

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
 *
 * Dua langkah: nama driver → konfirmasi. Sebelumnya satu ketikan langsung
 * menghapus, padahal nama driver dicocokkan secara toleran (fuzzy) sehingga
 * salah ketik bisa menghapus driver yang salah.
 */
async function handleHapusDriver(msg, pesan) {
    if (!require('./admin').isAdmin(msg)) {
        return msg.reply(`❌ *AKSES DITOLAK*\nPerintah ini khusus admin.`);
    }

    const inputNama = pesan.substring(13).trim();
    const kunci = msg.safeChatId || msg.from;
    const argumen = inputNama.toLowerCase();

    // ── Konfirmasi ──
    if (['ya', 'yes', 'lanjut'].includes(argumen)) {
        const tertunda = _hapusTertunda.get(kunci);
        _hapusTertunda.delete(kunci);

        if (!tertunda || Date.now() > tertunda.kedaluwarsa) {
            return msg.reply(
                `⏰ *TIDAK ADA PERMINTAAN AKTIF*\n` +
                `Mulai lagi dengan \`/hapusdriver [Nama]\`.`
            );
        }

        return _jalankanHapusDriver(msg, tertunda.nama);
    }

    if (['batal', 'cancel', 'tidak'].includes(argumen)) {
        const ada = _hapusTertunda.delete(kunci);
        return msg.reply(ada
            ? `🚫 Penghapusan dibatalkan. Driver tidak diubah.`
            : `🚫 Tidak ada permintaan yang menunggu.`);
    }

    if (!inputNama) {
        const drivers = db.getAllDrivers();
        if (!drivers.length) return msg.reply(`📋 Database driver kosong.`);

        let teks = `🗑️ *HAPUS DRIVER*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        drivers.forEach((d, i) => { teks += `${i + 1}. *${d.nama}* (ID ${d.id})\n`; });
        teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        teks += `Gunakan: \`/hapusdriver [Nama]\`\nContoh: \`/hapusdriver ${drivers[0].nama}\``;
        return msg.reply(teks);
    }

    const { driver } = db.findDriver(inputNama);
    if (!driver) {
        return msg.reply(
            `❌ Driver *${inputNama}* tidak ditemukan.\n` +
            `Lihat daftar: \`/hapusdriver\``
        );
    }

    // Peringatkan bila masih ada akun user yang bergantung pada driver ini.
    const auth = require('../auth');
    const terkait = auth.listUsers().filter(
        (u) => (u.driverNama || '').toLowerCase() === driver.nama.toLowerCase()
    );

    _hapusTertunda.set(kunci, {
        nama: driver.nama,
        kedaluwarsa: Date.now() + HAPUS_BERLAKU_MS,
    });

    let teks = `⚠️ *KONFIRMASI HAPUS DRIVER*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `🚚 *${driver.nama}*\n🆔 ID Reg: ${driver.id}\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `Data driver, jadwal libur, cookie & foto akan *DIHAPUS*.\n`;
    teks += `_(Dicadangkan otomatis sebelum dihapus.)_\n`;

    if (terkait.length) {
        teks += `\n🔗 *${terkait.length} akun* masih tertaut ke driver ini:\n`;
        terkait.forEach((u) => { teks += `• ${u.nama} (${u.email})\n`; });
        teks += `_Akunnya tidak ikut terhapus, tapi tidak bisa absen sampai ditautkan ulang._\n`;
    }

    teks += `\n✅ Ketik \`/hapusdriver ya\` untuk lanjut\n`;
    teks += `🚫 Ketik \`/hapusdriver batal\` untuk membatalkan\n\n_Berlaku 3 menit._`;

    return msg.reply(teks);
}

/**
 * Hapus data driver beserta berkas pendukungnya.
 */
async function _jalankanHapusDriver(msg, nama) {
    const { driver } = db.findDriver(nama);
    if (!driver) return msg.reply(`❌ Driver *${nama}* sudah tidak ada.`);

    // Cadangkan dulu supaya salah hapus masih bisa dipulihkan via /restore.
    let namaArsip = null;
    try {
        const arsip = await require('../services/backup').buatBackup({
            alasan: `pra-hapus driver ${driver.nama}`,
        });
        namaArsip = arsip.nama;
    } catch (e) {
        logger.warn('DRIVER', `Cadangan pra-hapus gagal: ${e.message}`);
    }

    // Catat lokasi berkas sebelum catatan driver hilang dari database.
    const berkas = [
        driver.fileCookie ? path.join(config.cookieDir, driver.fileCookie) : null,
        driver.fileSS ? path.join(config.screenshotDir, driver.fileSS) : null,
    ].filter(Boolean);

    const result = db.removeDriver(driver.nama);
    if (!result.success) {
        return msg.reply(`❌ Gagal menghapus driver *${driver.nama}*.`);
    }

    let terhapus = 0;
    for (const f of berkas) {
        if (fs.existsSync(f)) { hapusFileAman(f); terhapus++; }
    }

    logger.warn('DRIVER', `Driver ${result.namaLengkap} dihapus oleh ${msg.from} (${terhapus} berkas dibersihkan).`);

    return msg.reply(
        `✅ *DRIVER DIHAPUS*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🗑️ *${result.namaLengkap}*\n` +
        `📂 Berkas dibersihkan: ${terhapus} (cookie & foto)\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        (namaArsip
            ? `🛟 Dicadangkan dulu sebagai:\n\`${namaArsip}\`\n_Pulihkan dengan \`/restore\` bila salah hapus._`
            : `⚠️ _Cadangan gagal dibuat — penghapusan tidak bisa dibatalkan._`)
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
