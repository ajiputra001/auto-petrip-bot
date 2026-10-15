// ══════════════════════════════════════════
// 👤 COMMAND: /tambahdriver, /editdriver, /hapusdriver, /listdriver
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const db = require('../database');
const config = require('../config');
const logger = require('../utils/logger');
const { hapusFileAman } = require('../utils/helpers');
const { kartu, kode, tebal, miring, cabang } = require('../utils/tampilan');

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

    const depan = nama.split(' ')[0];

    return msg.reply(
        kartu({
            judul: `✅ *DRIVER TERDAFTAR*`,
            isi: [
                `👤 Nama: ${tebal(newDriver.nama)}`,
                cabang([
                    `🆔 ID Reg: ${newDriver.id}`,
                    `📅 Usia: ${newDriver.usia} tahun  ·  ⚡ Reaksi: ${newDriver.reaksi}ms`,
                    `🍪 Cookie: ${kode(newDriver.fileCookie)}`,
                    `📸 Foto: ${kode(newDriver.fileSS)}`,
                ]),
            ],
            kaki: [
                `📌 ${tebal('Dua langkah lagi sebelum bisa absen:')}`,
                `1️⃣ Kirim file JSON cookie, caption ${kode(`/updatecookie ${depan}`)}`,
                `2️⃣ Kirim gambar screenshot, caption ${kode(`/updatefoto ${depan}`)}`,
                ``,
                `💡 Cek kesiapannya dengan ${kode('/listdriver')}.`,
            ],
        })
    );
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

    const satuan = kolom === 'usia' ? ' tahun' : kolom === 'reaksi' ? 'ms' : '';

    return msg.reply(
        kartu({
            judul: `⚙️ *DATA DRIVER DIPERBARUI*`,
            isi: [
                `👤 Driver: ${tebal(result.driver.nama)}`,
                cabang([
                    `🔧 Kolom: ${tebal(kolom.toUpperCase())}`,
                    `🔄 Nilai baru: ${tebal(nilaiBaru + satuan)}`,
                ]),
            ],
            kaki: [`💡 Lihat data lengkap dengan ${kode('/listdriver')}.`],
        })
    );
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
        if (!drivers.length) {
            return msg.reply(
                kartu({
                    judul: `🗑️ *HAPUS DRIVER*`,
                    isi: [`📋 ${miring('Database driver masih kosong.')}`],
                })
            );
        }

        return msg.reply(
            kartu({
                judul: `🗑️ *HAPUS DRIVER*`,
                isi: [cabang(drivers.map((d) => `${tebal(d.nama)} — ID ${d.id}`))],
                kaki: [
                    `Gunakan: ${kode('/hapusdriver [Nama]')}`,
                    `Contoh: ${kode(`/hapusdriver ${drivers[0].nama.split(' ')[0]}`)}`,
                ],
            })
        );
    }

    const { driver } = db.findDriver(inputNama);
    if (!driver) {
        return msg.reply(
            kartu({
                judul: `❌ *DRIVER TIDAK DITEMUKAN*`,
                isi: [`🔍 Dicari: ${tebal(inputNama)}`],
                kaki: [`💡 Lihat daftar dengan ${kode('/hapusdriver')}.`],
            })
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

    const isi = [
        `🚚 ${tebal(driver.nama)}`,
        cabang([`🆔 ID Reg: ${driver.id}`]),
        ``,
        `Yang akan ${tebal('DIHAPUS')}:`,
        cabang(['Data driver & jadwal libur', 'Berkas cookie', 'Berkas foto screenshot']),
    ];

    if (terkait.length) {
        isi.push(``);
        isi.push(`🔗 ${tebal(`${terkait.length} akun`)} masih tertaut ke driver ini:`);
        isi.push(cabang(terkait.map((u) => `${u.nama} (${u.email})`)));
        isi.push(miring('Akunnya tidak ikut terhapus, tapi tidak bisa absen sampai ditautkan ulang.'));
    }

    return msg.reply(
        kartu({
            judul: `⚠️ *KONFIRMASI HAPUS DRIVER*`,
            isi,
            kaki: [
                `🛟 ${miring('Dicadangkan otomatis sebelum dihapus.')}`,
                ``,
                `✅ Lanjut: ${kode('/hapusdriver ya')}`,
                `🚫 Batal: ${kode('/hapusdriver batal')}`,
                ``,
                `⏳ ${miring('Berlaku 3 menit.')}`,
            ],
        })
    );
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
        kartu({
            judul: `✅ *DRIVER DIHAPUS*`,
            isi: [
                `🗑️ ${tebal(result.namaLengkap)}`,
                cabang([`📂 Berkas dibersihkan: ${terhapus} (cookie & foto)`]),
            ],
            kaki: namaArsip
                ? [
                    `🛟 Dicadangkan dulu sebagai:`,
                    kode(namaArsip),
                    `💡 Pulihkan dengan ${kode('/restore')} bila salah hapus.`,
                ]
                : [`⚠️ ${miring('Cadangan gagal dibuat — penghapusan tidak bisa dibatalkan.')}`],
        })
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

    const jadwal = db.getJadwal();
    const isi = [];
    const belumSiap = [];

    drivers.forEach((d, i) => {
        const cookieOk = db.isCookieReady(d);
        const ssOk = db.isScreenshotReady(d);
        const siap = cookieOk && ssOk;
        if (!siap) belumSiap.push(d.nama);

        const libur = String(jadwal[d.nama] || '-').trim();

        if (i > 0) isi.push(``);
        isi.push(`${siap ? '🟢' : '🔴'} ${i + 1}. ${tebal(d.nama)}`);
        isi.push(cabang([
            `🆔 ID Reg: ${d.id}`,
            `📅 Usia: ${d.usia} tahun  ·  ⚡ Reaksi: ${d.reaksi}ms`,
            libur === '-' || !libur ? `📆 Jadwal: masuk setiap hari` : `📆 Jadwal: libur tiap ${libur}`,
            `🔑 Cookie: ${cookieOk ? 'siap' : 'belum ada'}  ·  🖼️ Foto: ${ssOk ? 'siap' : 'belum ada'}`,
        ]));
    });

    const kaki = [`👥 Total driver: ${tebal(`${drivers.length} orang`)}`];

    if (belumSiap.length) {
        kaki.push(`⚠️ Belum siap absen: ${tebal(belumSiap.join(', '))}`);
        kaki.push(`💡 Lengkapi dengan ${kode('/updatecookie [Nama]')} & ${kode('/updatefoto [Nama]')}.`);
    } else {
        kaki.push(`✅ ${miring('Semua berkas lengkap — siap absen otomatis.')}`);
    }

    return msg.reply(kartu({ judul: `📋 *DAFTAR DRIVER & KESIAPAN DATA*`, isi, kaki }));
}

module.exports = {
    handleTambahDriver,
    handleEditDriver,
    handleHapusDriver,
    handleListDriver,
};
