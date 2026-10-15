// ══════════════════════════════════════════
// 💾 BACKUP — Cadangkan & pulihkan data bot
// ══════════════════════════════════════════
//
// Pindah VPS sebelumnya berarti mendaftar ulang semua user, driver, dan
// mengisi ulang saldo satu per satu. Modul ini membungkus seluruh data
// penting jadi satu berkas .tar.gz yang bisa dikirim lewat WhatsApp,
// lalu dipulihkan di VPS baru hanya dengan mengunggah berkas itu kembali.
//
// Yang ikut dicadangkan:
//   data/*.json   → akun user, saldo & mutasi, driver, jadwal libur
//   cookies/      → token sesi Google tiap driver
//   screenshots/  → foto reaction time milik driver
//
// Sesi WhatsApp (.wwebjs_auth) SENGAJA tidak ikut: ukurannya besar dan
// dua VPS yang memakai sesi sama sekaligus akan saling memutus koneksi.
// Setelah pulih di VPS baru, cukup pindai ulang QR satu kali.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const { ensureDir, hapusFileAman } = require('../utils/helpers');

const BACKUP_DIR = path.join(config.rootDir, 'backups');

/** Versi format arsip, dicatat di manifest supaya restore bisa menolak yang asing. */
const FORMAT_VERSI = 1;

/** Simpan maksimal sekian arsip lokal; sisanya dibuang dari yang terlama. */
const MAKS_ARSIP_LOKAL = 10;

/** WhatsApp menolak lampiran besar — di atas ini hanya disimpan lokal. */
const MAKS_UKURAN_KIRIM_WA = 45 * 1024 * 1024;

/** Isi arsip: folder/berkas sumber relatif terhadap root proyek. */
const ISI_ARSIP = ['data', 'cookies', 'screenshots'];

/** Berkas di dalam data/ yang tidak perlu ikut (log & status sementara). */
const KECUALIKAN = new Set(['bot.log', 'runtime.log', 'scheduler_state.json']);

function _jalankan(perintah, args, opsi = {}) {
    return new Promise((resolve, reject) => {
        execFile(perintah, args, { maxBuffer: 64 * 1024 * 1024, ...opsi }, (err, stdout, stderr) => {
            if (err) {
                err.message = `${perintah} gagal: ${(stderr || err.message).toString().trim()}`;
                return reject(err);
            }
            resolve(stdout);
        });
    });
}

/**
 * Stempel waktu untuk nama berkas: YYYYMMDD_HHMMSS (Asia/Jakarta).
 */
function _stempelWaktu(date = new Date()) {
    const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: config.cronTimezone || 'Asia/Jakarta',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});

    const jam = p.hour === '24' ? '00' : p.hour;
    return `${p.year}${p.month}${p.day}_${jam}${p.minute}${p.second}`;
}

