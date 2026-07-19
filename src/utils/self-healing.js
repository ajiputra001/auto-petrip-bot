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

    // 1. Kill zombie Chrome processes
    try {
        execSync('pkill -f chrome || true', { stdio: 'ignore' });
        execSync('pkill -f chromium || true', { stdio: 'ignore' });
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

    logger.success('SELF-HEALING', 'Pembersihan selesai. Sistem siap beroperasi.');
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
    registerErrorHandlers,
};
