// ══════════════════════════════════════════
// 📅 COMMAND: /setlibur, /setmasuk, /ceklibur
// ══════════════════════════════════════════

const db = require('../database');
const { getHariIni } = require('../utils/helpers');
const { kartu, kode, tebal, miring, cabang } = require('../utils/tampilan');

const HARI_VALID = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];

/** Normalisasi nama hari agar variasi penulisan tetap cocok. */
function _normalHari(nilai) {
    return String(nilai || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z]/g, '');
}

/** Bandingkan dua nama hari lintas variasi penulisan. */
function _samaHari(a, b) {
    const x = _normalHari(a);
    const y = _normalHari(b);
    return !!x && x === y;
}

/**
 * Ambil hari libur driver dari file jadwal.
 * Nama dicocokkan toleran spasi/kapital karena file bisa diedit manual.
 * @returns {string|null} Nama hari, atau null bila masuk setiap hari
 */
function _hariLibur(jadwal, namaDriver) {
    const rapikan = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

    let hari = jadwal[namaDriver];
    if (hari === undefined) {
        const target = rapikan(namaDriver);
        const kunci = Object.keys(jadwal).find((k) => rapikan(k) === target);
        hari = kunci ? jadwal[kunci] : '-';
    }

    const bersih = String(hari || '-').trim();
    return bersih === '-' || bersih === '' ? null : bersih;
}

/**
 * Set jadwal libur driver
 * /setlibur [nama] [hari]
 */
async function handleSetLibur(msg, pesan) {
    const komponen = pesan.split(' ');

    if (komponen.length < 3) {
        return msg.reply(
            kartu({
                judul: `❌ *FORMAT SALAH*`,
                isi: [
                    `Gunakan: ${kode('/setlibur [Nama] [Hari]')}`,
                    `Contoh: ${kode('/setlibur Budi Senin')}`,
                ],
                kaki: [`💡 Lihat jadwal saat ini dengan ${kode('/ceklibur')}.`],
            })
        );
    }

    // Ambil hari (kata terakhir)
    const hari = komponen.pop();

    if (!HARI_VALID.includes(_normalHari(hari))) {
        return msg.reply(
            kartu({
                judul: `❌ *HARI TIDAK VALID*`,
                isi: [
                    `Hari ${tebal(hari)} tidak dikenali.`,
                    ``,
                    `📆 Pilihan: ${HARI_VALID.map((h) => h.charAt(0).toUpperCase() + h.slice(1)).join(', ')}`,
                ],
                kaki: [`💡 Contoh: ${kode('/setlibur Budi Senin')}`],
            })
        );
    }

    // Ambil nama (setelah command)
    komponen.shift(); // hapus /setlibur
    const nama = komponen.join(' ');

    const result = db.setLibur(nama, hari);

    if (!result.success) {
        return msg.reply(_driverTidakAda(nama));
    }

    const cocokHariIni = _samaHari(result.hari, getHariIni());

    return msg.reply(
        kartu({
            judul: `🗓️ *JADWAL DIPERBARUI*`,
            isi: [
                `👤 Driver: ${tebal(result.namaLengkap)}`,
                `🏖️ Status: ${tebal('LIBUR')} setiap hari ${tebal(result.hari)}`,
            ],
            kaki: [
                cocokHariIni
                    ? `📌 ${miring('Hari ini termasuk jadwal libur — absen otomatis akan mengirim form libur.')}`
                    : `📌 ${miring('Absen otomatis tetap berjalan normal di hari lain.')}`,
                `💡 Batalkan libur dengan ${kode(`/setmasuk ${result.namaLengkap.split(' ')[0]}`)}.`,
            ],
        })
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
            kartu({
                judul: `❌ *FORMAT SALAH*`,
                isi: [
                    `Gunakan: ${kode('/setmasuk [Nama]')}`,
                    `Contoh: ${kode('/setmasuk Budi')}`,
                ],
                kaki: [`💡 Lihat jadwal saat ini dengan ${kode('/ceklibur')}.`],
            })
        );
    }

    komponen.shift(); // hapus /setmasuk
    const nama = komponen.join(' ');

    const result = db.setMasuk(nama);

    if (!result.success) {
        return msg.reply(_driverTidakAda(nama));
    }

    return msg.reply(
        kartu({
            judul: `🗓️ *JADWAL DIPERBARUI*`,
            isi: [
                `👤 Driver: ${tebal(result.namaLengkap)}`,
                `🚚 Status: ${tebal('MASUK KERJA')} setiap hari`,
            ],
            kaki: [
                `📌 ${miring('Jadwal libur dihapus — absen otomatis berjalan tiap hari.')}`,
                `💡 Atur libur lagi dengan ${kode('/setlibur [Nama] [Hari]')}.`,
            ],
        })
    );
}

