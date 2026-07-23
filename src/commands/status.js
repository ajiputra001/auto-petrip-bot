// ══════════════════════════════════════════
// 📊 COMMAND: /status
// ══════════════════════════════════════════

const os = require('os');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const config = require('../config');

/**
 * Hitung total ukuran & jumlah file dalam folder
 */
function getDirStats(dirPath) {
    let size = 0;
    let count = 0;
    try {
        if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            count = files.length;
            for (const file of files) {
                const stat = fs.statSync(path.join(dirPath, file));
                if (stat.isFile()) {
                    size += stat.size;
                }
            }
        }
    } catch (e) {}
    return { count, sizeMB: (size / 1024 / 1024).toFixed(2) };
}

/**
 * Hitung ukuran file log
 */
function getLogSize() {
    try {
        if (fs.existsSync(config.logFile)) {
            const stat = fs.statSync(config.logFile);
            return `${(stat.size / 1024).toFixed(1)} KB`;
        }
    } catch (e) {}
    return '0 KB';
}

/**
 * Tampilkan diagnostic status server
 * /status
 */
async function handleStatus(msg) {
    const freeRAM = (os.freemem() / 1024 / 1024).toFixed(0);
    const totalRAM = (os.totalmem() / 1024 / 1024).toFixed(0);
    const usedRAM = (totalRAM - freeRAM).toFixed(0);
    const persenUsed = ((usedRAM / totalRAM) * 100).toFixed(0);
    const uptime = formatUptime(os.uptime());
    const cpuCount = os.cpus().length;
    const cpuModel = os.cpus()[0]?.model || 'Unknown';
    const platform = `${os.type()} ${os.release()}`;
    const totalDrivers = db.getAllDrivers().length;

    // Hitung statistik direktori
    const cookiesStats = getDirStats(config.cookieDir);
    const screenshotsStats = getDirStats(config.screenshotDir);
    const logSize = getLogSize();

    let teks = `⚙️ *SERVER DIAGNOSTIC STATUS*\n`;
    teks += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    teks += `🖥️ *Sistem & OS*\n`;
    teks += `   • OS       : ${platform}\n`;
    teks += `   • CPU      : ${cpuModel}\n`;
    teks += `   • Cores    : ${cpuCount} vCPU\n`;
    teks += `   • Uptime   : ${uptime}\n\n`;
    teks += `📊 *Memori RAM*\n`;
    teks += `   • Terpakai : ${usedRAM} MB / ${totalRAM} MB (${persenUsed}%)\n`;
    teks += `   • Bebas    : ${freeRAM} MB\n\n`;
    teks += `💾 *Penyimpanan Bot*\n`;
    teks += `   • Cookies  : ${cookiesStats.count} file (${cookiesStats.sizeMB} MB)\n`;
    teks += `   • SS Reaksi: ${screenshotsStats.count} file (${screenshotsStats.sizeMB} MB)\n`;
    teks += `   • Log File : ${logSize}\n\n`;
    teks += `🤖 *Bot Engine*\n`;
    teks += `   • Version  : v1.0 Sovereign Smart Core\n`;
    teks += `   • Drivers  : ${totalDrivers} terdaftar\n`;
    teks += `   • Engine   : 🟢 Running (Standby)\n`;
    teks += `\n━━━━━━━━━━━━━━━━━━━━━━━━`;

    return msg.reply(teks);
}

/**
 * Format uptime seconds ke format human-readable
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${mins}m`);

    return parts.join(' ');
}

module.exports = { handleStatus };
