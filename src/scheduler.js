// ══════════════════════════════════════════
// ⏰ SCHEDULER — Cron Job Manager + Catch-Up
// ══════════════════════════════════════════

const path = require('path');
const cron = require('node-cron');
const config = require('./config');
const logger = require('./utils/logger');
const { prosesAbsenMassal } = require('./services/form-filler');
const { bersihkanLogLama, bersihkanZombieChrome } = require('./utils/self-healing');
const { bacaJSON, tulisJSON, ensureDir, withTimeout } = require('./utils/helpers');

const STATE_FILE = path.join(config.dataDir, 'scheduler_state.json');

// Batas waktu maksimal satu siklus absen massal (menghindari lock nyangkut selamanya)
const ABSEN_MAX_DURASI_MS = 20 * 60 * 1000;

// Interval pemeriksaan jadwal terlewat
const CATCHUP_INTERVAL_MS = 5 * 60 * 1000;

// Jadwal yang terlewat lebih dari 6 jam tidak dijalankan lagi
const CATCHUP_WINDOW_MS = 6 * 60 * 60 * 1000;

// Percobaan ulang bila ada driver yang gagal (cookie/browser bermasalah sesaat)
const MAX_PERCOBAAN = 3;
const RETRY_DELAY_MS = 10 * 60 * 1000;

let sedangBerjalan = false;

/**
 * Tanggal (YYYY-MM-DD) pada timezone cron.
 */
function _tanggalLokal(date = new Date()) {
    return date.toLocaleDateString('en-CA', { timeZone: config.cronTimezone });
}

/**
 * Menit sejak tengah malam pada timezone cron.
 */
function _menitLokal(date = new Date()) {
    const jam = date.toLocaleTimeString('en-GB', {
        timeZone: config.cronTimezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    });
    const [h, m] = jam.split(':').map(Number);
    return h * 60 + m;
}

function _bacaState() {
    ensureDir(config.dataDir);
    return bacaJSON(STATE_FILE) || {};
}

function _tulisState(state) {
    try {
        ensureDir(config.dataDir);
        tulisJSON(STATE_FILE, state);
    } catch (e) {
        logger.warn('SCHEDULER', `Gagal menyimpan state scheduler: ${e.message}`);
    }
}

/**
 * Ambil "menit sejak tengah malam" dari cron expression pola `M H * * *`.
 * @returns {number|null} null bila pola tidak sederhana
 */
function _menitJadwal(schedule) {
    const parts = String(schedule).trim().split(/\s+/);
    if (parts.length < 5) return null;
    const [menit, jam] = parts;
    if (!/^\d+$/.test(menit) || !/^\d+$/.test(jam)) return null;
    return Number(jam) * 60 + Number(menit);
}

/**
 * Jalankan absen massal dengan lock + timeout + catat state harian.
 * @param {Object} client
 * @param {string} alasan - 'cron' | 'catchup'
 */
