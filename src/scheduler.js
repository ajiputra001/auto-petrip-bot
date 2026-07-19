// ══════════════════════════════════════════
// ⏰ SCHEDULER — Cron Job Manager
// ══════════════════════════════════════════

const cron = require('node-cron');
const config = require('./config');
const logger = require('./utils/logger');
const { prosesAbsenMassal } = require('./services/form-filler');

/**
 * Inisialisasi cron job untuk absen otomatis harian
 * @param {Object} client - WhatsApp client instance
 */
function initScheduler(client) {
    const schedule = config.cronSchedule;
    const timezone = config.cronTimezone;

    // Validasi cron expression
    if (!cron.validate(schedule)) {
        logger.error('SCHEDULER', `Cron expression tidak valid: ${schedule}`);
        return;
    }

    cron.schedule(schedule, async () => {
        logger.system(`⏰ Cron job triggered! Memulai absen massal otomatis...`);

        try {
            await prosesAbsenMassal(client, null, null);
            logger.success('SCHEDULER', 'Absen massal otomatis selesai.');
        } catch (error) {
            logger.error('SCHEDULER', `Absen massal gagal: ${error.message}`);
        }
    }, {
        scheduled: true,
        timezone: timezone,
    });

    logger.success('SCHEDULER', `Cron job aktif: "${schedule}" (${timezone})`);
}

module.exports = { initScheduler };
