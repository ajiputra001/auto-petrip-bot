// ══════════════════════════════════════════
// 🔐 COMMAND: /logindriver, /batallogin, /statuslogin
// ══════════════════════════════════════════

const db = require('../database');
const auth = require('../auth');
const config = require('../config');
const logger = require('../utils/logger');
const { kartu, kode, tebal, miring, cabang } = require('../utils/tampilan');
const { getUserIdByWa, getSenderWa } = require('./akun');
const { isAdmin } = require('./admin');
const loginJauh = require('../services/login-jarak-jauh');

/**
 * Admin boleh untuk semua driver; selain itu hanya pemilik nomor WA driver
 * atau akun yang tertaut ke driver tersebut.
 */
function _bolehAkses(msg, driver) {
    if (isAdmin(msg)) return true;
    const pengirim = getSenderWa(msg);
    // Driver sendiri, dari nomor WA yang terdaftar pada datanya
    if (driver.noWa && pengirim && driver.noWa === pengirim) return true;
    const userId = getUserIdByWa(pengirim);
    const user = userId ? auth.findUserById(userId) : null;
    return !!user && user.isActive !== false &&
        String(user.driverNama || '').toLowerCase() === driver.nama.toLowerCase();
}

/** Kirim pesan tanpa melempar error — kegagalan cukup dicatat di log. */
async function _kirim(client, tujuan, teks) {
    if (!tujuan) return false;
    try {
        await client.sendMessage(tujuan, teks);
        return true;
    } catch (e) {
        logger.warn('LOGIN-GOOGLE', `Gagal kirim pesan ke ${tujuan}: ${e.message}`);
        return false;
    }
}

function _formatDurasi(detik) {
    const m = Math.floor(detik / 60);
    const s = detik % 60;
    return m ? `${m} menit ${s} detik` : `${s} detik`;
}

/**
 * /logindriver [Nama] [kedriver]
 *
 * Link berisi akses ke browser tempat password diketik, jadi TIDAK pernah
 * dipajang di grup: dikirim ke chat pribadi peminta, atau ke nomor driver
 * bila diberi kata kunci "kedriver".
 */
async function handleLoginDriver(msg, pesan, client) {
    const kata = pesan.trim().split(/\s+/).slice(1);
    const keDriver = kata.length > 0 && /^(kedriver|driver|kirim)$/i.test(kata[kata.length - 1]);
    const inputNama = (keDriver ? kata.slice(0, -1) : kata).join(' ').trim();

    if (!inputNama) {
        return msg.reply(kartu({
            judul: `🔐 *LOGIN GOOGLE JARAK JAUH*`,
            isi: [
                `Ambil cookie Google driver ${tebal('tanpa PC')} — driver login sendiri dari HP lewat link aman.`,
                ``,
                `📌 *Cara pakai:*`,
                cabang([
                    `${kode('/logindriver Budi')} — link dikirim ke chat pribadi Anda`,
                    `${kode('/logindriver Budi kedriver')} — link dikirim langsung ke WA driver`,
                    `${kode('/statuslogin')} — pantau sesi yang berjalan`,
                    `${kode('/batallogin')} — hentikan sesi`,
                ]),
            ],
            kaki: [`⏱️ ${miring(`Link berlaku ${config.loginRemoteTimeoutMin} menit & hanya untuk satu sesi.`)}`],
        }));
    }

    const { driver, isFuzzy } = db.findDriver(inputNama);
    if (!driver) return msg.reply(`❌ Driver *${inputNama}* tidak ditemukan dalam database.`);

    if (!_bolehAkses(msg, driver)) {
        return msg.reply(kartu({
            judul: `❌ *AKSES DITOLAK*`,
            isi: [`Hanya admin atau pemilik akun yang tertaut ke ${tebal(driver.nama)} yang boleh membuka sesi login.`],
        }));
    }

    const peminta = getSenderWa(msg);
    const asalChat = msg.safeChatId || msg.from;
    const diGrup = String(asalChat).endsWith('@g.us');

    let tujuanLink;
    if (keDriver) {
        if (!driver.noWa || driver.noWa.endsWith('@g.us')) {
            return msg.reply(`❌ Driver *${driver.nama}* belum punya nomor WA. Kirim tanpa kata ${kode('kedriver')}.`);
        }
        tujuanLink = driver.noWa;
    } else {
        tujuanLink = peminta && !peminta.endsWith('@g.us') ? peminta : asalChat;
    }

    await msg.reply(`⏳ Menyiapkan browser login untuk *${driver.nama}*...`);

    let sesi;
    try {
        sesi = await loginJauh.mulaiSesi(driver, {
            dimintaOleh: peminta,
            onPenontonMasuk: async () => {
                await _kirim(client, asalChat, `👀 Link login *${driver.nama}* sedang dibuka. Menunggu proses login...`);
            },
            onSelesai: async (h) => {
                await _kirim(client, asalChat, _kartuHasil(h));
                if (keDriver && h.hasil === 'sukses') {
                    await _kirim(client, driver.noWa, `✅ Terima kasih *${driver.nama}*! Akun Google Anda sudah tersambung. Absen otomatis aktif kembali.`);
                }
            },
        });
    } catch (e) {
        logger.error('LOGIN-GOOGLE', `Gagal membuka sesi ${driver.nama}: ${e.message}`);
        return msg.reply(kartu({
            judul: `❌ *SESI LOGIN GAGAL DIBUKA*`,
            isi: [`🔎 ${miring(e.message)}`],
            kaki: [/Xvfb/.test(e.message)
                ? `💡 Pasang dulu di VPS: ${kode('sudo apt-get install -y xvfb')}`
                : `💡 ${miring('Coba lagi beberapa saat lagi.')}`],
        }));
    }

    const kartuLink = kartu({
        judul: `🔐 *LINK LOGIN GOOGLE*`,
        isi: [
            `🚚 Driver: ${tebal(driver.nama)}`,
            isFuzzy ? `🔍 ${miring(`"${inputNama}" dicocokkan otomatis.`)}` : null,
            ``,
            `👉 ${sesi.url}`,
            ``,
            `📌 *Langkah:*`,
            cabang([
                `Buka link di HP (Chrome/Safari)`,
                `Ketuk kolom email di layar → ketik di kotak bawah`,
                `Masukkan password & selesaikan verifikasi Google`,
                `Tunggu tulisan ✅ — cookie tersimpan otomatis`,
            ]),
        ],
        kaki: [
            `⏱️ Berlaku ${tebal(`${sesi.menit} menit`)}. Jangan bagikan link ini.`,
            `🔒 ${miring('Password diketik langsung ke Google, tidak lewat WhatsApp.')}`,
        ],
    });

    const terkirim = await _kirim(client, tujuanLink, kartuLink);

    if (!terkirim) {
        // Nomor tujuan tak terjangkau: lebih baik batalkan daripada link nyasar
        await loginJauh.batalkanSesi('Link gagal dikirim.');
        return msg.reply(`❌ Link gagal dikirim ke ${kode(tujuanLink)}. Sesi dibatalkan.`);
    }

    if (tujuanLink !== asalChat || diGrup) {
        const ke = keDriver ? `WA driver (${driver.noWa.replace('@c.us', '')})` : 'chat pribadi Anda';
        return msg.reply(kartu({
            judul: `📨 *LINK LOGIN TERKIRIM*`,
            isi: [
                `🚚 ${tebal(driver.nama)}`,
                cabang([`📬 Dikirim ke: ${ke}`, `⏱️ Berlaku: ${sesi.menit} menit`]),
            ],
            kaki: [`🔔 ${miring('Hasilnya akan dilaporkan di chat ini.')}`],
        }));
    }
}

