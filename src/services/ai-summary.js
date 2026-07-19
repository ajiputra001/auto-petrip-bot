// ══════════════════════════════════════════
// 🧠 AI SUMMARY — NLG Generator Ringkasan K3
// ══════════════════════════════════════════

/**
 * Pilih item acak dari array
 */
function acak(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate ringkasan AI untuk driver yang LIBUR
 * @param {Object} driver - Data driver
 * @returns {string} Teks ringkasan
 */
function generateRingkasanLibur(driver) {
    const pembuka = acak([
        'Berdasarkan telemetri kognitif,',
        'Hasil komputasi algoritma diagnostik menunjukkan bahwa',
        'Evaluasi parameter K3 digital mengonfirmasi,',
        'Analisis metrik prediktif menyatakan,',
        'Berdasarkan data kalkulasi sistem real-time,',
    ]);

    const isi = acak([
        `driver *${driver.nama}* saat ini sedang memasuki fase rotasi istirahat reguler. Penghentian operasional sementara ini direkomendasikan untuk menjaga stabilitas performa jangka panjang dan mencegah akumulasi kelelahan kronis (burnout grid).`,
        `status off-duty untuk *${driver.nama}* tervalidasi. Sistem mengunci profil operasional hari ini guna memastikan hak pemulihan fisik terpenuhi, mendukung program Zero Accident perusahaan.`,
        `manajemen waktu istirahat *${driver.nama}* berjalan sesuai koridor regulasi. Jadwal non-aktif ini diproyeksikan mampu me-refresh kapasitas fokus untuk jadwal penugasan berikutnya.`,
        `sistem mendeteksi bahwa *${driver.nama}* memasuki siklus pemulihan terencana. Proteksi profil operasional aktif — seluruh penugasan akan di-buffer hingga hari kerja berikutnya.`,
    ]);

    return `${pembuka} ${isi}`;
}

/**
 * Generate ringkasan AI untuk driver yang MASUK KERJA
 * @param {Object} driver - Data driver
 * @returns {string} Teks ringkasan
 */
function generateRingkasanKerja(driver) {
    const pembuka = acak([
        'Berdasarkan telemetri kognitif,',
        'Hasil komputasi algoritma diagnostik menunjukkan bahwa',
        'Evaluasi parameter K3 digital mengonfirmasi,',
        'Analisis metrik prediktif menyatakan,',
        'Berdasarkan data kalkulasi sistem real-time,',
        'Pemindaian neural-link engine melaporkan bahwa',
    ]);

    const ms = parseInt(driver.reaksi) || 300;
    let performaKognitif = '';
    let kesimpulanMedis = '';

    if (ms < 270) {
        performaKognitif = `driver *${driver.nama}* menunjukkan latensi respons sangat tajam sebesar *${ms}ms*, berada di atas rata-rata kurva normal sopir logistik.`;
        kesimpulanMedis = 'Tingkat fokus motorik berada pada level prima, siap menghadapi ritme kerja dengan kewaspadaan penuh.';
    } else if (ms <= 315) {
        performaKognitif = `kondisi neurologis *${driver.nama}* terpantau stabil dengan catatan waktu reaksi normal sebesar *${ms}ms*.`;
        kesimpulanMedis = 'Kapasitas koordinasi mata-tangan memenuhi standar ambang batas keselamatan K3 operasional perusahaan.';
    } else {
        performaKognitif = `terdeteksi deviasi kelambatan respons kognitif pada *${driver.nama}* (*${ms}ms*).`;
        kesimpulanMedis = 'Terdapat indikasi kelelahan mikro (micro-fatigue). Disarankan pembatasan jam kerja berlebih dan pemantauan hidrasi berkala.';
    }

    const penutup = acak([
        '\n\n🤖 *Autobot*: LAYAK OPERASI TINGKAT A.',
        '\n\n🤖 *Autobot*: ZONA AMAN OPERASIONAL TERVERIFIKASI.',
        '\n\n🤖 *Autobot*: ASESMEN METRIK K3 MEMENUHI SYARAT.',
        '\n\n🤖 *Autobot*: STATUS CLEARANCE — DIIZINKAN BEROPERASI.',
    ]);

    return `${pembuka} ${performaKognitif} ${kesimpulanMedis}${penutup}`;
}

/**
 * Generate ringkasan AI untuk driver
 * @param {Object} driver - Data driver
 * @param {boolean} isLibur - Apakah driver sedang libur
 * @returns {string} Teks ringkasan AI
 */
function generasiRingkasanAI(driver, isLibur) {
    if (isLibur) {
        return generateRingkasanLibur(driver);
    }
    return generateRingkasanKerja(driver);
}

module.exports = { generasiRingkasanAI };
