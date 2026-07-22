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

        await this._editPesan(template);
        await delay(2000); // Delay aman pelolosan rate-limit WA
    }

    /**
     * Edit pesan WhatsApp secara robust dengan 3 tingkat fallback (termasuk direct browser injection)
     * @param {string} teks 
     */
    async _editPesan(teks) {
        if (!this.liveMsg) return;

        const serializedId = this.liveMsg.id ? this.liveMsg.id._serialized : null;

        // 1. Coba edit langsung lewat object liveMsg
        try {
            const res = await this.liveMsg.edit(teks);
            if (res) return;
        } catch (e) { /* lanjut fallback */ }

        // 2. Coba getMessageById lalu .edit()
        if (serializedId) {
            try {
                const freshMsg = await this.client.getMessageById(serializedId);
                if (freshMsg) {
                    const res = await freshMsg.edit(teks);
                    if (res) return;
                }
            } catch (e) { /* lanjut fallback */ }
        }

        // 3. Fallback Khusus VPS: Direct Injection ke Browser WA Web Store
        if (this.client && this.client.pupPage) {
            try {
                const msgKey = this.liveMsg.id ? (this.liveMsg.id.id || '') : '';
                await this.client.pupPage.evaluate(async (msgId, rawKey, newContent) => {
                    try {
                        const Msg = window.require('WAWebCollections').Msg;
                        const models = Msg.models || (Msg.toArray ? Msg.toArray() : []);
                        if (!models || models.length === 0) return false;

                        // Clean key extraction (hilangkan @c.us/@lid/prefix)
                        const extractKey = (str) => {
                            if (!str || typeof str !== 'string') return '';
                            const parts = str.split('_');
                            return parts.length >= 3 ? parts[2] : str;
                        };

                        const targetKey = rawKey || extractKey(msgId);

                        let targetMsg = models.find(m => {
                            if (!m || !m.id) return false;
                            const sId = m.id._serialized || '';
                            const mKey = m.id.id || extractKey(sId);
                            if (targetKey && (sId.includes(targetKey) || mKey === targetKey)) return true;
                            return false;
                        });

                        // Robust fallback: cari pesan outgoing terakhir yang memiliki teks loader bot
                        if (!targetMsg) {
                            targetMsg = [...models].reverse().find(m => {
                                if (!m || !m.id) return false;
                                const isFromMe = m.id.fromMe || m.fromMe;
                                const body = m.body || m.caption || '';
                                return isFromMe && (
                                    body.includes('SYSTEM RUNNING') ||
                                    body.includes('AJIPUTRA AUTOMATION ENGINE') ||
                                    body.includes('LIVE TELEMETRY')
                                );
                            });
                        }

                        if (targetMsg) {
                            const editAction = window.require('WAWebSendMessageEditAction');
                            if (editAction && editAction.sendMessageEdit) {
                                await editAction.sendMessageEdit(targetMsg, newContent, {});
                                return true;
                            }
                        }
                    } catch (err) {
                        console.error('Direct edit error in browser:', err);
                    }
                    return false;
                }, serializedId, msgKey, teks);
            } catch (err) {
                logger.debug('PROGRESS', `Direct edit browser gagal: ${err.message}`);
            }
        }
    }

    /**
     * Set pesan akhir (selesai/error)
     * @param {string} teks - Pesan akhir
     */
    async finish(teks) {
        await this._editPesan(teks);
    }
}

module.exports = ProgressTracker;
