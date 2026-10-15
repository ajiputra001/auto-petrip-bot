// ══════════════════════════════════════════
// 🛡️ COMMAND ADMIN MASSAL — /adjustsemua, /hapusakun
// ══════════════════════════════════════════
//
// Mengisi saldo satu per satu lewat /adjust jadi melelahkan begitu jumlah
// driver bertambah. Modul ini menambahkan pengisian saldo massal (semua
// atau pilih sebagian), serta penghapusan akun yang sebelumnya belum ada
// sama sekali — yang tersedia hanya penghapusan driver.

const auth = require('../auth');
const wallet = require('../wallet');
const { formatRupiah } = require('../utils/helpers');
const logger = require('../utils/logger');
const { clearAllWaSessions } = require('./akun');

/** Konfirmasi tertunda per chat: aksi berisiko tidak dijalankan sekali ketik. */
const menunggu = new Map();
const KONFIRMASI_BERLAKU_MS = 3 * 60 * 1000;

function _isAdmin(msg) {
    return require('./admin').isAdmin(msg);
}

function _tolak(msg) {
    return msg.reply('❌ *AKSES DITOLAK*\nPerintah ini khusus admin.');
}

function _kunci(msg) {
    return msg.safeChatId || msg.from;
}

function _simpanKonfirmasi(msg, data) {
    menunggu.set(_kunci(msg), { ...data, kedaluwarsa: Date.now() + KONFIRMASI_BERLAKU_MS });
}

function _ambilKonfirmasi(msg, jenis) {
    const k = _kunci(msg);
    const d = menunggu.get(k);
    if (!d || d.jenis !== jenis) return null;
    menunggu.delete(k);
    return Date.now() > d.kedaluwarsa ? null : d;
}

/**
 * Daftar penerima saldo massal: akun aktif yang sudah tertaut driver.
 * Akun nonaktif & yang belum punya driver dilewati supaya saldo tidak
 * terbuang ke akun yang tidak dipakai absen.
 */
function _calonPenerima() {
    return auth.listUsers().filter((u) => u.isActive !== false && u.driverNama);
}

function _barisUser(u, i) {
    return `${i + 1}. *${u.nama}*\n` +
        `    ${u.email}\n` +
        `    🚚 ${u.driverNama || '—'}  💰 ${formatRupiah(wallet.getBalance(u.id))}\n`;
}

/**
 * Terjemahkan pilihan admin ("semua", "1,3,4", "2-5") menjadi daftar user.
 * @returns {{ pilihan: Array<Object>, galat?: string }}
 */
function _pilihDariNomor(teks, kandidat) {
    const bersih = String(teks || '').trim().toLowerCase();
    if (!bersih || bersih === 'semua' || bersih === 'all') {
        return { pilihan: kandidat };
    }

    const indeks = new Set();
    for (const bagian of bersih.split(/[,\s]+/).filter(Boolean)) {
        const rentang = bagian.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rentang) {
            const [a, b] = [Number(rentang[1]), Number(rentang[2])];
            for (let n = Math.min(a, b); n <= Math.max(a, b); n++) indeks.add(n);
            continue;
        }
        if (!/^\d+$/.test(bagian)) {
            return { pilihan: [], galat: `Pilihan "${bagian}" bukan nomor yang valid.` };
        }
        indeks.add(Number(bagian));
    }

    const pilihan = [];
    for (const n of [...indeks].sort((a, b) => a - b)) {
        if (n < 1 || n > kandidat.length) {
            return { pilihan: [], galat: `Nomor ${n} di luar daftar (1–${kandidat.length}).` };
        }
        pilihan.push(kandidat[n - 1]);
    }
    return { pilihan };
}

/**
 * /adjustsemua [nominal] [nomor...] — tambah/potong saldo banyak user sekaligus.
 *
 * Contoh:
 *   /adjustsemua 50000              → semua user aktif bertaut driver
 *   /adjustsemua 50000 1,3,4        → hanya nomor 1, 3, dan 4
 *   /adjustsemua 50000 2-5          → nomor 2 sampai 5
 *   /adjustsemua -10000             → potong saldo semua
 */
