// ══════════════════════════════════════════
// 💾 COMMAND: /backup, /restore, /listbackup
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const os = require('os');
const { MessageMedia } = require('whatsapp-web.js');
const backup = require('../services/backup');
const { downloadMediaRobust } = require('../utils/media-downloader');
const logger = require('../utils/logger');
const { kartu, kode, tebal, miring, cabang } = require('../utils/tampilan');

// Restore menimpa seluruh data, jadi butuh konfirmasi eksplisit.
// Kunci berisi berkas yang menunggu beserta kedaluwarsanya.
const menungguKonfirmasi = new Map();
const KONFIRMASI_BERLAKU_MS = 5 * 60 * 1000;

// Pengiriman arsip ke WhatsApp bisa gagal sesaat saat sesi browser sibuk
const MAX_PERCOBAAN_KIRIM = 3;
const JEDA_KIRIM_ULANG_MS = 5000;

function _isAdmin(msg) {
    // Dimuat saat dipanggil untuk menghindari lingkar impor dengan admin.js
    return require('./admin').isAdmin(msg);
}

/**
 * Nama berkas dari WhatsApp tidak boleh dipercaya: "../../.env" akan menulis
 * ke luar folder sementara. Ambil nama dasarnya saja dan buang karakter aneh.
 */
function _namaAman(nama) {
    const dasar = path.basename(String(nama || '')).replace(/[^\w.\-]/g, '_');
    return dasar && dasar !== '.' && dasar !== '..' ? dasar : 'backup.tar.gz';
}

/**
 * Hapus berkas unggahan sementara beserta folder pembungkusnya.
 */
function _bersihkanUnggahan(berkas) {
    try {
        if (!berkas) return;
        fs.rmSync(path.dirname(berkas), { recursive: true, force: true });
    } catch (e) {
        require('../utils/helpers').hapusFileAman(berkas);
    }
}

/**
 * Buang permintaan restore yang menggantung beserta berkasnya.
 */
function _batalkanTertunda(kunci) {
    const tertunda = menungguKonfirmasi.get(kunci);
    if (!tertunda) return null;
    if (tertunda.timer) clearTimeout(tertunda.timer);
    menungguKonfirmasi.delete(kunci);
    _bersihkanUnggahan(tertunda.berkas);
    return tertunda;
}

/**
 * Arsip berisi cookie & data pribadi; jangan dibiarkan menganggur di /tmp
 * hanya karena admin lupa mengetik konfirmasi.
 */
function _pasangKedaluwarsa(kunci) {
    const timer = setTimeout(() => {
        const tertunda = menungguKonfirmasi.get(kunci);
        if (!tertunda) return;
        menungguKonfirmasi.delete(kunci);
        _bersihkanUnggahan(tertunda.berkas);
        logger.debug('BACKUP', `Permintaan restore ${kunci} kedaluwarsa, berkas sementara dibuang.`);
    }, KONFIRMASI_BERLAKU_MS + 5000);

    if (timer.unref) timer.unref();
    return timer;
}

function _tolak(msg) {
    return msg.reply('❌ *AKSES DITOLAK*\nPerintah ini khusus admin.');
}

function _ringkasanTeks(r) {
    return cabang([
        `👤 Akun user: ${tebal(r.user)}`,
        `🚚 Driver: ${tebal(r.driver)}`,
        `💰 Dompet: ${tebal(r.dompet)} (total Rp ${r.totalSaldo.toLocaleString('id-ID')})`,
        `🍪 Cookie: ${tebal(r.cookie)} berkas`,
        `🖼️ Foto driver: ${tebal(r.foto)} berkas`,
    ]);
}

/**
 * /backup — buat arsip lalu kirim sebagai dokumen WhatsApp.
 */
