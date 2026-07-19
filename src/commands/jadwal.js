// ══════════════════════════════════════════
// 📅 COMMAND: /setlibur, /setmasuk, /ceklibur
// ══════════════════════════════════════════

const db = require('../database');

/**
 * Set jadwal libur driver
 * /setlibur [nama] [hari]
 */
async function handleSetLibur(msg, pesan) {
    const komponen = pesan.split(' ');

    if (komponen.length < 3) {
        return msg.reply(
            `❌ *Format Salah!*\n\n` +
            `Gunakan:\n\`/setlibur [Nama Depan] [Hari]\`\n\n` +
            `Contoh:\n\`/setlibur Budi Senin\``
        );
    }

    // Ambil hari (kata terakhir)
    const hari = komponen.pop();

    // Validasi nama hari
    const hariValid = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
    if (!hariValid.includes(hari.toLowerCase())) {
        return msg.reply(`❌ Hari *${hari}* tidak valid!\nPilih: ${hariValid.map(h => h.charAt(0).toUpperCase() + h.slice(1)).join(', ')}`);
    }

    // Ambil nama (setelah command)
    komponen.shift(); // hapus /setlibur
    const nama = komponen.join(' ');

    const result = db.setLibur(nama, hari);

    if (!result.success) {
        return msg.reply(`❌ Driver *${nama}* tidak ditemukan.`);
    }

    return msg.reply(
        `🗓️ *JADWAL DIUBAH*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Driver: *${result.namaLengkap}*\n` +
        `🏖️ Status: *LIBUR* setiap hari *${result.hari}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━`
    );
}

/**
 * Set driver kembali masuk kerja
 * /setmasuk [nama]
 */
async function handleSetMasuk(msg, pesan) {
    const komponen = pesan.split(' ');

    if (komponen.length < 2) {
        return msg.reply(
            `❌ *Format Salah!*\n\nGunakan:\n\`/setmasuk [Nama Depan]\`\n\nContoh:\n\`/setmasuk Budi\``
        );
    }

    komponen.shift(); // hapus /setmasuk
    const nama = komponen.join(' ');

    const result = db.setMasuk(nama);

    if (!result.success) {
        return msg.reply(`❌ Driver *${nama}* tidak ditemukan.`);
    }

    return msg.reply(
        `🗓️ *JADWAL DIUBAH*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Driver: *${result.namaLengkap}*\n` +
        `🚚 Status: Kembali aktif *MASUK KERJA* setiap hari\n` +
        `━━━━━━━━━━━━━━━━━━━━━━`
    );
}

/**
 * Cek jadwal libur semua driver
 * /ceklibur
 */
async function handleCekLibur(msg) {
    const jadwal = db.getJadwal();
    const entries = Object.entries(jadwal);

    if (entries.length === 0) {
        return msg.reply(`📋 Belum ada data jadwal.`);
    }

    let teks = `📊 *TABEL OPERASIONAL JADWAL DRIVER*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const [nama, hari] of entries) {
        const icon = hari === '-'
            ? '🟢 [STANDBY BEKERJA]'
            : `🏖️ [LIBUR HARI ${hari.toUpperCase()}]`;
        teks += `👤 *${nama.padEnd(15, ' ')}* ➡️ ${icon}\n`;
    }

    teks += `\n━━━━━━━━━━━━━━━━━━━━━━━━`;

    return msg.reply(teks);
}

module.exports = {
    handleSetLibur,
    handleSetMasuk,
    handleCekLibur,
};