async function handleAdjustSemua(msg, pesan, waClient) {
    if (!_isAdmin(msg)) return _tolak(msg);

    const args = pesan.trim().split(/\s+/).filter(Boolean).slice(1);
    const kandidat = _calonPenerima();

    if (!kandidat.length) {
        return msg.reply(
            `📭 *TIDAK ADA PENERIMA*\n` +
            `Belum ada akun aktif yang tertaut ke driver.\n\n` +
            `💡 Tautkan dulu: \`/linkdriveruser [email] [Nama Driver]\``
        );
    }

    // ── Tanpa argumen: tampilkan daftar bernomor + cara pakai ──
    if (!args.length) {
        let teks = `💰 *TAMBAH SALDO MASSAL*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        kandidat.forEach((u, i) => { teks += _barisUser(u, i); });
        teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        teks += `👥 ${kandidat.length} akun siap menerima\n\n`;
        teks += `*Cara pakai:*\n`;
        teks += `• \`/adjustsemua 50000\` — semua akun di atas\n`;
        teks += `• \`/adjustsemua 50000 1,3\` — hanya nomor 1 & 3\n`;
        teks += `• \`/adjustsemua 50000 2-4\` — nomor 2 sampai 4\n`;
        teks += `• \`/adjustsemua -10000\` — potong saldo (nominal minus)`;
        return msg.reply(teks);
    }

    // "ya"/"batal" harus diperiksa sebelum argumen diperlakukan sebagai nominal.
    const perintah = String(args[0]).toLowerCase();
    if (['ya', 'yes', 'lanjut'].includes(perintah)) {
        const tertunda = _ambilKonfirmasi(msg, 'adjust');
        if (!tertunda) {
            return msg.reply(
                `⏰ *TIDAK ADA PERMINTAAN AKTIF*\n` +
                `Mulai lagi dengan \`/adjustsemua [nominal]\`.`
            );
        }
        return _jalankanAdjust(msg, waClient, tertunda.nominal, tertunda.userIds);
    }
    if (['batal', 'cancel', 'tidak'].includes(perintah)) {
        const ada = _ambilKonfirmasi(msg, 'adjust');
        return msg.reply(ada
            ? `🚫 Dibatalkan. Saldo tidak diubah.`
            : `🚫 Tidak ada permintaan yang menunggu.`);
    }

    const nominal = Number(args[0]);
    if (!Number.isFinite(nominal) || nominal === 0) {
        return msg.reply(
            `❌ *NOMINAL TIDAK VALID*\n` +
            `Masukkan angka, misal \`50000\` untuk menambah atau \`-10000\` untuk memotong.`
        );
    }

    const { pilihan, galat } = _pilihDariNomor(args.slice(1).join(' '), kandidat);
    if (galat) return msg.reply(`❌ *PILIHAN TIDAK VALID*\n${galat}`);
    if (!pilihan.length) return msg.reply(`❌ Tidak ada akun yang terpilih.`);

    // Pemotongan massal bisa mengosongkan banyak dompet sekaligus, jadi
    // ditahan dulu di layar konfirmasi.
    const total = Math.abs(nominal) * pilihan.length;
    let teks = `⚠️ *KONFIRMASI SALDO MASSAL*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `${nominal > 0 ? '➕ Menambah' : '➖ Memotong'} *${formatRupiah(Math.abs(nominal))}* per akun\n`;
    teks += `👥 Penerima: *${pilihan.length}* akun\n`;
    teks += `🧮 Total dana: *${formatRupiah(total)}*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    pilihan.forEach((u) => { teks += `• ${u.nama} (${u.driverNama})\n`; });
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `✅ Ketik \`/adjustsemua ya\` untuk lanjut\n`;
    teks += `🚫 Ketik \`/adjustsemua batal\` untuk membatalkan\n\n_Berlaku 3 menit._`;

    _simpanKonfirmasi(msg, { jenis: 'adjust', nominal, userIds: pilihan.map((u) => u.id) });
    return msg.reply(teks);
}

/**
 * Lakukan mutasi saldo untuk daftar user, lalu laporkan hasilnya.
 *
 * Diekspor agar panel `/admin` bisa langsung mengeksekusi setelah
 * konfirmasi tombolnya sendiri, tanpa memaksa admin mengetik ulang
 * `/adjustsemua ya`.
 */
