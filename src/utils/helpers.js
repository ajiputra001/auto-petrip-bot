// ══════════════════════════════════════════
// 🔧 HELPERS — Fungsi Utilitas Umum
// ══════════════════════════════════════════

const fs = require('fs');
const path = require('path');

/**
 * Delay/sleep async (ms)
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate progress bar teks untuk WhatsApp
 * @param {number} stageKe - Stage saat ini (0-based)
 * @param {number} totalStage - Total stage
 * @returns {string} Progress bar text
 */
function buatProgressBar(stageKe, totalStage = 4) {
    const filled = '■'.repeat(stageKe);
    const empty = '□'.repeat(totalStage - stageKe);
    const persen = Math.floor((stageKe / totalStage) * 100);
    return `[${filled}${empty}] ${persen}%`;
}

/**
 * Format tanggal Indonesia lengkap (WIB)
 * @returns {string} Tanggal terformat
 */
function formatTanggalLengkap() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/**
 * Dapatkan nama hari ini dalam Bahasa Indonesia
 * @returns {string} Nama hari (Senin, Selasa, dst)
 */
function getHariIni() {
    return new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        timeZone: 'Asia/Jakarta',
    }).format(new Date());
}

/**
 * Generate nama file screenshot format Android
 * @returns {string} Nama file unik
 */
function generateNamaScreenshot() {
    const ts = Date.now();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `Screenshot_${ts}_${rand}.jpg`;
}

/**
 * Generate nama file screenshot dengan format tanggal
 * @returns {string} Nama file unik
 */
function generateNamaScreenshotTanggal() {
    const d = new Date();
    const fmt = d.getFullYear()
        + String(d.getMonth() + 1).padStart(2, '0')
        + String(d.getDate()).padStart(2, '0');
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `Screenshot_${fmt}_${rand}.jpg`;
}

/**
/**
 * Hitung jarak Levenshtein antara dua kata (jarak typo/kemiripan)
 * @param {string} a 
 * @param {string} b 
 * @returns {number} Distance (0 = identik)
 */
function hitungKemiripan(a, b) {
    a = (a || '').toLowerCase().trim();
    b = (b || '').toLowerCase().trim();
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Cari driver dari array berdasarkan nama (fuzzy match cerdas + Levenshtein)
 * @param {Array} drivers - Array data driver
 * @param {string} inputNama - Nama yang dicari
 * @returns {{ driver: Object|null, index: number, isFuzzy: boolean }} Hasil pencarian
 */
function cariDriver(drivers, inputNama) {
    if (!inputNama || !drivers || drivers.length === 0) {
        return { driver: null, index: -1, isFuzzy: false };
    }
    const namaLower = inputNama.toLowerCase().trim();

    // 1. Substring / Includes Match
    let index = drivers.findIndex(d => d.nama.toLowerCase().includes(namaLower));
    if (index !== -1) {
        return { driver: drivers[index], index, isFuzzy: false };
    }

    // 2. Word-by-word Substring Match
    index = drivers.findIndex(d => {
        const words = d.nama.toLowerCase().split(' ');
        return words.some(w => w.startsWith(namaLower) || namaLower.startsWith(w));
    });
    if (index !== -1) {
        return { driver: drivers[index], index, isFuzzy: true };
    }

    // 3. Levenshtein Distance Match (Smart Typo Tolerance)
    let bestMatch = null;
    let bestIndex = -1;
    let minDistance = Infinity;

    drivers.forEach((d, i) => {
        const fullNama = d.nama.toLowerCase();
        const firstWord = fullNama.split(' ')[0];

        const distFull = hitungKemiripan(namaLower, fullNama);
        const distFirst = hitungKemiripan(namaLower, firstWord);
        const dist = Math.min(distFull, distFirst);

        // Toleransi max 2 karakter typo untuk kata pendek, max 3 untuk kata panjang
        const maxAllowed = namaLower.length <= 4 ? 1 : 2;
        if (dist <= maxAllowed && dist < minDistance) {
            minDistance = dist;
            bestMatch = d;
            bestIndex = i;
        }
    });

    if (bestMatch) {
        return { driver: bestMatch, index: bestIndex, isFuzzy: true };
    }

    return { driver: null, index: -1, isFuzzy: false };
}

/**
 * Pastikan direktori ada, buat jika belum
 * @param {string} dirPath - Path direktori
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Baca file JSON dengan aman
 * @param {string} filePath - Path file JSON
 * @returns {any} Parsed JSON atau null jika gagal
 */
function bacaJSON(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

/**
 * Tulis file JSON dengan format rapi
 * @param {string} filePath - Path file JSON
 * @param {any} data - Data yang akan ditulis
 */
function tulisJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

/**
 * Hapus file dengan aman (tidak error jika tidak ada)
 * @param {string} filePath - Path file
 */
function hapusFileAman(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        // Abaikan error
    }
}

module.exports = {
    delay,
    buatProgressBar,
    formatTanggalLengkap,
    getHariIni,
    generateNamaScreenshot,
    generateNamaScreenshotTanggal,
    hitungKemiripan,
    cariDriver,
    ensureDir,
    bacaJSON,
    tulisJSON,
    hapusFileAman,
};