function _ukuranTerbaca(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Hitung ringkasan isi data supaya admin bisa memverifikasi arsip tanpa membukanya.
 */
function _ringkasData() {
    const baca = (berkas) => {
        try {
            const isi = fs.readFileSync(path.join(config.dataDir, berkas), 'utf8');
            return JSON.parse(isi);
        } catch (e) {
            return null;
        }
    };

    const users = baca('database_user.json');
    const drivers = baca('database_driver.json');
    const wallet = baca('database_wallet.json');

    // Struktur: { "usr_xxx": { balance, transactions } }
    let totalSaldo = 0;
    let jumlahDompet = 0;
    if (wallet && typeof wallet === 'object') {
        for (const dompet of Object.values(wallet)) {
            const angka = Number(dompet && dompet.balance);
            if (Number.isFinite(angka)) { totalSaldo += angka; jumlahDompet++; }
        }
    }

    const hitung = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

    return {
        user: hitung(users && users.users ? users.users : users),
        driver: hitung(drivers),
        dompet: jumlahDompet,
        totalSaldo,
        cookie: fs.existsSync(config.cookieDir)
            ? fs.readdirSync(config.cookieDir).filter((f) => f.endsWith('.json')).length
            : 0,
        foto: fs.existsSync(config.screenshotDir)
            ? fs.readdirSync(config.screenshotDir).filter((f) => !f.startsWith('.')).length
            : 0,
    };
}

/**
 * Buat arsip cadangan.
 *
 * @param {Object} [opsi]
 * @param {string} [opsi.alasan] Pemicu backup, dicatat di manifest.
 * @returns {Promise<{berkas: string, nama: string, ukuran: number, ringkasan: Object}>}
 */
async function buatBackup(opsi = {}) {
    ensureDir(BACKUP_DIR);

    const stempel = _stempelWaktu();

    // Dua arsip dalam detik yang sama (mis. cadangan pra-restore) akan
    // bertabrakan nama dan saling menimpa, jadi beri akhiran bila perlu.
    let nama = `backup_autopetrip_${stempel}.tar.gz`;
    for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, nama)); i++) {
        nama = `backup_autopetrip_${stempel}-${i}.tar.gz`;
    }
    const tujuan = path.join(BACKUP_DIR, nama);

    const ringkasan = _ringkasData();

    // Siapkan area kerja sementara di luar proyek agar tidak ikut terarsip.
    const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'petrip-backup-'));
    const panggung = path.join(kerja, 'autopetrip-backup');
    fs.mkdirSync(panggung, { recursive: true });

    try {
        for (const bagian of ISI_ARSIP) {
            const sumber = path.join(config.rootDir, bagian);
            if (!fs.existsSync(sumber)) continue;

            const tujuanBagian = path.join(panggung, bagian);
            fs.mkdirSync(tujuanBagian, { recursive: true });

            for (const berkas of fs.readdirSync(sumber)) {
                if (KECUALIKAN.has(berkas)) continue;
                if (berkas.startsWith('.')) continue; // lewati .tmp dkk

                const asal = path.join(sumber, berkas);
                if (!fs.statSync(asal).isFile()) continue;
                fs.copyFileSync(asal, path.join(tujuanBagian, berkas));
            }
        }

        const manifest = {
            format: FORMAT_VERSI,
            dibuat: new Date().toISOString(),
            stempel,
            alasan: opsi.alasan || 'manual',
            host: os.hostname(),
            ringkasan,
        };
        fs.writeFileSync(path.join(panggung, 'manifest.json'), JSON.stringify(manifest, null, 2));

        await _jalankan('tar', ['-czf', tujuan, '-C', kerja, 'autopetrip-backup']);
    } finally {
        fs.rmSync(kerja, { recursive: true, force: true });
    }

    const ukuran = fs.statSync(tujuan).size;
    _pangkasArsipLama();

    logger.success('BACKUP', `Arsip dibuat: ${nama} (${_ukuranTerbaca(ukuran)}, pemicu: ${opsi.alasan || 'manual'})`);
    return { berkas: tujuan, nama, ukuran, ringkasan };
}

/**
 * Buang arsip terlama supaya disk VPS tidak penuh.
 */
