// ══════════════════════════════════════════
// 📊 COMMAND: /status
// ══════════════════════════════════════════

const os = require('os');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const config = require('../config');
const auth = require('../auth');
const { kartu, kode, tebal, miring, cabang } = require('../utils/tampilan');

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

    // Driver yang berkasnya belum lengkap adalah penyebab absen gagal paling
    // sering, jadi ikut ditampilkan di diagnostik.
    const drivers = db.getAllDrivers();
    const belumSiap = drivers.filter((d) => !db.isCookieReady(d) || !db.isScreenshotReady(d));

    const ikonRam = persenUsed >= 90 ? '🔴' : persenUsed >= 75 ? '🟡' : '🟢';

    return msg.reply(
        kartu({
            judul: `⚙️ *DIAGNOSTIK SERVER*`,
            isi: [
                `🖥️ *Sistem & OS*`,
                cabang([
                    `OS: ${platform}`,
                    `CPU: ${cpuModel}`,
                    `Core: ${cpuCount} vCPU`,
                    `Uptime: ${uptime}`,
                ]),
                ``,
                `${ikonRam} *Memori RAM*`,
                cabang([
                    `Terpakai: ${tebal(`${usedRAM} MB`)} / ${totalRAM} MB (${persenUsed}%)`,
                    `Bebas: ${freeRAM} MB`,
                ]),
                ``,
                `💾 *Penyimpanan Bot*`,
                cabang([
                    `Cookie: ${cookiesStats.count} berkas (${cookiesStats.sizeMB} MB)`,
                    `Foto reaksi: ${screenshotsStats.count} berkas (${screenshotsStats.sizeMB} MB)`,
                    `Log: ${logSize}`,
                ]),
                ``,
                `🤖 *Bot Engine*`,
                cabang([
                    `Versi: v2.0 Sovereign Payment Core`,
                    `Driver: ${totalDrivers} terdaftar`,
                    `User: ${auth.listUsers().length} akun`,
                    `Dashboard: ${config.publicBaseUrl}`,
                    `Status: 🟢 ${tebal('Running')} (standby)`,
                ]),
            ],
            kaki: [
                belumSiap.length
                    ? `⚠️ ${tebal(`${belumSiap.length} driver`)} belum lengkap: ${belumSiap.map((d) => d.nama).join(', ')}`
                    : `✅ ${miring('Semua berkas driver lengkap.')}`,
                `💡 Detail driver: ${kode('/listdriver')}`,
            ],
        })
    );
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