async function handleBackup(msg, pesan, waClient) {
    if (!_isAdmin(msg)) return _tolak(msg);

    await msg.reply('💾 *MEMBUAT CADANGAN*\n_Mengemas data, cookie & foto driver..._');

    try {
        const hasil = await backup.buatBackup({ alasan: 'perintah /backup' });
        const ukuran = backup._ukuranTerbaca(hasil.ukuran);

        const isi = [
            `📦 ${kode(hasil.nama)}`,
            `📏 Ukuran: ${tebal(ukuran)}`,
            ``,
            `📋 *Isi cadangan*`,
            _ringkasanTeks(hasil.ringkasan),
        ];

        if (hasil.ukuran > backup.MAKS_UKURAN_KIRIM_WA) {
            return msg.reply(kartu({
                judul: `⚠️ *CADANGAN TERLALU BESAR*`,
                isi,
                kaki: [
                    `Berkas melebihi batas kirim WhatsApp.`,
                    `💡 Ambil manual dari VPS:`,
                    kode(hasil.berkas),
                ],
            }));
        }

        await msg.reply(kartu({
            judul: `✅ *CADANGAN SIAP*`,
            isi,
            kaki: [
                `📎 ${miring('Berkas dikirim menyusul di bawah ini.')}`,
                `💡 Simpan baik-baik. Saat pindah VPS, kirim balik dengan ${kode('/restore')}.`,
            ],
        }));

        const terkirim = await kirimArsip(waClient, msg.safeChatId || msg.from, hasil, {
            caption: `💾 Cadangan Auto-Petrip — ${hasil.nama}`,
        });

        if (terkirim) {
            logger.success('BACKUP', `Arsip ${hasil.nama} terkirim ke ${msg.from}`);
        } else {
            // Arsipnya sendiri sudah jadi & aman di VPS — yang gagal hanya
            // pengirimannya, jadi jangan sampai terbaca seolah backup batal.
            await msg.reply(kartu({
                judul: `⚠️ *ARSIP DIBUAT, GAGAL DIKIRIM*`,
                isi: [
                    `📦 ${kode(hasil.nama)}`,
                    `📏 Ukuran: ${tebal(ukuran)}`,
                    ``,
                    `Cadangan ${tebal('aman tersimpan')} di server, tetapi WhatsApp menolak mengirim berkasnya.`,
                ],
                kaki: [
                    `💡 Coba lagi dengan ${kode('/backup')}, atau ambil manual:`,
                    kode(hasil.berkas),
                ],
            }));
        }
    } catch (e) {
        logger.error('BACKUP', `Gagal membuat cadangan: ${e.message}`);
        await msg.reply(`❌ *GAGAL MEMBUAT CADANGAN*\n_${e.message}_`);
    }
}

/**
 * Kirim arsip cadangan sebagai dokumen WhatsApp.
 *
 * Pengiriman diulang beberapa kali karena jaringan/unggahan bisa gagal sesaat.
 * Namun galat "Data passed to getter must include an id property" BUKAN galat
 * sementara: itu bug whatsapp-web.js yang membuat semua pengiriman berkas
 * gagal, dan sudah ditambal oleh scripts/patch-wwebjs.js. Bila galat itu masih
 * muncul, tambalannya belum terpasang — mengulang tidak akan menolong, jadi
 * berhenti lebih awal dan beri tahu cara memperbaikinya.
 *
 * @param {Object} waClient
 * @param {string} tujuan - Chat ID tujuan
 * @param {{ berkas: string, nama: string }} hasil
 * @param {{ caption?: string }} opsi
 * @returns {Promise<boolean>} true bila berkas benar-benar terkirim
 */
async function kirimArsip(waClient, tujuan, hasil, opsi = {}) {
    const { delay } = require('../utils/helpers');

    for (let percobaan = 1; percobaan <= MAX_PERCOBAAN_KIRIM; percobaan++) {
        try {
            // Dibaca ulang tiap percobaan: MessageMedia yang sudah gagal
            // dipakai bisa menyimpan state internal yang rusak.
            const media = MessageMedia.fromFilePath(hasil.berkas);
            media.mimetype = 'application/gzip';
            media.filename = hasil.nama;

            await waClient.sendMessage(tujuan, media, {
                sendMediaAsDocument: true,
                caption: opsi.caption || `💾 Cadangan Auto-Petrip — ${hasil.nama}`,
            });
            return true;
        } catch (e) {
            if (/must include an id property/i.test(e.message)) {
                logger.error('BACKUP',
                    'Pengiriman berkas diblokir bug whatsapp-web.js. ' +
                    'Jalankan "npm run patch:wwebjs" lalu mulai ulang bot.');
                return false;
            }

            logger.warn('BACKUP', `Pengiriman arsip gagal (${percobaan}/${MAX_PERCOBAAN_KIRIM}): ${e.message}`);
            if (percobaan < MAX_PERCOBAAN_KIRIM) await delay(JEDA_KIRIM_ULANG_MS);
        }
    }

    logger.error('BACKUP', `Arsip ${hasil.nama} tidak terkirim setelah ${MAX_PERCOBAAN_KIRIM} percobaan. Berkas tetap aman di ${hasil.berkas}`);
    return false;
}

/**
 * /listbackup — daftar arsip yang tersimpan di VPS.
 */
