// ══════════════════════════════════
// ⚙️ SETTINGS — Pengaturan Dinamis (Runtime)
// ══════════════════════════════════
// Menyimpan pengaturan yang bisa diubah dari chat WA / web
// tanpa perlu edit file .env atau restart bot.

const path = require('path');
const fs = require('fs');
const config = require('./config');
const { bacaJSON, tulisJSON, ensureDir } = require('./utils/helpers');

function _settingsFile() {
    return path.join(config.dataDir, 'settings.json');
}

function _readSettings() {
    ensureDir(config.dataDir);
    return bacaJSON(_settingsFile()) || {};
}

function _writeSettings(settings) {
    tulisJSON(_settingsFile(), settings);
}

/**
 * Validasi URL Google Form
 */
function isValidFormUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^https?:\/\/.+\.google\.com\/forms\/.+/.test(url.trim()) ||
           /^https?:\/\/docs\.google\.com\/forms\/.+/.test(url.trim());
}

/**
 * Ambil link Google Form aktif.
 * Prioritas: settings.json (hasil ubah runtime) → config.formUrl (.env)
 * @returns {string}
 */
function getFormUrl() {
    const s = _readSettings();
    return s.formUrl || config.formUrl;
}

/**
 * Ubah link Google Form (runtime, tersimpan permanen)
 * @param {string} url
 * @returns {{ success: boolean, url?: string, error?: string }}
 */
function setFormUrl(url) {
    const clean = String(url || '').trim();
    if (!isValidFormUrl(clean)) {
        return { success: false, error: 'Link tidak valid. Harus link Google Form (https://docs.google.com/forms/...).' };
    }
    const s = _readSettings();
    s.formUrl = clean;
    _writeSettings(s);
    return { success: true, url: clean };
}

/**
 * Reset ke nilai default dari .env (hapus override runtime)
 */
function resetFormUrl() {
    const s = _readSettings();
    delete s.formUrl;
    _writeSettings(s);
    return { success: true, url: config.formUrl };
}

module.exports = {
    getFormUrl,
    setFormUrl,
    resetFormUrl,
    isValidFormUrl,
};