async function jalankanAbsenOtomatis(client, alasan = 'cron') {
    if (sedangBerjalan) {
        logger.warn('SCHEDULER', `Absen otomatis (${alasan}) dilewati: siklus sebelumnya masih berjalan.`);
        return;
    }

    const hariIni = _tanggalLokal();
    let state = _bacaState();

    // Hari berganti → mulai dari nol
    if (state.tanggal !== hariIni) {
        state = { tanggal: hariIni, selesai: false, suksesNama: [] };
    }

    if (state.selesai) {
        logger.debug('SCHEDULER', `Absen otomatis (${alasan}) dilewati: sudah tuntas hari ini (${hariIni}).`);
        return;
    }

    sedangBerjalan = true;

    // Nama yang SUDAH sukses — jangan diisi ulang. Penting saat proses mati
    // (OOM) di tengah siklus lalu catch-up melanjutkan setelah restart.
    const sudahSukses = new Set(Array.isArray(state.suksesNama) ? state.suksesNama : []);

    if (sudahSukses.size > 0) {
        logger.warn('SCHEDULER', `Melanjutkan siklus yang terputus. Sudah sukses: ${[...sudahSukses].join(', ')}.`);
    }
    logger.system(`⏰ Absen massal otomatis dimulai (trigger: ${alasan}, tanggal: ${hariIni})...`);

    const catatSukses = (nama) => {
        sudahSukses.add(nama);
        _tulisState({
            tanggal: hariIni,
            selesai: false,
            suksesNama: [...sudahSukses],
            lastTrigger: alasan,
            lastAbsenAt: new Date().toISOString(),
        });
    };

    const tandaiSelesai = (catatan) => {
        _tulisState({
            tanggal: hariIni,
            selesai: true,
            suksesNama: [...sudahSukses],
            lastTrigger: alasan,
            selesaiAt: new Date().toISOString(),
            catatan,
        });
    };

    try {
        // Percobaan pertama: semua driver yang belum sukses.
        const hasil = await _jalankanSekali(client, null, `${alasan} (percobaan 1/${MAX_PERCOBAAN})`, {
            skipNama: [...sudahSukses],
            onSukses: catatSukses,
        });

        // hasil null = siklus error/timeout sebelum tuntas. Jangan tandai selesai:
        // biarkan catch-up melanjutkan driver yang belum sukses.
        if (!hasil) {
            logger.warn('SCHEDULER', 'Siklus terhenti sebelum tuntas. Catch-up akan melanjutkan driver yang belum sukses.');
            return;
        }

        let perluUlang = _namaPerluUlang(hasil);

        // Percobaan berikutnya: HANYA driver yang gagal karena gangguan sesaat.
        for (let percobaan = 2; percobaan <= MAX_PERCOBAAN && perluUlang.length > 0; percobaan++) {
            logger.warn('SCHEDULER', `${perluUlang.length} driver gagal (${perluUlang.join(', ')}). Mencoba ulang dalam ${RETRY_DELAY_MS / 60000} menit...`);
            bersihkanZombieChrome();
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

            const sisa = [];
            for (const nama of perluUlang) {
                const ulang = await _jalankanSekali(
                    client,
                    nama,
                    `${alasan} (ulang ${percobaan}/${MAX_PERCOBAAN}: ${nama})`,
                    { onSukses: catatSukses }
                );
                sisa.push(..._namaPerluUlang(ulang, nama));
            }
            perluUlang = sisa;
        }

        if (perluUlang.length === 0) {
            tandaiSelesai(`${sudahSukses.size} driver sukses`);
            logger.success('SCHEDULER', `Absen massal otomatis selesai (trigger: ${alasan}, sukses: ${sudahSukses.size}).`);
        } else {
            // Ditandai selesai agar catch-up tidak mengulang terus-menerus;
            // sisanya butuh tindakan manual (cookie/saldo/form berubah).
            tandaiSelesai(`gagal permanen: ${perluUlang.join(', ')}`);
            logger.error('SCHEDULER', `Masih gagal setelah ${MAX_PERCOBAAN} percobaan: ${perluUlang.join(', ')}. Perlu pemeriksaan manual.`);
        }
    } finally {
        sedangBerjalan = false;
        // Timeout di atas bisa meninggalkan browser form-filler menggantung → pastikan mati.
        bersihkanZombieChrome();
    }
}

/**
 * Jalankan satu siklus absen (semua driver atau satu nama) dengan timeout.
 * @returns {Promise<Object|null>} hasil prosesAbsenMassal, null bila error/timeout
 */
async function _jalankanSekali(client, targetNama, label, options = {}) {
    try {
        return await withTimeout(
            prosesAbsenMassal(client, targetNama, null, options),
            ABSEN_MAX_DURASI_MS,
            'prosesAbsenMassal'
        );
    } catch (error) {
        logger.error('SCHEDULER', `Absen error [${label}]: ${error.message}`);
        bersihkanZombieChrome();
        return null;
    }
}

