// ══════════════════════════════════════════
// 🚀 COMMAND: /absen, /absenmanual
// ══════════════════════════════════════════

const db = require('../database');
const { prosesAbsenMassal } = require('../services/form-filler');

/**
 * Absen driver spesifik
 * /absen [Nama]
 * @param {Object} msg - WhatsApp message object
 * @param {string} pesan - Content of the message
 * @param {Object} waClient - WhatsApp client instance
 */
async function handleAbsen(msg, pesan, waClient) {
    const inputNama = pesan.substring(7).trim();

    if (!inputNama) {
        return msg.reply(`❌ Masukkan nama driver!\nContoh: \`/absen Budi\``);
    }

    const { driver } = db.findDriver(inputNama);
    if (!driver) {
        return msg.reply(`❌ Driver *${inputNama}* tidak terdaftar dalam database.`);
    }

    // Jalankan absen untuk driver spesifik
    await prosesAbsenMassal(waClient, inputNama.toLowerCase(), msg);
}

/**
 * Absen manual semua driver
 * /absenmanual
 * @param {Object} msg - WhatsApp message object
 * @param {string} pesan - Content of the message
 * @param {Object} waClient - WhatsApp client instance
 */
async function handleAbsenManual(msg, pesan, waClient) {
    await prosesAbsenMassal(waClient, null, msg);
}

module.exports = {
    handleAbsen,
    handleAbsenManual,
};
