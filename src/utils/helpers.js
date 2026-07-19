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
 * Cari driver dari array berdasarkan nama (fuzzy match)
 * @param {Array} drivers - Array data driver
 * @param {string} inputNama - Nama yang dicari
 * @returns {{ driver: Object|null, index: number }} Hasil pencarian
 */
function cariDriver(drivers, inputNama) {
    const namaLower = inputNama.toLowerCase().trim();
    const index = drivers.findIndex(d => d.nama.toLowerCase().includes(namaLower));
    return {
        driver: index !== -1 ? drivers[index] : null,
        index,
    };
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
    cariDriver,
    ensureDir,
    bacaJSON,
    tulisJSON,
    hapusFileAman,
};
