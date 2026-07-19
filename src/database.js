// ══════════════════════════════════════════
// 🗄️ DATABASE — CRUD Driver & Jadwal (JSON File)
// ══════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const config = require('./config');
const { ensureDir, bacaJSON, tulisJSON } = require('./utils/helpers');
const logger = require('./utils/logger');

// ── Default Data dari V1.6 ──
const DEFAULT_DRIVERS = [
    {
        nama: 'Agung maulana',
        id: '376784',
        usia: '28',
        reaksi: '303',
        fileCookie: 'cookie_agung.json',
        fileSS: 'Screenshot_init_1001.jpg',
        noWa: '6285641858425@c.us',
    },
    {
        nama: 'RANDI',
        id: '220904',
        usia: '31',
        reaksi: '268',
        fileCookie: 'cookie_randi.json',
        fileSS: 'Screenshot_init_1002.jpg',
        noWa: '6285641858425@c.us',
    },
    {
        nama: 'LEO ERLANGGA',
        id: '819131',
        usia: '41',
        reaksi: '259',
        fileCookie: 'cookie_leo.json',
        fileSS: 'ss_leo.jpg',
        noWa: '6285641858425@c.us',
    },
];

const DEFAULT_JADWAL = {
    'Agung maulana': '-',
    'RANDI': '-',
    'LEO ERLANGGA': '-',
};

class Database {
    constructor() {
        // Pastikan semua direktori ada
        ensureDir(config.dataDir);
        ensureDir(config.cookieDir);
        ensureDir(config.screenshotDir);
        ensureDir(config.sessionDir);

        // Init file jika belum ada
        this._initFile(config.driverFile, DEFAULT_DRIVERS);
        this._initFile(config.jadwalFile, DEFAULT_JADWAL);

        logger.success('DATABASE', 'Database lokal berhasil dimuat.');
    }

    /**
     * Inisialisasi file JSON dengan default data
     */
    _initFile(filePath, defaultData) {
        if (!bacaJSON(filePath)) {
            tulisJSON(filePath, defaultData);
            logger.info('DATABASE', `File baru dibuat: ${path.basename(filePath)}`);
        }
    }

    // ════════════════════════════
    //  DRIVER OPERATIONS
    // ════════════════════════════

    /**
     * Ambil semua data driver
     * @returns {Array} Array of driver objects
     */
    getAllDrivers() {
        return bacaJSON(config.driverFile) || [];
    }

    /**
     * Cari driver berdasarkan nama (fuzzy match)
     * @param {string} nama - Nama driver (parsial)
     * @returns {{ driver: Object|null, index: number }}
     */
    findDriver(nama) {
        const drivers = this.getAllDrivers();
        const namaLower = nama.toLowerCase().trim();
        const index = drivers.findIndex(d => d.nama.toLowerCase().includes(namaLower));
        return {
            driver: index !== -1 ? drivers[index] : null,
            index,
        };
    }

    /**
     * Tambah driver baru
     * @param {{ nama, id, usia, reaksi, noWa }} data - Data driver
     * @returns {Object} Driver yang ditambahkan
     */
    addDriver(data) {
        const drivers = this.getAllDrivers();
        const kataPertama = data.nama.split(' ')[0].toLowerCase();

        const newDriver = {
            nama: data.nama,
            id: data.id,
            usia: data.usia,
            reaksi: data.reaksi,
            fileCookie: `cookie_${kataPertama}.json`,
            fileSS: `master_${kataPertama}.jpg`,
            noWa: data.noWa || config.waAdmin,
        };

        drivers.push(newDriver);
        tulisJSON(config.driverFile, drivers);

        // Tambah juga ke jadwal
        const jadwal = this.getJadwal();
        jadwal[data.nama] = '-';
        tulisJSON(config.jadwalFile, jadwal);

        logger.success('DATABASE', `Driver ${data.nama} berhasil didaftarkan.`);
        return newDriver;
    }

    /**
     * Update kolom driver
     * @param {string} nama - Nama driver
     * @param {string} kolom - Nama kolom (usia, reaksi, id)
     * @param {string} nilai - Nilai baru
     * @returns {{ success: boolean, driver?: Object, error?: string }}
     */
    updateDriver(nama, kolom, nilai) {
        const kolomValid = ['usia', 'reaksi', 'id'];
        if (!kolomValid.includes(kolom.toLowerCase())) {
            return { success: false, error: `Kolom tidak valid. Pilih: ${kolomValid.join(', ')}` };
        }

        const drivers = this.getAllDrivers();
        const { index } = this.findDriver(nama);
        if (index === -1) {
            return { success: false, error: `Driver "${nama}" tidak ditemukan.` };
        }

        drivers[index][kolom.toLowerCase()] = nilai;
        tulisJSON(config.driverFile, drivers);

        logger.success('DATABASE', `Driver ${drivers[index].nama}: ${kolom} → ${nilai}`);
        return { success: true, driver: drivers[index] };
    }