async function _jalankanAdjust(msg, waClient, nominal, userIds) {
    await msg.reply(`⚡ Memproses ${userIds.length} akun...`);

    const berhasil = [];
    const gagal = [];

    for (const userId of userIds) {
        const user = auth.findUserById(userId);
        if (!user) {
            gagal.push({ nama: userId, alasan: 'akun sudah tidak ada' });
            continue;
        }

        const r = wallet.mutateBalance(
            userId, nominal, 'ADJUST', 'Penyesuaian saldo massal oleh admin',
            { admin: msg.from, massal: true }
        );

        if (r.success) {
            berhasil.push({ nama: user.nama, saldo: r.balance });
        } else {
            gagal.push({ nama: user.nama, alasan: r.error });
        }
    }

    let teks = `${gagal.length ? '⚠️' : '✅'} *SALDO MASSAL SELESAI*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    teks += `${nominal > 0 ? '➕' : '➖'} ${formatRupiah(Math.abs(nominal))} per akun\n\n`;

    if (berhasil.length) {
        teks += `*Berhasil (${berhasil.length}):*\n`;
        berhasil.forEach((b) => { teks += `✅ ${b.nama} → ${formatRupiah(b.saldo)}\n`; });
    }
    if (gagal.length) {
        teks += `\n*Gagal (${gagal.length}):*\n`;
        gagal.forEach((g) => { teks += `❌ ${g.nama} — ${g.alasan}\n`; });
    }
    teks += `━━━━━━━━━━━━━━━━━━━━━━\n💾 _Cadangan otomatis dibuat._`;

    logger.success('ADMIN', `Saldo massal ${nominal} untuk ${berhasil.length} akun oleh ${msg.from}`);
    await msg.reply(teks);

    // Beri tahu tiap pemilik akun agar tidak bingung saldonya berubah.
    if (waClient && nominal !== 0) {
        const { getWaNumbersByUserId } = require('./akun');
        for (const userId of userIds) {
            const user = auth.findUserById(userId);
            if (!user) continue;
            for (const wa of getWaNumbersByUserId(userId)) {
                try {
                    await waClient.sendMessage(wa,
                        `${nominal > 0 ? '💰 *SALDO DITAMBAHKAN*' : '➖ *SALDO DISESUAIKAN*'}\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `${nominal > 0 ? '+' : ''}${formatRupiah(nominal)} oleh admin\n` +
                        `💳 Saldo sekarang: *${formatRupiah(wallet.getBalance(userId))}*`);
                } catch (e) {
                    logger.debug('ADMIN', `Notifikasi saldo ke ${wa} gagal: ${e.message}`);
                }
            }
        }
    }
}

/**
 * /hapusakun [email] — hapus akun user permanen (beserta dompet & sesinya).
 */
async function handleHapusAkun(msg, pesan) {
    if (!_isAdmin(msg)) return _tolak(msg);

    const args = pesan.trim().split(/\s+/).filter(Boolean).slice(1);
    const argumen = (args[0] || '').toLowerCase();

    // ── Konfirmasi ──
    if (['ya', 'yes', 'lanjut'].includes(argumen)) {
        const tertunda = _ambilKonfirmasi(msg, 'hapusakun');
        if (!tertunda) {
            return msg.reply(
                `⏰ *TIDAK ADA PERMINTAAN AKTIF*\n` +
                `Mulai lagi dengan \`/hapusakun [email]\`.`
            );
        }

        const user = auth.findUserById(tertunda.userId);
        if (!user) return msg.reply(`❌ Akun sudah tidak ada.`);

        // Cadangkan dulu supaya penghapusan yang salah masih bisa dibatalkan.
        let namaArsip = null;
        try {
            const arsip = await require('../services/backup').buatBackup({
                alasan: `pra-hapus akun ${user.email}`,
            });
            namaArsip = arsip.nama;
        } catch (e) {
            logger.warn('ADMIN', `Cadangan pra-hapus akun gagal: ${e.message}`);
        }

        const hapus = auth.deleteUser(user.id);
        if (!hapus.success) return msg.reply(`❌ *GAGAL MENGHAPUS*\n_${hapus.error}_`);

        const dompet = wallet.removeWallet(user.id);
        const sesi = clearAllWaSessions(user.id);

        logger.warn('ADMIN', `Akun ${user.email} dihapus oleh ${msg.from}`);
        return msg.reply(
            `✅ *AKUN DIHAPUS*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 ${user.nama}\n📧 ${user.email}\n` +
            `💰 Saldo terhapus: ${formatRupiah(dompet.saldoTerakhir)}\n` +
            `🔓 Sesi dicabut : ${sesi}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            (namaArsip
                ? `🛟 Dicadangkan dulu sebagai:\n\`${namaArsip}\`\n_Pulihkan dengan \`/restore\` bila salah hapus._`
                : `⚠️ _Cadangan gagal dibuat — penghapusan tidak bisa dibatalkan._`) +
            `\n\n💡 Data driver *tidak* ikut terhapus. Pakai \`/hapusdriver\` bila perlu.`
        );
    }

    if (['batal', 'cancel', 'tidak'].includes(argumen)) {
        const ada = _ambilKonfirmasi(msg, 'hapusakun');
        return msg.reply(ada ? `🚫 Penghapusan dibatalkan.` : `🚫 Tidak ada permintaan yang menunggu.`);
    }

    // ── Tanpa argumen: tampilkan daftar akun ──
    if (!args.length) {
        const users = auth.listUsers();
        let teks = `🗑️ *HAPUS AKUN*\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        users.forEach((u, i) => {
            teks += `${i + 1}. *${u.nama}* ${u.role === 'admin' ? '🛡️' : ''}\n`;
            teks += `    ${u.email}\n`;
            teks += `    🚚 ${u.driverNama || '—'}  💰 ${formatRupiah(wallet.getBalance(u.id))}\n`;
        });
        teks += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        teks += `Gunakan: \`/hapusakun [email]\`\n`;
        teks += `Contoh: \`/hapusakun budi@gmail.com\``;
        return msg.reply(teks);
    }

    const email = args[0];
    const user = auth.findUserByEmail(email);
    if (!user) return msg.reply(`❌ Akun *${email}* tidak ditemukan.\nLihat daftar: \`/hapusakun\``);

    // Admin tidak boleh menghapus akunnya sendiri: ia akan langsung kehilangan
    // hak akses dan tidak bisa membatalkannya lewat WhatsApp.
    const { getUserIdByWa, getSenderWa } = require('./akun');
    if (getUserIdByWa(getSenderWa(msg)) === user.id) {
        return msg.reply(
            `❌ *TIDAK BISA MENGHAPUS DIRI SENDIRI*\n` +
            `Anda akan langsung kehilangan akses admin.\n` +
            `Minta admin lain melakukannya bila memang perlu.`
        );
    }

    _simpanKonfirmasi(msg, { jenis: 'hapusakun', userId: user.id });

    return msg.reply(
        `⚠️ *KONFIRMASI HAPUS AKUN*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 ${user.nama} ${user.role === 'admin' ? '🛡️ *(ADMIN)*' : ''}\n` +
        `📧 ${user.email}\n` +
        `🚚 Driver: ${user.driverNama || '—'}\n` +
        `💰 Saldo : *${formatRupiah(wallet.getBalance(user.id))}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Akun, saldo & riwayat transaksinya akan *DIHAPUS PERMANEN*.\n` +
        `_(Dicadangkan otomatis sebelum dihapus.)_\n\n` +
        `✅ Ketik \`/hapusakun ya\` untuk lanjut\n` +
        `🚫 Ketik \`/hapusakun batal\` untuk membatalkan\n\n_Berlaku 3 menit._`
    );
}

