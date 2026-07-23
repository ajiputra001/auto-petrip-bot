// ══════════════════════════════════════════
// 📸 MEDIA DOWNLOADER — Robust Fallback Engine
// ══════════════════════════════════════════

const { MessageMedia } = require('whatsapp-web.js');
const logger = require('./logger');

/**
 * Unduh media dari pesan WhatsApp secara berketahanan tinggi (Robust)
 * Mendukung:
 * 1. Pesan media langsung (attachment)
 * 2. Pesan balasan (quoted message/reply)
 * 3. Fallback Puppeteer Browser Proxy untuk menangani error minified `r: r` & akun `@lid`
 *
 * @param {Object} msg - Obj pesan WhatsApp
 * @param {Object} client - WhatsApp client instance (opsional untuk fallback browser)
 * @returns {Promise<{ success: boolean, media?: Object, error?: string }>}
 */
async function downloadMediaRobust(msg, client = null) {
    let targetMsg = msg;

    // 1. Cek apakah pesan merupakan balasan (reply) ke gambar
    if (!msg.hasMedia || msg.type === 'chat') {
        if (msg.hasQuotedMsg) {
            try {
                const quotedMsg = await msg.getQuotedMessage();
                if (quotedMsg && (quotedMsg.hasMedia || quotedMsg.type === 'image' || quotedMsg.type === 'sticker' || quotedMsg.type === 'document')) {
                    targetMsg = quotedMsg;
                    logger.info('DOWNLOADER', `Mengambil media dari pesan balasan (Quoted Msg ID: ${quotedMsg.id._serialized})`);
                }
            } catch (err) {
                logger.error('DOWNLOADER', `Gagal mengambil quoted message: ${err.message}`);
            }
        }
    }

    // Pastikan target pesan memiliki media
    if (!targetMsg || (!targetMsg.hasMedia && targetMsg.type === 'chat')) {
        return {
            success: false,
            error: 'NO_MEDIA',
            message: 'Tidak ditemukan foto atau lampiran media pada pesan ini (maupun pada pesan yang dibalas).',
        };
    }

    // 2. Percobaan Pertama: Standard WWebJS downloadMedia()
    try {
        const media = await targetMsg.downloadMedia();
        if (media && media.data && media.data.length > 0) {
            return { success: true, media, targetMsg };
        }
    } catch (err) {
        logger.warn('DOWNLOADER', `Standard downloadMedia() gagal (${err.message}). Mencoba browser Puppeteer fallback...`);
    }

    // Jika tidak ada client, kita tidak bisa jalankan Puppeteer fallback
    if (!client || !client.pupPage) {
        return {
            success: false,
            error: 'DOWNLOAD_FAILED',
            message: 'Gagal mengunduh media dari WhatsApp Web (Standard API error & Puppeteer client tidak tersedia).',
        };
    }

    // 3. Percobaan Kedua: Browser-Level Evaluation Fallback dengan Proxy Mock QPL Logger
    try {
        const msgSerializedId = targetMsg.id && targetMsg.id._serialized ? targetMsg.id._serialized : '';
        const msgKeyId = targetMsg.id && targetMsg.id.id ? targetMsg.id.id : '';

        const result = await client.pupPage.evaluate(async (msgId, keyId) => {
            try {
                const WAWebCollections = window.require('WAWebCollections');
                const WAWebDownloadManager = window.require('WAWebDownloadManager');

                if (!WAWebCollections || !WAWebCollections.Msg) {
                    return { error: 'WAWebCollections.Msg tidak ditemukan di browser context' };
                }

                // Cari message model dalam memori browser WA Web
                let msgModel = WAWebCollections.Msg.get(msgId);

                if (!msgModel && WAWebCollections.Msg._models) {
                    msgModel = WAWebCollections.Msg._models.find(m =>
                        (m.id && m.id._serialized === msgId) ||
                        (m.id && m.id.id === keyId) ||
                        (m.id && keyId && m.id._serialized && m.id._serialized.includes(keyId))
                    );
                }

                if (!msgModel && typeof WAWebCollections.Msg.getMessagesById === 'function') {
                    const res = await WAWebCollections.Msg.getMessagesById([msgId]);
                    msgModel = res?.messages?.[0];
                }

                if (!msgModel) {
                    return { error: 'Model pesan tidak ditemukan di WA Web Collections' };
                }

                if (!msgModel.mediaData) {
                    return { error: 'Pesan tidak memiliki mediaData yang valid' };
                }

                if (msgModel.mediaData.mediaStage === 'REUPLOADING') {
                    return { error: 'Media kedaluwarsa atau sedang diunggah ulang oleh WhatsApp' };
                }

                // Resolusi media jika durasi belum terunduh penuh
                if (msgModel.mediaData.mediaStage !== 'RESOLVED' && typeof msgModel.downloadMedia === 'function') {
                    try {
                        await msgModel.downloadMedia({
                            downloadEvenIfExpensive: true,
                            rmrReason: 1,
                        });
                    } catch (e) {
                        /* abaikan error resolusi parsial */
                    }
                }

                // Proxy Objek Logger QPL — Mencegah error 'mockQpl.markStart is not a function' (Error minified r: r)
                const createMockQpl = () => {
                    const mock = {};
                    return new Proxy(mock, {
                        get: (target, prop) => {
                            if (prop === 'then') return undefined;
                            return () => mock;
                        }
                    });
                };

                const mockQpl = createMockQpl();

                const decryptedMedia = await WAWebDownloadManager.downloadManager.downloadAndMaybeDecrypt({
                    directPath: msgModel.directPath,
                    encFilehash: msgModel.encFilehash,
                    filehash: msgModel.filehash,
                    mediaKey: msgModel.mediaKey,
                    mediaKeyTimestamp: msgModel.mediaKeyTimestamp,
                    type: msgModel.type,
                    signal: new AbortController().signal,
                    downloadQpl: mockQpl,
                });

                if (!decryptedMedia) {
                    return { error: 'Hasil dekripsi media dari WhatsApp bernilai kosong (null)' };
                }

                const base64Data = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);
                return {
                    data: base64Data,
                    mimetype: msgModel.mimetype || 'image/jpeg',
                    filename: msgModel.filename || 'screenshot.jpg',
                    filesize: msgModel.size || 0,
                };
            } catch (errIn) {
                return { error: errIn.message || String(errIn) };
            }
        }, msgSerializedId, msgKeyId);

        if (result && result.data) {
            const media = new MessageMedia(
                result.mimetype,
                result.data,
                result.filename,
                result.filesize
            );
            logger.success('DOWNLOADER', 'Media berhasil diunduh via Browser Fallback Engine!');
            return { success: true, media, targetMsg };
        } else {
            logger.error('DOWNLOADER', `Browser Fallback gagal: ${result?.error || 'Unknown error'}`);
            return {
                success: false,
                error: 'BROWSER_FALLBACK_FAILED',
                message: `Gagal mengunduh media dari WA Web. (${result?.error || 'Media tidak dapat dideskripsi'})`,
            };
        }
    } catch (err) {
        logger.error('DOWNLOADER', `Gagal eksekusi Puppeteer fallback: ${err.message}`);
        return {
            success: false,
            error: 'PUPPETEER_ERROR',
            message: `Kesalahan sistem Puppeteer: ${err.message}`,
        };
    }
}

module.exports = { downloadMediaRobust };