/**
 * Balasan standar saat nama driver tidak ketemu — sekaligus menunjukkan
 * nama yang tersedia supaya pengguna tidak perlu menebak ejaan.
 * @param {string} nama
 * @returns {string}
 */
function _driverTidakAda(nama) {
    const drivers = db.getAllDrivers();

    return kartu({
        judul: `❌ *DRIVER TIDAK DITEMUKAN*`,
        isi: [
            `🔍 Dicari: ${tebal(nama)}`,
            ``,
            drivers.length
                ? `📋 *Driver terdaftar:*\n${cabang(drivers.map((d) => tebal(d.nama)))}`
                : `📋 ${miring('Belum ada driver terdaftar.')}`,
        ],
        kaki: [
            drivers.length
                ? `💡 Cukup tulis nama depannya, contoh: ${kode(drivers[0].nama.split(' ')[0])}`
                : `💡 Tambahkan driver dengan ${kode('/tambahdriver')}.`,
        ],
    });
}

/**
 * Cek jadwal libur semua driver
 * /ceklibur
 */
async function handleCekLibur(msg) {
    const drivers = db.getAllDrivers();

    if (drivers.length === 0) {
        return msg.reply(
            kartu({
                judul: `📅 *JADWAL OPERASIONAL DRIVER*`,
                isi: [`📋 Database driver masih kosong.`],
                kaki: [`💡 Tambahkan driver dengan ${kode('/tambahdriver')}.`],
            })
        );
    }

    const jadwal = db.getJadwal();
    const hariIni = getHariIni();

    // Dasar daftar adalah database driver, bukan file jadwal. Sebelumnya file
    // jadwal yang dipakai, sehingga driver tanpa entri jadwal tidak tampil
    // sama sekali dan sisa entri driver terhapus tetap muncul.
    const libur = [];
    const masuk = [];

    for (const d of drivers) {
        const hari = _hariLibur(jadwal, d.nama);
        (hari ? libur : masuk).push({ nama: d.nama, hari });
    }

    const offHariIni = libur.filter((d) => _samaHari(d.hari, hariIni));

    const isi = [];

    if (libur.length) {
        isi.push(`🏖️ *LIBUR TERJADWAL* (${libur.length})`);
        isi.push(
            cabang(
                libur.map((d) =>
                    `${tebal(d.nama)} — setiap ${tebal(d.hari)}${_samaHari(d.hari, hariIni) ? ' ← *hari ini*' : ''}`
                )
            )
        );
        isi.push(``);
    }

    if (masuk.length) {
        isi.push(`🟢 *MASUK SETIAP HARI* (${masuk.length})`);
        isi.push(cabang(masuk.map((d) => tebal(d.nama))));
        isi.push(``);
    }

    // Buang baris kosong terakhir supaya tidak ada celah sebelum garis penutup.
    if (isi[isi.length - 1] === '') isi.pop();

    const kaki = [
        `📆 Hari ini: ${tebal(hariIni)}`,
        offHariIni.length
            ? `🏖️ Libur hari ini: ${tebal(offHariIni.map((d) => d.nama).join(', '))}`
            : `🚚 Semua driver dijadwalkan masuk hari ini.`,
    ];

    // Entri sisa driver yang sudah dihapus hanya membingungkan, jadi
    // dilaporkan sebagai saran pembersihan alih-alih ditampilkan sebagai data.
    const yatim = Object.keys(jadwal).filter((n) => !db.findDriver(n).driver);
    if (yatim.length) {
        kaki.push(`⚠️ ${miring(`${yatim.length} entri jadwal tanpa driver: ${yatim.join(', ')}`)}`);
    }

    kaki.push(`💡 Ubah dengan ${kode('/setlibur [Nama] [Hari]')} atau ${kode('/setmasuk [Nama]')}.`);

    return msg.reply(kartu({ judul: `📅 *JADWAL OPERASIONAL DRIVER*`, isi, kaki }));
}

module.exports = {
    handleSetLibur,
    handleSetMasuk,
    handleCekLibur,
};
