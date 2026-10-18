// ══════════════════════════════════════════
// 🗓️ RIWAYAT ABSEN — Catatan sukses harian
// ══════════════════════════════════════════

const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { bacaJSON, tulisJSON, ensureDir } = require('../utils/helpers');

const FILE_RIWAYAT = path.join(config.dataDir, 'riwayat_absen.json');

/**
 * Catatan "siapa sudah absen hari ini", dipakai bersama oleh absen manual dan
 * scheduler.
 *
 * Tanpa catatan bersama ini, absen manual tidak meninggalkan jejak yang bisa
 * dibaca scheduler: catch-up menganggap hari itu belum tuntas lalu mengisi
 * ulang formulir driver yang baru saja diabsen — saldo terpotong dua kali dan
 * Google menerima dua tanggapan untuk orang yang sama.
 */

function _tanggalHariIni() {
    return new Date().toLocaleDateString('en-CA', { timeZone: config.cronTimezone });
}

function _baca() {
    const data = bacaJSON(FILE_RIWAYAT);
    if (!data || data.tanggal !== _tanggalHariIni()) {
        // Hari berganti → catatan kemarin tidak lagi relevan.
        return { tanggal: _tanggalHariIni(), nama: [] };
    }
    return { tanggal: data.tanggal, nama: Array.isArray(data.nama) ? data.nama : [] };
}

/**
 * Catat satu driver sudah berhasil absen hari ini.
 * @param {string} nama
 */
function catatSukses(nama) {
    if (!nama) return;
    try {
        ensureDir(config.dataDir);
        const riwayat = _baca();
        const kunci = String(nama).toLowerCase();

        if (riwayat.nama.some((n) => String(n).toLowerCase() === kunci)) return;

        riwayat.nama.push(nama);
        riwayat.diperbaruiPada = new Date().toISOString();
        tulisJSON(FILE_RIWAYAT, riwayat);
    } catch (e) {
        logger.warn('RIWAYAT', `Gagal mencatat absen ${nama}: ${e.message}`);
    }
}

/**
 * Nama driver yang sudah sukses absen hari ini.
 * @returns {string[]}
 */
function suksesHariIni() {
    return _baca().nama;
}

/**
 * @param {string} nama
 * @returns {boolean}
 */
function sudahSuksesHariIni(nama) {
    if (!nama) return false;
    const kunci = String(nama).toLowerCase();
    return _baca().nama.some((n) => String(n).toLowerCase() === kunci);
}

/**
 * Kosongkan catatan hari ini — dipakai bila admin sengaja ingin mengabsen ulang.
 * @param {string|null} nama - null = hapus semua
 */
function hapusCatatan(nama = null) {
    try {
        ensureDir(config.dataDir);
        const riwayat = _baca();

        if (nama === null) {
            riwayat.nama = [];
        } else {
            const kunci = String(nama).toLowerCase();
            riwayat.nama = riwayat.nama.filter((n) => String(n).toLowerCase() !== kunci);
        }

        riwayat.diperbaruiPada = new Date().toISOString();
        tulisJSON(FILE_RIWAYAT, riwayat);
        return true;
    } catch (e) {
        logger.warn('RIWAYAT', `Gagal menghapus catatan absen: ${e.message}`);
        return false;
    }
}

module.exports = {
    catatSukses,
    suksesHariIni,
    sudahSuksesHariIni,
    hapusCatatan,
    FILE_RIWAYAT,
};