async function handleListBackup(msg) {
    if (!_isAdmin(msg)) return _tolak(msg);

    const arsip = backup.daftarBackup();
    if (!arsip.length) {
        return msg.reply('📭 Belum ada cadangan tersimpan.\nBuat sekarang dengan `/backup`.');
    }

    const isi = [];
    arsip.forEach((a, i) => {
        const waktu = a.waktu.toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
        if (i > 0) isi.push(``);
        isi.push(`${i + 1}. ${kode(a.nama)}`);
        isi.push(cabang([`📏 ${backup._ukuranTerbaca(a.ukuran)}  ·  📅 ${waktu}`]));
    });

    const totalUkuran = arsip.reduce((n, a) => n + a.ukuran, 0);

    return msg.reply(kartu({
        judul: `📦 *DAFTAR CADANGAN* (${arsip.length})`,
        isi,
        kaki: [
            `💾 Total: ${tebal(backup._ukuranTerbaca(totalUkuran))}`,
            `📂 Tersimpan di: ${kode(backup.BACKUP_DIR)}`,
            `💡 Kirim ulang arsip dengan ${kode('/restore')} untuk memulihkan.`,
        ],
    }));
}

/**
 * /restore — pulihkan data dari arsip yang dilampirkan.
 *
 * Alur dua langkah: lampirkan berkas → bot menampilkan isinya → admin
 * mengetik `/restore ya` untuk benar-benar menimpa data.
 */
async function handleRestore(msg, pesan, waClient) {
    if (!_isAdmin(msg)) return _tolak(msg);

    const argumen = pesan.replace(/^\/restore\s*/i, '').trim().toLowerCase();
    const kunci = msg.safeChatId || msg.from;

    // ── Langkah 2: konfirmasi ──
    if (['ya', 'yes', 'lanjut', 'konfirmasi'].includes(argumen)) {
        const tertunda = menungguKonfirmasi.get(kunci);

        if (!tertunda || Date.now() > tertunda.kedaluwarsa) {
            _batalkanTertunda(kunci);
            return msg.reply(
                '⏰ *TIDAK ADA PERMINTAAN AKTIF*\n' +
                'Kirim ulang berkas cadangan dengan perintah `/restore`.'
            );
        }

        // Hapus dari daftar tunggu lebih dulu supaya konfirmasi ganda
        // (admin mengetik "ya" dua kali) tidak memulihkan dua kali.
        menungguKonfirmasi.delete(kunci);
        if (tertunda.timer) clearTimeout(tertunda.timer);

        await msg.reply('♻️ *MEMULIHKAN DATA*\n_Mohon tunggu, jangan matikan bot..._');

        try {
            const hasil = await backup.pulihkanBackup(tertunda.berkas);
            const r = hasil.manifest.ringkasan || {};

            await msg.reply(kartu({
                judul: `✅ *PEMULIHAN BERHASIL*`,
                isi: [
                    `📅 Arsip dibuat: ${hasil.manifest.dibuat || '-'}`,
                    ``,
                    `📂 *Yang dipulihkan*`,
                    cabang(Object.entries(hasil.dipulihkan).map(([k, v]) => `${k}: ${v}`)),
                    ...(r.user !== undefined ? [``, `📋 *Isi data*`, _ringkasanTeks(r)] : []),
                ],
                kaki: [
                    `🛟 Data lama diamankan sebagai:`,
                    kode(hasil.cadanganSebelum),
                    ``,
                    `⚠️ ${tebal('WAJIB RESTART')} agar data baru dimuat:`,
                    kode('pm2 restart auto-petrip-bot'),
                ],
            }));
            logger.success('BACKUP', `Data dipulihkan oleh ${msg.from}`);
        } catch (e) {
            logger.error('BACKUP', `Pemulihan gagal: ${e.message}`);
            await msg.reply(`❌ *PEMULIHAN GAGAL*\n_${e.message}_\n\nData lama tidak diubah.`);
        } finally {
            _bersihkanUnggahan(tertunda.berkas);
        }
        return;
    }

    if (['batal', 'cancel', 'tidak'].includes(argumen)) {
        const tertunda = _batalkanTertunda(kunci);
        return msg.reply(tertunda
            ? '🚫 Pemulihan dibatalkan. Data tidak diubah.'
            : '🚫 Tidak ada permintaan pemulihan yang menunggu.');
    }

    // ── Langkah 1: terima berkas ──
    const unduh = await downloadMediaRobust(msg, waClient);
    if (!unduh.success || !unduh.media) {
        return msg.reply(kartu({
            judul: `📤 *KIRIM BERKAS CADANGAN*`,
            isi: [
                `Ada dua cara memulihkan data:`,
                cabang([
                    `Lampirkan arsip ${kode('.tar.gz')} + perintah ${kode('/restore')}`,
                    `Balas (reply) arsip yang sudah ada di chat dengan ${kode('/restore')}`,
                ]),
            ],
            kaki: [
                `💡 Belum punya arsip? Buat dulu dengan ${kode('/backup')}.`,
                `📦 Lihat arsip di VPS dengan ${kode('/listbackup')}.`,
            ],
        }));
    }

    const namaAsli = unduh.media.filename || 'backup.tar.gz';
    const namaBerkas = _namaAman(namaAsli);

    // Berkas disimpan di luar folder proyek supaya tidak ikut terarsip saat
    // cadangan pra-restore dibuat.
    const folderUnggah = fs.mkdtempSync(path.join(os.tmpdir(), 'petrip-upload-'));
    const sementara = path.join(folderUnggah, namaBerkas);
    fs.writeFileSync(sementara, Buffer.from(unduh.media.data, 'base64'));

    // Keaslian arsip dibuktikan oleh manifest di dalamnya, bukan oleh nama
    // berkasnya — WhatsApp kadang menanggalkan nama asli saat meneruskan
    // dokumen, dan arsip yang sah bisa ikut tertolak bila dinilai dari nama.
    let pratinjau = '';
    try {
        const manifest = await _intipManifest(sementara);
        pratinjau = [
            cabang([
                `📅 Dibuat: ${manifest.dibuat || '-'}`,
                `🖥️ Dari host: ${manifest.host || '-'}`,
            ]),
            ``,
            `📋 *Isi arsip*`,
            manifest.ringkasan ? _ringkasanTeks(manifest.ringkasan) : miring('Ringkasan tidak tersedia'),
        ].join('\n');
    } catch (e) {
        _bersihkanUnggahan(sementara);
        return msg.reply(kartu({
            judul: `❌ *ARSIP TIDAK VALID*`,
            isi: [
                `📄 Berkas: ${miring(namaAsli)}`,
                ``,
                `🔎 ${miring(e.message)}`,
            ],
            kaki: [`💡 Kirim arsip hasil ${kode('/backup')} (${kode('backup_autopetrip_*.tar.gz')}).`],
        }));
    }

    // Permintaan lama (kalau ada) dibatalkan supaya berkasnya tidak menumpuk.
    _batalkanTertunda(kunci);

    menungguKonfirmasi.set(kunci, {
        berkas: sementara,
        kedaluwarsa: Date.now() + KONFIRMASI_BERLAKU_MS,
        timer: _pasangKedaluwarsa(kunci),
    });

    return msg.reply(kartu({
        judul: `⚠️ *KONFIRMASI PEMULIHAN*`,
        isi: [
            `📦 ${kode(namaBerkas)}`,
            pratinjau,
            ``,
            `Yang akan ${tebal('DITIMPA')} oleh isi arsip:`,
            cabang(['Akun user & saldo', 'Data driver & jadwal', 'Cookie & foto driver']),
        ],
        kaki: [
            `🛟 ${miring('Data lama diamankan otomatis sebelum ditimpa.')}`,
            ``,
            `✅ Lanjut: ${kode('/restore ya')}`,
            `🚫 Batal: ${kode('/restore batal')}`,
            ``,
            `⏳ ${miring('Berlaku 5 menit.')}`,
        ],
    }));
}

