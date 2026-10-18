// ══════════════════════════════════════════
// 🚀 COMMAND: /absen, /absenmanual
// ══════════════════════════════════════════

const db = require('../database');
const { prosesAbsenMassal } = require('../services/form-filler');

/**
 * Pisahkan kata kunci "paksa" dari argumen perintah.
 * @param {string} teks
 * @returns {{ sisa: string, paksa: boolean }}
 */
function _pisahPaksa(teks) {
    const kata = teks.trim().split(/\s+/).filter(Boolean);
    const paksa = kata.length > 0 && /^(paksa|force|ulang)$/i.test(kata[kata.length - 1]);
    return {
        sisa: (paksa ? kata.slice(0, -1) : kata).join(' '),
        paksa,
    };
}

/**
 * Absen driver spesifik
 * /absen [Nama] [paksa]
 * @param {Object} msg - WhatsApp message object
 * @param {string} pesan - Content of the message
 * @param {Object} waClient - WhatsApp client instance
 */
async function handleAbsen(msg, pesan, waClient) {
    const { sisa: inputNama, paksa } = _pisahPaksa(pesan.substring(7));

    if (!inputNama) {
        return msg.reply(`❌ Masukkan nama driver!\nContoh: \`/absen Budi\``);
    }

    const { driver } = db.findDriver(inputNama);
    if (!driver) {
        return msg.reply(`❌ Driver *${inputNama}* tidak terdaftar dalam database.`);
    }

    // Jalankan absen untuk driver spesifik
    await prosesAbsenMassal(waClient, inputNama.toLowerCase(), msg, { paksa });
}

/**
 * Absen manual semua driver
 * /absenmanual [paksa]
 * @param {Object} msg - WhatsApp message object
 * @param {string} pesan - Content of the message
 * @param {Object} waClient - WhatsApp client instance
 */
async function handleAbsenManual(msg, pesan, waClient) {
    const { paksa } = _pisahPaksa(pesan.substring(12));
    await prosesAbsenMassal(waClient, null, msg, { paksa });
}

module.exports = {
    handleAbsen,
    handleAbsenManual,
};
