// ══════════════════════════════════════════
// 🎨 LOGGER — Console Logger Berwarna + Timestamp & File Logging
// ══════════════════════════════════════════

const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

// lazy load config to prevent circular dependency if any
let config;
try {
    config = require('../config');
} catch (e) {
    // fallback path
    config = {
        logFile: path.join(__dirname, '..', '..', 'data', 'bot.log'),
        dataDir: path.join(__dirname, '..', '..', 'data')
    };
}

/**
 * Format timestamp Indonesia (WIB)
 */
function timestamp() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/**
 * Tulis log ke file lokal (tanpa warna ANSI)
 */
function writeLogFile(level, tag, message) {
    try {
        const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const cleanMsg = `[${time}] [${level}] [${tag}] ${message}\n`;
        
        // Pastikan folder data ada
        const dir = path.dirname(config.logFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.appendFileSync(config.logFile, cleanMsg, 'utf8');
    } catch (e) {
        // Abaikan error tulis log agar program tidak crash
    }
}

const logger = {
    info: (tag, message) => {
        console.log(chalk.cyan(`[${timestamp()}]`) + chalk.white(` [${tag}] `) + message);
        writeLogFile('INFO', tag, message);
    },

    success: (tag, message) => {
        console.log(chalk.green(`[${timestamp()}]`) + chalk.green.bold(` ✅ [${tag}] `) + chalk.green(message));
        writeLogFile('SUCCESS', tag, message);
    },

    warn: (tag, message) => {
        console.log(chalk.yellow(`[${timestamp()}]`) + chalk.yellow.bold(` ⚠️  [${tag}] `) + chalk.yellow(message));
        writeLogFile('WARN', tag, message);
    },

    error: (tag, message) => {
        console.log(chalk.red(`[${timestamp()}]`) + chalk.red.bold(` ❌ [${tag}] `) + chalk.red(message));
        writeLogFile('ERROR', tag, message);
    },

    debug: (tag, message) => {
        console.log(chalk.gray(`[${timestamp()}]`) + chalk.gray(` 🔍 [${tag}] ${message}`));
        writeLogFile('DEBUG', tag, message);
    },

    system: (message) => {
        console.log(chalk.magenta.bold(`[${timestamp()}] 🖥️  [SYSTEM] `) + chalk.magenta(message));
        writeLogFile('SYSTEM', 'CORE', message);
    },

    telemetry: (percent, message) => {
        const bar = '█'.repeat(Math.floor(percent / 10)) + '░'.repeat(10 - Math.floor(percent / 10));
        console.log(chalk.blue(`[${timestamp()}]`) + chalk.blue(` ⚡ [TELEMETRY] [${bar}] ${percent}% — ${message}`));
        writeLogFile('TELEMETRY', 'CORE', `${percent}% — ${message}`);
    },

    banner: () => {
        const lines = [
            '',
            chalk.cyan.bold('  ╔══════════════════════════════════════════════════════╗'),
            chalk.cyan.bold('  ║') + chalk.white.bold('   🚀 AJIPUTRA BOT AUTOMATION ENGINE v4.1          ') + chalk.cyan.bold('║'),
            chalk.cyan.bold('  ║') + chalk.gray('   🧠 Sovereign Telemetry Stream — Smart Core      ') + chalk.cyan.bold('║'),
            chalk.cyan.bold('  ║') + chalk.gray('   📡 Architecture: Upgraded MVC + Robust Logging   ') + chalk.cyan.bold('║'),
            chalk.cyan.bold('  ╚══════════════════════════════════════════════════════╝'),
            '',
        ];
        lines.forEach(line => console.log(line));
    },

    readySign: () => {
        const lines = [
            '',
            chalk.green.bold('  ╔══════════════════════════════════════════════════════╗'),
            chalk.green.bold('  ║') + chalk.white.bold('   ❇️  WHATSAPP BOT BERHASIL TERHUBUNG!               ') + chalk.green.bold('║'),
            chalk.green.bold('  ║') + chalk.white('   🟢 Status: ONLINE / STANDBY                         ') + chalk.green.bold('║'),
            chalk.green.bold('  ║') + chalk.white('   💬 Siap menerima & memproses perintah dari WA       ') + chalk.green.bold('║'),
            chalk.green.bold('  ╚══════════════════════════════════════════════════════╝'),
            '',
        ];
        lines.forEach(line => console.log(line));
        writeLogFile('SYSTEM', 'READY', 'WhatsApp Bot ONLINE & STANDBY');
    },
};

module.exports = logger;
