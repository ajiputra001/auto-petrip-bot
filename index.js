// ══════════════════════════════════════════════════════
//  🚀 AJIPUTRA BOT AUTOMATION ENGINE v1.0
//  🧠 Sovereign Telemetry Stream — Modular Architecture
// ══════════════════════════════════════════════════════

const logger = require('./src/utils/logger');
const { bersihkanSisaCrash, registerErrorHandlers } = require('./src/utils/self-healing');
const { createClient } = require('./src/client');
const { startWebServer } = require('./src/server');

// ── 1. Tampilkan banner ──
logger.banner();

// ── 2. Register global error handlers ──
registerErrorHandlers();

// ── 3. Self-healing: bersihkan sisa crash ──
bersihkanSisaCrash();

// ── 4. Inisialisasi database (otomatis saat import) ──
require('./src/database');

// ── 5. Bootstrap admin (buat akun admin jika belum ada) ──
require('./src/auth').bootstrapAdmin();

// ── 6. Start Web Dashboard (login & top-up) ──
startWebServer();

// ── 7. Buat & jalankan WhatsApp client ──
logger.system('Meluncurkan browser inti WhatsApp... Silakan tunggu...');
const client = createClient();

/**
 * Jalankan client dengan retry.
 *
 * Gangguan DNS/jaringan sesaat (ERR_NAME_NOT_RESOLVED, ERR_CONNECTION_CLOSED)
 * membuat `initialize()` menolak promise-nya. Tanpa penanganan, bot berhenti
 * di tengah jalan dan hanya menyisakan "Unhandled Promise Rejection" di log
 * padahal cukup dicoba ulang beberapa saat kemudian.
 */
async function jalankanClient(percobaan = 1) {
    const MAKS_PERCOBAAN = 5;

    try {
        await client.initialize();
    } catch (error) {
        const pesan = (error && error.message) || String(error);
        const jaringanBermasalah = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ETIMEDOUT|ENOTFOUND|navigat/i.test(pesan);

        if (!jaringanBermasalah || percobaan >= MAKS_PERCOBAAN) {
            logger.error('SYSTEM', `Gagal memulai WhatsApp: ${pesan}`);
            process.exit(1);
        }

        const jeda = Math.min(percobaan * 15, 60);
        logger.warn('SYSTEM', `Koneksi bermasalah (percobaan ${percobaan}/${MAKS_PERCOBAAN}): ${pesan}`);
        logger.info('SYSTEM', `Mencoba ulang dalam ${jeda} detik...`);
        await new Promise((r) => setTimeout(r, jeda * 1000));
        await jalankanClient(percobaan + 1);
    }
}

jalankanClient();
