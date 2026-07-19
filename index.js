// ══════════════════════════════════════════════════════
//  🚀 AJIPUTRA BOT AUTOMATION ENGINE v4.1
//  🧠 Sovereign Telemetry Stream — Modular Architecture
// ══════════════════════════════════════════════════════

const logger = require('./src/utils/logger');
const { bersihkanSisaCrash, registerErrorHandlers } = require('./src/utils/self-healing');
const { createClient } = require('./src/client');

// ── 1. Tampilkan banner ──
logger.banner();

// ── 2. Register global error handlers ──
registerErrorHandlers();

// ── 3. Self-healing: bersihkan sisa crash ──
bersihkanSisaCrash();

// ── 4. Inisialisasi database (otomatis saat import) ──
require('./src/database');

// ── 5. Buat & jalankan WhatsApp client ──
logger.system('Meluncurkan browser inti WhatsApp... Silakan tunggu...');
const client = createClient();
client.initialize();
