// ══════════════════════════════════════════
// 🎨 TAMPILAN — Pembentuk Balasan WhatsApp
// ══════════════════════════════════════════
//
// Dua aturan render WhatsApp yang sering bikin balasan tampak berantakan:
//
// 1. `*tebal*` HANYA dirender bila bintang menempel ke karakter non-spasi.
//    `*Agung  *` akan tampil mentah dengan bintangnya terlihat.
// 2. Teks biasa dirender dengan font proporsional, jadi meratakan kolom
//    dengan spasi (`padEnd`) tidak pernah benar-benar lurus.
//
// Modul ini memusatkan kedua aturan itu supaya semua perintah konsisten.

const GARIS = '━'.repeat(22);

/**
 * Tebalkan nilai dengan aman — spasi di dalam bintang dibuang dulu
 * karena WhatsApp tidak merender `*teks *` sebagai tebal.
 * @param {*} nilai
 * @returns {string}
 */
function tebal(nilai) {
    const teks = String(nilai ?? '').replace(/\s+/g, ' ').trim();
    return teks ? `*${teks}*` : '-';
}

/**
 * Miringkan nilai dengan aman (aturan spasi sama seperti tebal).
 * @param {*} nilai
 * @returns {string}
 */
function miring(nilai) {
    const teks = String(nilai ?? '').replace(/\s+/g, ' ').trim();
    return teks ? `_${teks}_` : '-';
}

/**
 * Bungkus nilai jadi monospace inline.
 * @param {*} nilai
 * @returns {string}
 */
function kode(nilai) {
    const teks = String(nilai ?? '').trim();
    return teks ? `\`${teks}\`` : '-';
}

/**
 * Format nominal bertanda: `+Rp 500` / `-Rp 500`.
 *
 * `formatRupiah(-500)` menghasilkan `Rp -500` dengan minus terjepit di tengah,
 * yang terbaca janggal pada daftar transaksi.
 * @param {number} nominal
 * @returns {string}
 */
function rupiahBertanda(nominal) {
    const n = Number(nominal) || 0;
    const tanda = n > 0 ? '+' : n < 0 ? '-' : '';
    return `${tanda}Rp ${Math.abs(n).toLocaleString('id-ID')}`;
}

/**
 * Baris `ikon Label: nilai`.
 *
 * Tidak ada perataan spasi karena font proporsional WhatsApp membuatnya
 * mustahil lurus — satu spasi setelah titik dua justru terlihat lebih bersih.
 * @param {string} ikon
 * @param {string} label
 * @param {*} nilai
 * @returns {string}
 */
function baris(ikon, label, nilai) {
    const isi = String(nilai ?? '').trim();
    return `${ikon} ${label}: ${isi || '-'}`;
}

/**
 * Tabel monospace — satu-satunya cara perataan kolom benar-benar lurus di WA.
 * Perlu diingat: `*tebal*` tidak berlaku di dalam blok monospace.
 * @param {Array<[string, *]>} rows - Pasangan [label, nilai]
 * @returns {string} Blok monospace siap kirim
 */
function tabel(rows) {
    const isi = (rows || []).filter((r) => Array.isArray(r) && r.length);
    if (!isi.length) return '';

    const lebar = Math.max(...isi.map(([k]) => String(k).length));
    const teks = isi
        .map(([k, v]) => `${String(k).padEnd(lebar, ' ')} : ${String(v ?? '-')}`)
        .join('\n');

    return '```\n' + teks + '\n```';
}

/**
 * Daftar bercabang — item terakhir memakai sudut penutup.
 * @param {Array<string>} items
 * @returns {string}
 */
function cabang(items) {
    const isi = (items || []).filter((v) => v !== null && v !== undefined && v !== '');
    if (!isi.length) return '';
    return isi
        .map((v, i) => `${i === isi.length - 1 ? '└' : '├'} ${v}`)
        .join('\n');
}

/**
 * Rangkai kartu balasan standar: judul, garis, isi, garis, kaki.
 * @param {{ judul: string, isi?: Array<string>, kaki?: Array<string> }} opsi
 * @returns {string}
 */
function kartu({ judul, isi = [], kaki = [] }) {
    const bersih = (arr) => arr.filter((v) => v !== null && v !== undefined);

    const blok = [judul, GARIS, ...bersih(isi), GARIS];
    const bawah = bersih(kaki);
    if (bawah.length) blok.push(...bawah);

    return blok.join('\n');
}

module.exports = {
    GARIS,
    tebal,
    miring,
    kode,
    rupiahBertanda,
    baris,
    tabel,
    cabang,
    kartu,
};
