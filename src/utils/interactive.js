// ══════════════════════════════════
// 🎛️ INTERACTIVE — Menu Tombol WhatsApp
// ══════════════════════════════════
// Menggunakan Buttons (max 3 tombol per pesan) karena
// WhatsApp sudah deprecated "Lists".
// Selalu ada fallback teks jika tombol gagal terkirim.

const { Buttons } = require('whatsapp-web.js');
const logger = require('./logger');

/**
 * Kirim pesan tombol (max 3 tombol).
 * @param {Object} client - WhatsApp client
 * @param {string} chatId - Tujuan chat
 * @param {Object} opts - { body, title, footer, buttons: [{id, body}] }
 * @returns {Promise}
 */
async function sendButtons(client, chatId, opts) {
    try {
        const buttons = new Buttons(opts.body, opts.buttons, opts.title, opts.footer);
        return await client.sendMessage(chatId, buttons);
    } catch (e) {
        logger.warn('INTERACTIVE', `Gagal kirim tombol (${e && e.message ? e.message : 'unknown'}). Fallback ke teks.`);
        // Fallback: kirim teks biasa berisi daftar
        const txt = opts.buttons.map((b, i) => `${i + 1}. ${b.body}`).join('\n');
        return await client.sendMessage(chatId, `${opts.body}\n\n${txt}\n\n_Ketik perintah yang sesuai (lihat /bantuan)._`);
    }
}

module.exports = { sendButtons };
