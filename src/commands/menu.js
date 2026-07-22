// ══════════════════════════════════════════
// 📋 COMMAND: /menu & /bantuan
// ══════════════════════════════════════════

/**
 * Tampilkan menu utama bot
 * @param {Object} msg - WhatsApp message object
 */
async function handleMenu(msg) {
    let menu = `╔════════════════════════╗\n`;
    menu += `  📊*AUTOBOT COMMAND CENTER*📊\n`;
    menu += `╚════════════════════════╝\n\n`;

    menu += `┌─⚡ *MANAJEMEN WORKER LOKAL*\n`;
    menu += `│ 👤 \`/tambahdriver [Nama]#[ID]#[Usia]#[Reaksi]\`\n`;
    menu += `│ 📝 \`/editdriver [Nama]#[Kolom]#[Nilai]\`\n`;
    menu += `│ 🗑️ \`/hapusdriver [Nama Depan]\`\n`;
    menu += `│ 📊 \`/listdriver\` _(Cek Status Kesiapan Data)_\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─📁 *UPDATE MEDIA & DATA*\n`;
    menu += `│ 📸 \`/updatefoto [Nama Depan]\` _(+ Gambar)_\n`;
    menu += `│ 🍪 \`/updatecookie [Nama Depan]\` _(+ JSON)_\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─📅 *JADWAL OPERASIONAL*\n`;
    menu += `│ 🏖️ \`/setlibur [Nama Depan] [Hari]\`\n`;
    menu += `│ 🚚 \`/setmasuk [Nama Depan]\`\n`;
    menu += `│ 📊 \`/ceklibur\`\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `┌─⚙️ *CONTROL SYSTEM ENGINE*\n`;
    menu += `│ 🚀 \`/absen [Nama Depan]\` _(Live Progress)_\n`;
    menu += `│ 🛑 \`/absenmanual\` _(Force Run All)_\n`;
    menu += `│ 📊 \`/status\` _(Server Diagnostic)_\n`;
    menu += `└─────────────────────────\n\n`;

    menu += `🤖 System Autobot Powered By Ajiputra-tech`;

    return msg.reply(menu);
}

module.exports = { handleMenu };