function _kartuHasil(h) {
    const durasi = _formatDurasi(h.durasiDetik);
    if (h.hasil === 'sukses') {
        return kartu({
            judul: `✅ *LOGIN GOOGLE BERHASIL*`,
            isi: [
                `🚚 Driver: ${tebal(h.driver.nama)}`,
                cabang([
                    h.email ? `📧 Akun: ${h.email}` : null,
                    `🍪 Cookie tersimpan: ${tebal(h.jumlahCookie)} entri`,
                    `🧪 Uji form: ${tebal('LOLOS')}`,
                    `⏱️ Durasi: ${durasi}`,
                ]),
            ],
            kaki: [`🤖 ${miring('Driver siap absen otomatis. Cookie akan diperbarui sendiri setiap absen.')}`],
        });
    }

    const judul = {
        gagal: `⚠️ *LOGIN GOOGLE GAGAL*`,
        kedaluwarsa: `⌛ *LINK LOGIN KEDALUWARSA*`,
        dibatalkan: `🛑 *SESI LOGIN DIBATALKAN*`,
    }[h.hasil] || `⚠️ *LOGIN GOOGLE BERHENTI*`;

    return kartu({
        judul,
        isi: [
            `🚚 Driver: ${tebal(h.driver.nama)}`,
            h.alasan ? `🔎 ${miring(h.alasan)}` : null,
        ],
        kaki: [`💡 Ulangi dengan ${kode(`/logindriver ${h.driver.nama.split(' ')[0]}`)}. Cookie lama tidak diubah.`],
    });
}

/** /batallogin */
async function handleBatalLogin(msg) {
    const info = loginJauh.infoSesiAktif();
    if (!info) return msg.reply(`ℹ️ Tidak ada sesi login yang berjalan.`);

    const { driver } = db.findDriver(info.driver);
    if (!driver || !_bolehAkses(msg, driver)) {
        return msg.reply(`❌ *AKSES DITOLAK*\nHanya admin atau pemilik akun yang boleh membatalkan sesi ini.`);
    }

    await loginJauh.batalkanSesi('Dibatalkan lewat WhatsApp.');
    // Laporan "dibatalkan" dikirim otomatis oleh callback onSelesai.
}

/** /statuslogin */
async function handleStatusLogin(msg) {
    const info = loginJauh.infoSesiAktif();
    if (!info) {
        return msg.reply(kartu({
            judul: `🔐 *STATUS LOGIN GOOGLE*`,
            isi: [`💤 Tidak ada sesi yang berjalan.`],
            kaki: [`💡 Mulai dengan ${kode('/logindriver [Nama]')}.`],
        }));
    }

    const label = {
        menunggu: '⏳ Menunggu link dibuka',
        login: '✍️ Driver sedang login',
        menyimpan: '💾 Menyimpan & menguji cookie',
    }[info.status] || info.status;

    return msg.reply(kartu({
        judul: `🔐 *STATUS LOGIN GOOGLE*`,
        isi: [
            `🚚 Driver: ${tebal(info.driver)}`,
            cabang([
                `📍 Tahap: ${label}`,
                `💬 ${miring(info.pesan)}`,
                `👀 Layar dibuka: ${info.penonton} perangkat`,
                `⏱️ Sisa waktu: ${_formatDurasi(info.sisaDetik)}`,
            ]),
        ],
        kaki: [`🛑 Hentikan dengan ${kode('/batallogin')}.`],
    }));
}

module.exports = {
    handleLoginDriver,
    handleBatalLogin,
    handleStatusLogin,
};