    /**
     * Update file screenshot driver
     * @param {string} nama - Nama driver
     * @param {string} namaFileBaru - Nama file baru
     * @returns {{ success: boolean, driver?: Object, fileLama?: string }}
     */
    updateScreenshot(nama, namaFileBaru) {
        const drivers = this.getAllDrivers();
        const { index } = this.findDriver(nama);
        if (index === -1) return { success: false };

        const fileLama = drivers[index].fileSS;
        drivers[index].fileSS = namaFileBaru;
        tulisJSON(config.driverFile, drivers);

        return { success: true, driver: drivers[index], fileLama };
    }

    /**
     * Hapus driver dari database
     * @param {string} nama - Nama driver
     * @returns {{ success: boolean, namaLengkap?: string }}
     */
    removeDriver(nama) {
        const drivers = this.getAllDrivers();
        const { driver, index } = this.findDriver(nama);
        if (index === -1) return { success: false };

        const namaLengkap = driver.nama;
        drivers.splice(index, 1);
        tulisJSON(config.driverFile, drivers);

        // Hapus juga dari jadwal
        const jadwal = this.getJadwal();
        delete jadwal[namaLengkap];
        tulisJSON(config.jadwalFile, jadwal);

        logger.success('DATABASE', `Driver ${namaLengkap} berhasil dihapus.`);
        return { success: true, namaLengkap };
    }

    // ════════════════════════════
    //  JADWAL OPERATIONS
    // ════════════════════════════

    /**
     * Ambil semua jadwal
     * @returns {Object} Map nama → hari libur
     */
    getJadwal() {
        return bacaJSON(config.jadwalFile) || {};
    }

    /**
     * Set jadwal libur driver
     * @param {string} nama - Nama driver (parsial)
     * @param {string} hari - Nama hari libur
     * @returns {{ success: boolean, namaLengkap?: string, hari?: string }}
     */
    setLibur(nama, hari) {
        const { driver } = this.findDriver(nama);
        if (!driver) return { success: false };

        const jadwal = this.getJadwal();
        const hariFormatted = hari.charAt(0).toUpperCase() + hari.slice(1).toLowerCase();
        jadwal[driver.nama] = hariFormatted;
        tulisJSON(config.jadwalFile, jadwal);

        logger.info('DATABASE', `${driver.nama} → Libur hari ${hariFormatted}`);
        return { success: true, namaLengkap: driver.nama, hari: hariFormatted };
    }

    /**
     * Set driver kembali masuk kerja
     * @param {string} nama - Nama driver (parsial)
     * @returns {{ success: boolean, namaLengkap?: string }}
     */
    setMasuk(nama) {
        const { driver } = this.findDriver(nama);
        if (!driver) return { success: false };

        const jadwal = this.getJadwal();
        jadwal[driver.nama] = '-';
        tulisJSON(config.jadwalFile, jadwal);

        logger.info('DATABASE', `${driver.nama} → Kembali masuk kerja`);
        return { success: true, namaLengkap: driver.nama };
    }

    /**
     * Cek apakah driver sedang libur hari ini
     * @param {string} namaDriver - Nama lengkap driver
     * @returns {boolean}
     */
    isLiburHariIni(namaDriver) {
        const jadwal = this.getJadwal();
        const hariLibur = jadwal[namaDriver] || '-';
        if (hariLibur === '-') return false;

        const hariIni = new Intl.DateTimeFormat('id-ID', {
            weekday: 'long',
            timeZone: 'Asia/Jakarta',
        }).format(new Date());

        return hariLibur.toLowerCase() === hariIni.toLowerCase();
    }

    /**
     * Path lengkap ke file cookie driver
     */
    getCookiePath(driver) {
        return path.join(config.cookieDir, driver.fileCookie);
    }

    /**
     * Path lengkap ke file screenshot driver
     */
    getScreenshotPath(driver) {
        return path.join(config.screenshotDir, driver.fileSS);
    }

    /**
     * Path lengkap ke session browser driver
     */
    getSessionPath(driver) {
        return path.join(config.sessionDir, `session-${driver.id}`);
    }

    /**
     * Cek apakah file cookie ada & valid (tidak kosong)
     */
    isCookieReady(driver) {
        const p = this.getCookiePath(driver);
        try {
            return fs.existsSync(p) && fs.statSync(p).size > 0;
        } catch (e) {
            return false;
        }
    }

    /**
     * Cek apakah file screenshot master ada & valid (tidak kosong)
     */
    isScreenshotReady(driver) {
        const p = this.getScreenshotPath(driver);
        try {
            return fs.existsSync(p) && fs.statSync(p).size > 0;
        } catch (e) {
            return false;
        }
    }
}

// Singleton instance
module.exports = new Database();