/**
 * Baca manifest dari arsip tanpa memulihkan apa pun.
 *
 * Jalur manifest dicoba dua kali: susunan baku berpembungkus, lalu pola
 * bebas — sebagian alat kompresi membongkar ulang arsip tanpa pembungkus,
 * dan arsip seperti itu tetap sah untuk dipulihkan.
 */
function _intipManifest(arsipPath) {
    const { execFile } = require('child_process');

    const coba = (args) => new Promise((resolve) => {
        execFile('tar', args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
            resolve(err || !stdout ? null : stdout);
        });
    });

    return (async () => {
        const keluaran =
            await coba(['-xzOf', arsipPath, 'autopetrip-backup/manifest.json']) ||
            await coba(['-xzOf', arsipPath, '--wildcards', '*manifest.json']);

        if (!keluaran) {
            throw new Error('Bukan arsip cadangan bot ini (manifest.json tidak ditemukan).');
        }

        const teks = keluaran.toString().trim();
        try {
            return JSON.parse(teks);
        } catch (e) {
            // Pencocokan pola bebas bisa menyambung beberapa berkas sekaligus;
            // ambil objek JSON pertama yang utuh.
            const awal = teks.indexOf('{');
            const akhir = teks.indexOf('\n}');
            if (awal !== -1 && akhir > awal) {
                try {
                    return JSON.parse(teks.slice(awal, akhir + 2));
                } catch (e2) { /* jatuh ke pesan galat di bawah */ }
            }
            throw new Error('Manifest arsip rusak.');
        }
    })();
}

module.exports = { handleBackup, handleRestore, handleListBackup, kirimArsip };
