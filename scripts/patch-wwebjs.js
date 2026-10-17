#!/usr/bin/env node
// ══════════════════════════════════════════
// 🩹 PATCH — Perbaikan bug kirim media whatsapp-web.js
// ══════════════════════════════════════════
//
// MASALAH
// Setiap pengiriman berkas (cadangan /backup, QRIS, foto) gagal dengan:
//
//   Data passed to getter must include an id property (it's how we memoize)
//   but got undefined
//
// SEBABNYA ada di whatsapp-web.js, bukan di bot ini. Saat menyusun objek
// pesan, pustaka itu menyebar seluruh properti `mediaOptions`:
//
//   ...mediaOptions,
//   ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),
//
// `mediaOptions` adalah model MediaData milik WhatsApp Web yang punya field
// privat `__x_id`. Field itu ikut tersalin dan bertabrakan dengan field `id`
// internal Msg, sehingga `getValidatedSender()` gagal saat Msg dibuat.
//
// Bug ini MUTLAK, bukan sementara: mengirim ulang tidak akan pernah berhasil.
// Muncul setelah pembaruan WhatsApp Web 2026 dan belum masuk rilis npm mana
// pun (1.34.7 adalah versi terbaru per Oktober 2026). Perbaikannya sudah ada
// di branch `main` whatsapp-web.js, jadi di sini kita terapkan potongan yang
// sama persis ke berkas yang sudah terpasang.
//
// Dijalankan otomatis lewat `npm install` (postinstall) & install.sh.
// Aman dijalankan berulang kali — kalau sudah ditambal, ia berhenti sendiri.
//
// Rujukan: wwebjs/whatsapp-web.js @ main — util/Injected/Utils.js

const fs = require('fs');
const path = require('path');

const BERKAS = path.join(
    __dirname,
    '..',
    'node_modules',
    'whatsapp-web.js',
    'src',
    'util',
    'Injected',
    'Utils.js'
);

// Jangkar: baris tepat sebelum tempat perbaikan harus disisipkan.
const JANGKAR = `        // Bot's won't reply if canonicalUrl is set (linking)`;

const TAMBALAN = `        // MediaData is a model whose private __x_id field collides with Msg's
        // internal id field when its enumerable properties are spread above,
        // breaking getValidatedSender() during Msg initialization.
        if (message.__x_id) {
            delete message.__x_id;
        }
`;

const PENANDA = 'message.__x_id';

function main() {
    if (!fs.existsSync(BERKAS)) {
        console.log('[patch-wwebjs] whatsapp-web.js belum terpasang — dilewati.');
        return;
    }

    const asli = fs.readFileSync(BERKAS, 'utf8');

    if (asli.includes(PENANDA)) {
        console.log('[patch-wwebjs] Sudah ditambal — tidak ada yang diubah.');
        return;
    }

    if (!asli.includes(JANGKAR)) {
        // Versi pustaka berubah. Jangan menebak posisi: lebih baik gagal
        // terang-terangan daripada merusak berkas yang masih sehat.
        console.warn(
            '[patch-wwebjs] ⚠️  Titik sisip tidak ditemukan. ' +
            'whatsapp-web.js kemungkinan sudah diperbarui — periksa apakah tambalan ini masih perlu.'
        );
        return;
    }

    if (asli.split(JANGKAR).length - 1 !== 1) {
        console.warn('[patch-wwebjs] ⚠️  Titik sisip tidak unik — dibatalkan demi keamanan.');
        return;
    }

    fs.writeFileSync(BERKAS, asli.replace(JANGKAR, TAMBALAN + JANGKAR), 'utf8');
    console.log('[patch-wwebjs] ✅ Bug kirim media diperbaiki (__x_id dihapus sebelum Msg dibuat).');
}

main();