function _pangkasArsipLama() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) return;
        const arsip = fs.readdirSync(BACKUP_DIR)
            .filter((f) => f.startsWith('backup_autopetrip_') && f.endsWith('.tar.gz'))
            .map((f) => ({ f, waktu: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
            .sort((a, b) => b.waktu - a.waktu);

        for (const lama of arsip.slice(MAKS_ARSIP_LOKAL)) {
            hapusFileAman(path.join(BACKUP_DIR, lama.f));
        }
    } catch (e) {
        logger.debug('BACKUP', `Pemangkasan arsip lama dilewati: ${e.message}`);
    }
}

/**
 * Pulihkan data dari arsip.
 *
 * Data lama TIDAK langsung ditimpa: sebelum menulis, kondisi saat ini
 * diarsipkan dulu sebagai cadangan pra-restore. Jadi kalau arsip yang
 * diunggah ternyata salah, data sebelumnya masih bisa dikembalikan.
 *
 * @param {string} arsipPath Lokasi berkas .tar.gz
 * @returns {Promise<{manifest: Object, dipulihkan: Object, cadanganSebelum: string}>}
 */
async function pulihkanBackup(arsipPath) {
    if (!fs.existsSync(arsipPath)) {
        throw new Error('Berkas cadangan tidak ditemukan.');
    }

    const kerja = fs.mkdtempSync(path.join(os.tmpdir(), 'petrip-restore-'));

    try {
        try {
            await _jalankan('tar', ['-xzf', arsipPath, '-C', kerja]);
        } catch (e) {
            throw new Error('Berkas tidak bisa dibuka. Pastikan ini arsip backup .tar.gz dari bot ini.');
        }

        // Arsip dibuat dengan folder pembungkus; terima juga arsip tanpa pembungkus.
        let akar = path.join(kerja, 'autopetrip-backup');
        if (!fs.existsSync(akar)) akar = kerja;

        const manifestPath = path.join(akar, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('Arsip tidak memiliki manifest.json — bukan cadangan bot ini.');
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.format > FORMAT_VERSI) {
            throw new Error(`Arsip dibuat versi bot yang lebih baru (format ${manifest.format}). Perbarui bot dulu.`);
        }

        // Amankan kondisi sekarang sebelum menimpa apa pun.
        const cadangan = await buatBackup({ alasan: 'pra-restore otomatis' });

        const dipulihkan = {};
        for (const bagian of ISI_ARSIP) {
            const sumber = path.join(akar, bagian);
            if (!fs.existsSync(sumber)) continue;

            const tujuan = path.join(config.rootDir, bagian);
            ensureDir(tujuan);

            let n = 0;
            for (const berkas of fs.readdirSync(sumber)) {
                const asal = path.join(sumber, berkas);
                if (!fs.statSync(asal).isFile()) continue;
                fs.copyFileSync(asal, path.join(tujuan, berkas));
                n++;
            }
            dipulihkan[bagian] = n;
        }

        logger.success('BACKUP', `Pemulihan selesai dari arsip ${manifest.stempel || '-'}.`);
        return { manifest, dipulihkan, cadanganSebelum: cadangan.nama };
    } finally {
        fs.rmSync(kerja, { recursive: true, force: true });
    }
}

/**
 * Daftar arsip yang tersimpan di VPS, terbaru lebih dulu.
 */
function daftarBackup() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('backup_autopetrip_') && f.endsWith('.tar.gz'))
        .map((f) => {
            const stat = fs.statSync(path.join(BACKUP_DIR, f));
            return { nama: f, berkas: path.join(BACKUP_DIR, f), ukuran: stat.size, waktu: stat.mtime };
        })
        .sort((a, b) => b.waktu - a.waktu);
}

// ── Cadangan otomatis setelah transaksi penting ──
//
// Topup dan penyesuaian saldo adalah data yang paling mahal bila hilang
// (harus diisi ulang manual satu per satu). Tapi menulis arsip pada setiap
// transaksi membuang I/O, jadi penulisan ditunda sebentar dan beberapa
// transaksi beruntun digabung jadi satu arsip.

const TUNDA_OTOMATIS_MS = 60 * 1000;
let timerOtomatis = null;
let alasanTertunda = new Set();

/**
 * Jadwalkan cadangan otomatis. Panggilan beruntun digabung jadi satu arsip.
 * Kegagalan sengaja tidak dilempar supaya tidak pernah menggagalkan transaksi.
 *
 * @param {string} alasan Pemicu, dicatat di manifest.
 */
function jadwalkanBackupOtomatis(alasan = 'transaksi') {
    alasanTertunda.add(alasan);
    if (timerOtomatis) return;

    timerOtomatis = setTimeout(async () => {
        const alasanGabungan = [...alasanTertunda].join(', ');
        timerOtomatis = null;
        alasanTertunda = new Set();

        try {
            await buatBackup({ alasan: `otomatis — ${alasanGabungan}` });
        } catch (e) {
            logger.warn('BACKUP', `Cadangan otomatis gagal: ${e.message}`);
        }
    }, TUNDA_OTOMATIS_MS);

    if (timerOtomatis.unref) timerOtomatis.unref();
}

module.exports = {
    buatBackup,
    pulihkanBackup,
    daftarBackup,
    jadwalkanBackupOtomatis,
    BACKUP_DIR,
    MAKS_UKURAN_KIRIM_WA,
    _ukuranTerbaca,
};
