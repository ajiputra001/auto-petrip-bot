// ══════════════════════════════════════════
// 🛡️ SELF-HEALING — Cleanup Crash & Zombie Proses
// ══════════════════════════════════════════

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

/**
 * Membersihkan sisa crash:
 * - Kill zombie Chrome/Chromium
 * - Hapus SingletonLock sisa session
 * - Hapus file temporary screenshot
 */
function bersihkanSisaCrash() {
    logger.system('Self-Healing: Memulai pembersihan sisa crash...');

    // 1. Kill zombie Chrome processes safely
    try {
        execSync('pkill -9 -f "chrome --type=" || true', { stdio: 'ignore' });
        execSync('pkill -9 -f "chromium --type=" || true', { stdio: 'ignore' });
        logger.debug('SELF-HEALING', 'Zombie Chrome/Chromium di-terminate.');
    } catch (e) {
        // Tidak ada proses yang perlu di-kill
    }

    // 2. Hapus SingletonLock sisa session WA secara dinamis berdasarkan waClientId
    try {
        const lockPath = path.join(config.rootDir, '.wwebjs_auth', `session-${config.waClientId}`, 'SingletonLock');
        if (fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
            logger.success('SELF-HEALING', 'SingletonLock sisa crash berhasil dihapus.');
        }
    } catch (e) {
        // File tidak ada, abaikan
    }

    // 3. Bersihkan file temporary screenshot di folder screenshots/
    try {
        const ssDir = config.screenshotDir;
        if (fs.existsSync(ssDir)) {
            const files = fs.readdirSync(ssDir);
            let cleaned = 0;
            for (const file of files) {
                // Hanya hapus file temporary (yang ada timestamp milidetik)
                if (file.startsWith('Screenshot_') && /^\d{13}/.test(file.split('_')[1])) {
                    fs.unlinkSync(path.join(ssDir, file));
                    cleaned++;
                }
            }
            if (cleaned > 0) {
                logger.debug('SELF-HEALING', `${cleaned} file temporary screenshot dibersihkan.`);
            }
        }
    } catch (e) {
        // Abaikan error
    }

    // 4. Rotasi / Pemangkasan log lokal jika > 5MB
    bersihkanLogLama();

    logger.success('SELF-HEALING', 'Pembersihan selesai. Sistem siap beroperasi.');
}

/**
 * Membersihkan & merotasi file log lokal (bot.log) serta temporary file agar tidak memenuhi disk
 */
function bersihkanLogLama() {
    try {
        const logFile = config.logFile;
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

            if (stats.size > MAX_SIZE_BYTES) {
                // Baca hanya 64KB terakhir dari file untuk mencegah Out-Of-Memory (std::bad_alloc)
                const readSize = Math.min(stats.size, 64 * 1024);
                const buffer = Buffer.alloc(readSize);
                const fd = fs.openSync(logFile, 'r');
                fs.readSync(fd, buffer, 0, readSize, stats.size - readSize);
                fs.closeSync(fd);

                const tailText = buffer.toString('utf8');
                const lines = tailText.split('\n').slice(1).join('\n');

                fs.writeFileSync(logFile, `--- LOG TRUNCATED (${new Date().toISOString()}) ---\n` + lines, 'utf8');
                logger.success('SELF-HEALING', `File log ${path.basename(logFile)} dipangkas aman (64KB baris terbaru).`);
            }
        }

        // Bersihkan log PM2 lokal (out/error) jika membesar > 10MB
        const pm2Logs = [
            path.join(config.rootDir, 'logs', 'pm2-out.log'),
            path.join(config.rootDir, 'logs', 'pm2-error.log'),
        ];

        for (const pm2Log of pm2Logs) {
            if (!fs.existsSync(pm2Log)) continue;

            const stats = fs.statSync(pm2Log);
            const PM2_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
            if (stats.size <= PM2_MAX_SIZE_BYTES) continue;

            const readSize = Math.min(stats.size, 64 * 1024);
            const buffer = Buffer.alloc(readSize);
            const fd = fs.openSync(pm2Log, 'r');
            fs.readSync(fd, buffer, 0, readSize, stats.size - readSize);
            fs.closeSync(fd);

            const tailText = buffer.toString('utf8');
            const lines = tailText.split('\n').slice(1).join('\n');
            fs.writeFileSync(pm2Log, `--- PM2 LOG TRUNCATED (${new Date().toISOString()}) ---\n` + lines, 'utf8');
            logger.success('SELF-HEALING', `File log ${path.basename(pm2Log)} dipangkas aman (64KB baris terbaru).`);
        }
    } catch (e) {
        // Fallback aman: jika gagal, kosongkan file log
        try {
            if (fs.existsSync(config.logFile)) {
                fs.writeFileSync(config.logFile, '', 'utf8');
            }
        } catch (err) { /* abaikan */ }
    }
}

/**
 * Register global error handlers untuk mencegah crash total
 */
function registerErrorHandlers() {
    process.on('uncaughtException', (error) => {
        logger.error('KERNEL', `Exception fatal tertangkap: ${error.message}`);
        logger.debug('KERNEL', error.stack || 'No stack trace');
        try {
            execSync('pkill -f chrome || true', { stdio: 'ignore' });
            execSync('pkill -f chromium || true', { stdio: 'ignore' });
        } catch (e) { /* abaikan */ }
        // Keluar dari proses agar PM2/systemd otomatis melakukan auto-restart bersih
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        logger.error('KERNEL', `Unhandled Promise Rejection: ${msg}`);
        if (reason instanceof Error && reason.stack) {
            logger.debug('KERNEL', reason.stack);
        }
    });

    // Graceful shutdown
    const shutdown = (signal) => {
        logger.warn('SYSTEM', `Sinyal ${signal} diterima. Mematikan bot secara aman...`);
        try {
            execSync('pkill -f chrome || true', { stdio: 'ignore' });
            execSync('pkill -f chromium || true', { stdio: 'ignore' });
        } catch (e) { /* abaikan */ }
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
    bersihkanSisaCrash,
    bersihkanLogLama,
    registerErrorHandlers,
};
