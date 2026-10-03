// ══════════════════════════════════════════
// 🛡️ SELF-HEALING — Cleanup Crash & Zombie Proses
// ══════════════════════════════════════════

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

/**
 * Kill proses Chrome zombie milik form-filler saja.
 * Pencocokan dibatasi pada `--user-data-dir=<sessionDir>` agar browser
 * WhatsApp Web (yang memakai .wwebjs_auth) TIDAK ikut terbunuh.
 */
function bersihkanZombieChrome() {
    // pkill -f memakai regex, jadi karakter khusus pada path harus di-escape.
    const polaAman = `--user-data-dir=${config.sessionDir}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        // execFileSync tanpa shell → path dengan spasi aman, tidak ada shell injection.
        execFileSync('pkill', ['-9', '-f', polaAman], { stdio: 'ignore' });
        logger.debug('SELF-HEALING', 'Zombie Chrome form-filler dibersihkan.');
    } catch (e) {
        // exit code 1 = tidak ada proses yang cocok (kondisi normal)
    }
}

/**
 * Membersihkan sisa crash:
 * - Kill zombie Chrome/Chromium
 * - Hapus SingletonLock sisa session
 * - Hapus file temporary screenshot
 */
function bersihkanSisaCrash() {
    logger.system('Self-Healing: Memulai pembersihan sisa crash...');

    // 1. Kill zombie Chrome milik form-filler
    bersihkanZombieChrome();

    // 2. Hapus lock sisa session (WA Web & form-filler) agar Chrome mau start ulang
    const lockNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    const sessionRoots = [
        path.join(config.rootDir, '.wwebjs_auth', `session-${config.waClientId}`),
    ];

    try {
        if (fs.existsSync(config.sessionDir)) {
            for (const dir of fs.readdirSync(config.sessionDir)) {
                sessionRoots.push(path.join(config.sessionDir, dir));
            }
        }
    } catch (e) { /* abaikan */ }

    for (const root of sessionRoots) {
        for (const nama of lockNames) {
            try {
                const lockPath = path.join(root, nama);
                if (fs.existsSync(lockPath) || fs.lstatSync(lockPath, { throwIfNoEntry: false })) {
                    fs.rmSync(lockPath, { force: true, recursive: true });
                    logger.debug('SELF-HEALING', `Lock dihapus: ${lockPath}`);
                }
            } catch (e) { /* abaikan */ }
        }
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
    // Error puppeteer yang transient & tidak mematikan bot. Restart untuk ini
    // justru merugikan: bot ikut mati saat sebenarnya masih sehat.
    const POLA_TRANSIENT = [
        'detached Frame',
        'Execution context was destroyed',
        'Target closed',
        'Node is detached from document',
        'Cannot find context with specified id',
        'Session closed',
        'ProtocolError',
    ];

    const isTransient = (msg) => POLA_TRANSIENT.some(p => msg.includes(p));

    process.on('uncaughtException', (error) => {
        const msg = (error && error.message) || String(error);

        if (isTransient(msg)) {
            logger.warn('KERNEL', `Exception transient diabaikan (bot tetap jalan): ${msg}`);
            return;
        }

        logger.error('KERNEL', `Exception fatal tertangkap: ${msg}`);
        logger.debug('KERNEL', (error && error.stack) || 'No stack trace');
        bersihkanZombieChrome();
        // Keluar dari proses agar PM2/systemd otomatis melakukan auto-restart bersih
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        logger.error('KERNEL', `Unhandled Promise Rejection: ${msg}`);
        if (reason instanceof Error && reason.stack) {
            logger.debug('KERNEL', reason.stack);
        }
    });

    // Graceful shutdown
    let sedangShutdown = false;
    const shutdown = (signal) => {
        if (sedangShutdown) return;
        sedangShutdown = true;
        logger.warn('SYSTEM', `Sinyal ${signal} diterima. Mematikan bot secara aman...`);
        bersihkanZombieChrome();
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
    bersihkanSisaCrash,
    bersihkanLogLama,
    bersihkanZombieChrome,
    registerErrorHandlers,
};