/**
 * Nama driver yang layak dicoba ulang. Kegagalan permanen (saldo kosong,
 * cookie kedaluwarsa, file hilang) dilewati karena retry tidak akan menolong.
 * @param {Object|null} hasil
 * @param {string|null} fallbackNama - dipakai bila hasil null (error/timeout)
 * @returns {string[]}
 */
function _namaPerluUlang(hasil, fallbackNama = null) {
    if (!hasil) return fallbackNama ? [fallbackNama] : [];

    // Pola harus SPESIFIK. Kata umum seperti "tidak ditemukan" akan salah
    // menangkap error transient ("Form berubah: input teks ... tidak ditemukan").
    const permanen = [
        'saldo',
        'cookie kedaluwarsa',
        'belum punya akun',
        'token sesi cookie kosong',
        'media file ss reaksi kosong',
        'file cookie tidak ditemukan',
        'tidak terdaftar',
    ];

    return (hasil.rekapLaporan || [])
        .filter(r => r.status !== 'SUKSES')
        .filter(r => {
            const alasanLower = String(r.alasan || '').toLowerCase();
            return !permanen.some(p => alasanLower.includes(p));
        })
        .map(r => r.nama);
}

/**
 * Inisialisasi cron job untuk absen otomatis harian
 * @param {Object} client - WhatsApp client instance
 */
function initScheduler(client) {
    const schedule = config.cronSchedule;
    const timezone = config.cronTimezone;

    // Validasi cron expression
    if (!cron.validate(schedule)) {
        logger.error('SCHEDULER', `Cron expression tidak valid: ${schedule}`);
        return;
    }

    cron.schedule(schedule, () => {
        jalankanAbsenOtomatis(client, 'cron');
    }, {
        scheduled: true,
        timezone: timezone,
    });

    // ── Catch-up jadwal terlewat ──
    // node-cron tidak mengejar jadwal yang lewat saat proses mati/restart,
    // jadi pemeriksaan berkala ini yang menjamin absen jam 8 tetap terkirim.
    const menitJadwal = _menitJadwal(schedule);
    if (menitJadwal === null) {
        logger.warn('SCHEDULER', `Catch-up tidak aktif: pola cron "${schedule}" bukan format "M H * * *".`);
    } else {
        const cekTerlewat = async () => {
            try {
                const state = _bacaState();
                if (state.tanggal === _tanggalLokal() && state.selesai) return;

                const selisihMenit = _menitLokal() - menitJadwal;
                if (selisihMenit < 0) return;
                if (selisihMenit * 60 * 1000 > CATCHUP_WINDOW_MS) return;

                logger.warn('SCHEDULER', `Jadwal absen belum tuntas (${selisihMenit} menit lewat). Menjalankan catch-up...`);
                await jalankanAbsenOtomatis(client, 'catchup');
            } catch (e) {
                logger.error('SCHEDULER', `Pemeriksaan jadwal terlewat gagal: ${e.message}`);
            }
        };

        setTimeout(cekTerlewat, 60 * 1000); // beri waktu WA Web stabil dulu
        const timer = setInterval(cekTerlewat, CATCHUP_INTERVAL_MS);
        if (timer.unref) timer.unref();
    }

    // ── Schedule Pembersihan Log & Temporary Harian Setiap Jam 00:00 WIB ──
    cron.schedule('0 0 * * *', () => {
        logger.system('⏰ Cron maintenance: Pembersihan log & file temporary harian...');
        bersihkanLogLama();
    }, {
        scheduled: true,
        timezone: timezone,
    });

    logger.success('SCHEDULER', `Cron aktif: "${schedule}" (${timezone}), catch-up tiap ${CATCHUP_INTERVAL_MS / 60000} menit & pembersihan harian (00:00).`);
}

module.exports = { initScheduler, jalankanAbsenOtomatis };
