// ══════════════════════════════════════
// 💰 WALLET — Saldo & Transaksi Pengguna
// ══════════════════════════════════════

const crypto = require('crypto');
const config = require('./config');
const logger = require('./utils/logger');
const { bacaJSON, tulisJSON, ensureDir, generateId } = require('./utils/helpers');

/**
 * Baca seluruh data wallet
 * Format: { [userId]: { balance: number, transactions: [] } }
 */
function _readWallets() {
    ensureDir(config.dataDir);
    return bacaJSON(config.walletFile) || {};
}

function _writeWallets(wallets) {
    tulisJSON(config.walletFile, wallets);
}

/**
 * Pastikan akun wallet user ada (buat default jika belum)
 */
function ensureWallet(userId) {
    const wallets = _readWallets();
    if (!wallets[userId]) {
        wallets[userId] = { balance: 0, transactions: [] };
        _writeWallets(wallets);
    }
    return wallets[userId];
}

/**
 * Ambil saldo user
 * @param {string} userId
 * @returns {number}
 */
function getBalance(userId) {
    return ensureWallet(userId).balance;
}

/**
 * Ambil riwayat transaksi user (paling baru dulu)
 */
function getTransactions(userId, limit = 20) {
    const wallet = ensureWallet(userId);
    return wallet.transactions.slice().reverse().slice(0, limit);
}

/**
 * Mutasi saldo secara atomik (dengan pencatatan transaksi)
 * @param {string} userId
 * @param {number} amount - Positif = topup/masuk, negatif = potong/keluar
 * @param {string} type - Jenis transaksi
 * @param {string} description - Deskripsi
 * @param {Object} meta - Metadata tambahan (opsional)
 * @returns {{ success: boolean, balance?: number, transaction?: Object, error?: string }}
 */
function mutateBalance(userId, amount, type, description, meta = {}) {
    const wallets = _readWallets();
    const wallet = wallets[userId] || { balance: 0, transactions: [] };

    const delta = Number(amount);
    if (isNaN(delta) || delta === 0) {
        return { success: false, error: 'Nominal tidak valid.' };
    }

    const newBalance = wallet.balance + delta;
    if (newBalance < 0) {
        return { success: false, error: 'Saldo tidak mencukupi.' };
    }

    const transaction = {
        id: generateId('trx'),
        amount: delta,
        balanceAfter: newBalance,
        type, // 'TOPUP' | 'POTONG_ABSEN' | 'BONUS' | 'ADJUST' | 'REFUND'
        description,
        meta,
        createdAt: new Date().toISOString(),
    };

    wallet.balance = newBalance;
    wallet.transactions.push(transaction);
    wallets[userId] = wallet;
    _writeWallets(wallets);

    logger.info('WALLET', `[${userId}] ${type} ${delta >= 0 ? '+' : ''}${delta} → saldo ${newBalance}`);
    return { success: true, balance: newBalance, transaction };
}

/**
 * Cek & potong saldo untuk 1x proses absen
 * @param {string} userId
 * @param {string} driverNama
 * @returns {{ success: boolean, error?: string }}
 */
function chargeAbsen(userId, driverNama) {
    const price = config.pricePerAbsen;
    if (price <= 0) return { success: true, free: true }; // gratis jika harga 0

    const balance = getBalance(userId);
    if (balance < price) {
        return { success: false, error: `Saldo tidak mencukupi. Butuh ${price}, saldo Anda ${balance}.` };
    }
    return mutateBalance(userId, -price, 'POTONG_ABSEN', `Biaya pengisian form untuk ${driverNama}`);
}

/**
 * Ringkasan wallet semua user (untuk admin)
 */
function summary() {
    const wallets = _readWallets();
    let totalBalance = 0;
    let totalTopup = 0;
    const rows = Object.entries(wallets).map(([userId, w]) => {
        totalBalance += w.balance;
        w.transactions.forEach(t => {
            if (t.type === 'TOPUP') totalTopup += t.amount;
        });
        return { userId, balance: w.balance, txCount: w.transactions.length };
    });
    return { totalUsers: rows.length, totalBalance, totalTopup, rows };
}

/**
 * Semua transaksi global (untuk admin), paling baru dulu
 * @param {number} limit
 */
function getAllTransactions(limit = 100) {
    const wallets = _readWallets();
    const all = [];
    Object.entries(wallets).forEach(([userId, w]) => {
        w.transactions.forEach(t => all.push({ userId, ...t }));
    });
    return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

/**
 * Ambil wallet mentah user (untuk admin)
 */
function getWallet(userId) {
    return ensureWallet(userId);
}

module.exports = {
    ensureWallet,
    getBalance,
    getTransactions,
    mutateBalance,
    chargeAbsen,
    summary,
    getAllTransactions,
    getWallet,
};
