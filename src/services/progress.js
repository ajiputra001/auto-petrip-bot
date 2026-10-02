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
     * @param {string|null} chatId - Tujuan chat; dipakai bila liveMsgObj gagal dibuat
     */
    constructor(waClient, liveMsgObj, driver, isLibur, chatId = null) {
        this.client = waClient;
        this.liveMsg = liveMsgObj;
        this.driver = driver;
        this.isLibur = isLibur;
        // sendMessage() bisa mengembalikan undefined pada chat @lid walau pesan terkirim,
        // jadi chatId disimpan agar progress tetap bisa dikirim/diedit.
        this.chatId = chatId || (liveMsgObj && (liveMsgObj.safeChatId || (liveMsgObj.id && liveMsgObj.id.remote))) || null;
        // ID pesan hasil pemulihan dari store, dipakai bila objek Message tak tersedia
        this.storeMsgId = null;
        // Metode edit yang terbukti berhasil ('liveMsg' | 'browser'), agar tak coba ulang yang gagal
        this.metodeEdit = null;
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

        // Skip WA update hanya jika benar-benar tidak ada tujuan output
        if (!this.liveMsg && !this.chatId) return;

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
            'Unggah SS Reaksi & Tanda Tangan'
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
        await delay(1200); // Delay aman pelolosan rate-limit WA
    }

    /**
     * Jalankan promise dengan hard timeout.
     * Di VPS, `pupPage.evaluate()` bisa HANG (tidak throw) saat frame WA Web
     * terlepas/detached — tanpa timeout, `await` tidak akan pernah selesai dan
     * seluruh alur progress (juga absen) membeku. Timeout memastikan selalu ada
     * jalan keluar agar fallback berikutnya tetap berjalan.
     * @param {Promise} promise
     * @param {number} ms
     * @param {string} label
     * @returns {Promise<*>}
     */
    async _withTimeout(promise, ms, label = 'operasi') {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timeout ${ms}ms: ${label}`)), ms);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Edit pesan WhatsApp secara robust dengan 3 tingkat fallback.
     * Setiap operasi dibungkus timeout agar tidak pernah hang di VPS.
     * @param {string} teks
     */
    async _editPesan(teks) {
        if (!this.liveMsg && !this.storeMsgId && !this.chatId) return;

        const EDIT_TIMEOUT = 8000; // hard cap per operasi edit di VPS
        const serializedId = this._idPesan() || this.storeMsgId;

        // Langsung pakai metode yang sudah terbukti berhasil
        if (this.metodeEdit === 'browser') {
            if (await this._editViaBrowser(serializedId, teks)) return;
            this.metodeEdit = null; // tak lagi bekerja → evaluasi ulang
        }

        if (this.liveMsg) {
            // 1. Coba edit langsung lewat object liveMsg
            try {
                const res = await this._withTimeout(this.liveMsg.edit(teks), EDIT_TIMEOUT, 'liveMsg.edit');
                if (res) {
                    this.metodeEdit = 'liveMsg';
                    logger.debug('PROGRESS', `Edit OK (liveMsg): ${serializedId}`);
                    return;
                }
            } catch (e) {
                logger.debug('PROGRESS', `Edit via liveMsg gagal: ${e.message}`);
            }

            // 2. Coba getMessageById lalu .edit()
            if (serializedId && this.metodeEdit !== 'liveMsg') {
                try {
                    const freshMsg = await this._withTimeout(
                        this.client.getMessageById(serializedId),
                        EDIT_TIMEOUT,
                        'getMessageById'
                    );
                    if (freshMsg) {
                        const res = await this._withTimeout(freshMsg.edit(teks), EDIT_TIMEOUT, 'freshMsg.edit');
                        if (res) {
                            this.liveMsg = freshMsg;
                            this.metodeEdit = 'liveMsg';
                            logger.debug('PROGRESS', `Edit OK (getMessageById): ${serializedId}`);
                            return;
                        }
                    }
                } catch (e) {
                    logger.debug('PROGRESS', `Edit via getMessageById gagal: ${e.message}`);
                }
            }
        }

        // 3. Fallback Khusus VPS: Direct Injection ke Browser WA Web Store
        if (serializedId && await this._editViaBrowser(serializedId, teks)) {
            this.metodeEdit = 'browser';
            this.storeMsgId = serializedId;
            logger.debug('PROGRESS', `Edit OK (browser injection): ${serializedId}`);
            return;
        }

        // 4. Fallback terakhir: kirim pesan baru, lalu PAKAI pesan baru itu sebagai liveMsg
        //    (agar semua edit berikutnya konsisten ke SATU pesan, tidak dobel)
        await this._kirimPesanBaru(teks, EDIT_TIMEOUT);
    }

    /**
     * Serialized id pesan aktif. WA Web kadang memakai `$1` sebagai ganti `_serialized`.
     * @returns {string|null}
     */
    _idPesan() {
        const id = this.liveMsg && this.liveMsg.id;
        if (!id) return null;
        return id._serialized || id.$1 || null;
    }

    /**
     * Kirim pesan baru ke chat tujuan & adopsi sebagai liveMsg berikutnya.
     * @param {string} teks
     * @param {number} timeoutMs
     */
    async _kirimPesanBaru(teks, timeoutMs) {
        const chatId = this.chatId ||
            (this.liveMsg && (this.liveMsg.safeChatId || (this.liveMsg.id && this.liveMsg.id.remote)));
        if (!chatId) return;

        try {
            const newMsg = await this._withTimeout(
                this.client.sendMessage(chatId, teks),
                timeoutMs,
                'sendMessage'
            );
            if (newMsg) {
                // Simpan safeChatId supaya fallback berikutnya tetap tahu tujuannya
                newMsg.safeChatId = chatId;
                this.liveMsg = newMsg; // ganti referensi → tidak ada pesan ganda
                logger.debug('PROGRESS', `Kirim pesan baru & adopsi sebagai liveMsg ke ${chatId}`);
                return;
            }

            // sendMessage() pada chat @lid bisa mengembalikan undefined walau pesan terkirim.
            // Ambil ID-nya dari store browser agar update berikutnya tetap mengedit 1 pesan.
            const recoveredId = await this._cariIdPesanDiStore(chatId, timeoutMs);
            if (recoveredId) {
                // Pesan hasil pemulihan tidak punya objek Message yang bisa diedit,
                // jadi langsung pakai injeksi browser.
                this.storeMsgId = recoveredId;
                this.metodeEdit = 'browser';
                logger.debug('PROGRESS', `ID pesan dipulihkan dari store: ${recoveredId}`);
                return;
            }

            // Tanpa ID, edit tak mungkin → stop output WA agar chat tidak dibanjiri.
            this.chatId = null;
            logger.warn('PROGRESS', `Handle pesan tidak tersedia di ${chatId}. Progress WA dihentikan (log console tetap jalan).`);
        } catch (e) {
            logger.debug('PROGRESS', `Fallback kirim pesan baru gagal: ${e.message}`);
        }
    }

    /**
     * Cari serialized id pesan loader terakhir milik bot dari store WA Web.
     * @param {string} chatId
     * @param {number} timeoutMs
     * @returns {Promise<string|null>}
     */
    async _cariIdPesanDiStore(chatId, timeoutMs) {
        if (!this.client || !this.client.pupPage) return null;

        try {
            const serialized = await this._withTimeout(
                this.client.pupPage.evaluate((targetChat) => {
                    try {
                        const Msg = window.require('WAWebCollections').Msg;
                        const models = Msg.models || (Msg.toArray ? Msg.toArray() : []);

                        // WA Web kadang memakai `$1` sebagai ganti `_serialized`
                        const idStr = (val) => {
                            if (typeof val === 'string') return val;
                            if (!val) return '';
                            return val._serialized || val.$1 || '';
                        };
                        // Chat @lid & @c.us bisa merujuk user sama → bandingkan bagian nomor saja
                        const userPart = (val) => idStr(val).split('@')[0];
                        const targetUser = userPart(targetChat);

                        const found = [...models].reverse().find((m) => {
                            if (!m || !m.id) return false;
                            if (!(m.id.fromMe || m.fromMe)) return false;
                            if (targetUser) {
                                const remoteUser = userPart(m.id.remote);
                                if (remoteUser && remoteUser !== targetUser) return false;
                            }
                            const body = m.body || m.caption || '';
                            return body.includes('SYSTEM RUNNING') ||
                                body.includes('AJIPUTRA AUTOMATION ENGINE') ||
                                body.includes('LIVE TELEMETRY');
                        });
                        return found ? idStr(found.id) : null;
                    } catch (err) {
                        return null;
                    }
                }, chatId),
                timeoutMs,
                'pupPage.evaluate(findLastMsg)'
            );

            return serialized || null;
        } catch (e) {
            logger.debug('PROGRESS', `Pencarian id pesan gagal: ${e.message}`);
            return null;
        }
    }

    /**
     * Direct injection edit ke browser WA Web Store.
     * @returns {Promise<boolean>}
     */
    async _editViaBrowser(serializedId, teks) {
        if (!this.client || !this.client.pupPage) return false;

        try {
            const msgKey = (this.liveMsg && this.liveMsg.id && this.liveMsg.id.id) || '';
            return await this._withTimeout(this.client.pupPage.evaluate(async (msgId, rawKey, newContent) => {
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
                        // WA Web kadang memakai `$1` sebagai ganti `_serialized`
                        const sId = m.id._serialized || m.id.$1 || '';
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
            }, serializedId, msgKey, teks), 8000, 'pupPage.evaluate(edit)');
        } catch (err) {
            logger.debug('PROGRESS', `Direct edit browser gagal: ${err.message}`);
            return false;
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
