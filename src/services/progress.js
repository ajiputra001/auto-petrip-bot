// ══════════════════════════════════════════
// 📊 PROGRESS — Live Progress Bar WhatsApp
// ══════════════════════════════════════════

const { delay } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Class untuk mengelola live progress update di WhatsApp
 */
class ProgressTracker {
    /**
     * @param {Object} waClient - WhatsApp client instance
     * @param {Object|null} liveMsgObj - Message object untuk di-edit (null = no WA output)
     * @param {Object} driver - Data driver yang sedang diproses
     * @param {boolean} isLibur - Status libur driver
     */
    constructor(waClient, liveMsgObj, driver, isLibur) {
        this.client = waClient;
        this.liveMsg = liveMsgObj;
        this.driver = driver;
        this.isLibur = isLibur;
        this.startTime = Date.now();
    }

    /**
     * Update progress ke WhatsApp & console
     * @param {number} stage - Stage saat ini (0-4)
     * @param {string} deskripsi - Deskripsi status
     */
    async update(stage, deskripsi) {
        // Selalu log ke console
        logger.info(this.driver.nama, `Stage ${stage}/4 — ${deskripsi}`);

        // Skip WA update jika tidak ada live message
        if (!this.liveMsg) return;

        // Custom blocks progress bar
        const totalBlocks = 10;
        const filledCount = Math.min(Math.round((stage / 4) * totalBlocks), totalBlocks);
        const emptyCount = totalBlocks - filledCount;
        const bar = '▓'.repeat(filledCount) + '░'.repeat(emptyCount);
        const persen = Math.min(Math.round((stage / 4) * 100), 100);

        // Hitung durasi berjalannya proses
        const durasi = ((Date.now() - this.startTime) / 1000).toFixed(1);

        // Icon penunjuk stage
        const statusIcon = (s) => {
            if (stage > s) return '✅';
            if (stage === s) return '▶️';
            return '⏳';
        };

        const stagesList = this.isLibur ? [
            'Validasi Kredensial Database',
            'Membuka Engine Google Chrome',
            'Membuka Form K3 SPX & Sinkronisasi',
            'Mengisi Kredensial Profil (Libur)',
            'Mengonfirmasi Opsi Libur & Kirim'
        ] : [
            'Validasi Kredensial Database',
            'Membuka Engine Google Chrome',
            'Membuka Form K3 SPX & Sinkronisasi',
            'Mengisi K3 Fatigue & Pengukuran Reaksi',
            'Unggah Master SS & Tanda Tangan'
        ];

        let template = `╔════════════════════════════╗\n`;
        template += `      🤖 *AJIPUTRA AUTOMATION ENGINE v1.0*     \n`;
        template += `          🛰️ *LIVE TELEMETRY STREAM*          \n`;
        template += `╚════════════════════════════╝\n\n`;
        template += `👤 *Driver*    : *${this.driver.nama.toUpperCase()}*\n`;
        template += `🆔 *ID Reg*    : \`${this.driver.id}\`\n`;
        template += `📅 *Rencana*   : ${this.isLibur ? '🏖️ Libur Operasional' : '🚚 Masuk Kerja'}\n`;
        template += `⏱️ *Durasi*    : \`${durasi} detik\`\n`;
        template += `📊 *Progress*  : *[${bar}] ${persen}%*\n`;
        template += `⚙️ *Aktivitas* : _${deskripsi}_\n\n`;
        template += `📋 *DETAIL TELEMETRY STAGE:*\n`;
        template += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (let s = 0; s <= 4; s++) {
            template += `${statusIcon(s)} Stage ${s}: ${stagesList[s]}\n`;
        }
        template += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        template += `🖥️ System: Powered By Ajiputra-tech`;

        try {
            // Re-hydrate message instance untuk pastikan .edit() bekerja
            const freshMsg = await this.client.getMessageById(this.liveMsg.id._serialized);
            if (freshMsg) {
                await freshMsg.edit(template);
            } else {
                await this.liveMsg.edit(template);
            }
            await delay(2500); // Delay aman pelolosan rate-limit WA
        } catch (e) {
            // Fallback: coba edit langsung tanpa re-hydrate
            try {
                await this.liveMsg.edit(template);
                await delay(2500);
            } catch (err) {
                // Gunakan debug level agar log tidak terlalu berisik jika terjadi rate-limit kecil
                logger.debug('PROGRESS', `Gagal update WA progress: ${err.message}`);
            }
        }
    }

    /**
     * Set pesan akhir (selesai/error)
     * @param {string} teks - Pesan akhir
     */
    async finish(teks) {
        if (!this.liveMsg) return;
        try {
            const freshMsg = await this.client.getMessageById(this.liveMsg.id._serialized);
            if (freshMsg) {
                await freshMsg.edit(teks);
            } else {
                await this.liveMsg.edit(teks);
            }
        } catch (e) {
            try { await this.liveMsg.edit(teks); } catch (err) { /* abaikan */ }
        }
    }
}

module.exports = ProgressTracker;