/**
 * Hapus akun secara langsung (dipakai panel `/admin` setelah konfirmasinya
 * sendiri). Pengaman admin-terakhir tetap berlaku lewat auth.deleteUser().
 *
 * @param {Object} msg
 * @param {string} userId
 */
async function jalankanHapusAkun(msg, userId) {
    const user = auth.findUserById(userId);
    if (!user) return msg.reply(`❌ Akun sudah tidak ada.`);

    const { getUserIdByWa, getSenderWa } = require('./akun');
    if (getUserIdByWa(getSenderWa(msg)) === user.id) {
        return msg.reply(
            `❌ *TIDAK BISA MENGHAPUS DIRI SENDIRI*\n` +
            `Anda akan langsung kehilangan akses admin.`
        );
    }

    let namaArsip = null;
    try {
        const arsip = await require('../services/backup').buatBackup({
            alasan: `pra-hapus akun ${user.email}`,
        });
        namaArsip = arsip.nama;
    } catch (e) {
        logger.warn('ADMIN', `Cadangan pra-hapus akun gagal: ${e.message}`);
    }

    const hapus = auth.deleteUser(user.id);
    if (!hapus.success) return msg.reply(`❌ *GAGAL MENGHAPUS*\n_${hapus.error}_`);

    const dompet = wallet.removeWallet(user.id);
    const sesi = clearAllWaSessions(user.id);

    logger.warn('ADMIN', `Akun ${user.email} dihapus oleh ${msg.from}`);
    return msg.reply(
        `✅ *AKUN DIHAPUS*\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 ${user.nama}\n📧 ${user.email}\n` +
        `💰 Saldo terhapus: ${formatRupiah(dompet.saldoTerakhir)}\n` +
        `🔓 Sesi dicabut : ${sesi}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        (namaArsip
            ? `🛟 Dicadangkan dulu sebagai:\n\`${namaArsip}\`\n_Pulihkan dengan \`/restore\` bila salah hapus._`
            : `⚠️ _Cadangan gagal dibuat — penghapusan tidak bisa dibatalkan._`) +
        `\n\n💡 Data driver *tidak* ikut terhapus. Pakai \`/hapusdriver\` bila perlu.`
    );
}

module.exports = {
    handleAdjustSemua,
    handleHapusAkun,
    jalankanAdjustMassal: _jalankanAdjust,
    jalankanHapusAkun,
    calonPenerima: _calonPenerima,
    pilihDariNomor: _pilihDariNomor,
};
