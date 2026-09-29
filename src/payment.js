// ══════════════════════════════════════
// 💳 PAYMENT — Integrasi AutoGoPay (QRIS)
// ══════════════════════════════════════

const crypto = require('crypto');
const config = require('./config');
const logger = require('./utils/logger');
const { generateId } = require('./utils/helpers');
const wallet = require('./wallet');
const auth = require('./auth');

/**
 * Request helper ke AutoGoPay API
 * @param {string} method - HTTP method
 * @param {string} path - Endpoint (misal "/qris/generate")
 * @param {Object|null} body - Request body
 * @returns {Promise<Object>} Parsed JSON response
 */
async function apiRequest(method, path, body = null) {
    const url = config.autogopayBaseUrl + path;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.autogopayApiKey}`,
    };

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok && !data.success) {
        throw new Error(data.message || `AutoGoPay error (${res.status})`);
    }
    return data;
}

/**
 * Validasi signature webhook AutoGoPay (HMAC-SHA256)
 * @param {string} rawBody - Raw body string
 * @param {string} signature - Header X-Signature
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
    if (!config.autogopayApiKey || !signature) return false;
    const expected = crypto
        .createHmac('sha256', config.autogopayApiKey)
        .update(rawBody)
        .digest('hex');
    return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(String(signature))
    );
}

/**
 * Hitung biaya admin dari nominal top-up
 * @param {number} amount
 * @returns {number} total yang harus dibayar customer
 */
function calcFee(amount) {
    const fee = Math.round(amount * (config.topupFeePercent / 100));
    return { amount, fee, total: amount + fee };
}

/**
 * Buat transaksi top-up baru (generate QRIS)
 * @param {string} userId - ID user
 * @param {number} amount - Nominal saldo yang ingin dibeli
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
async function createTopup(userId, amount) {
    const n = Number(amount);
    if (isNaN(n) || n < config.topupMin) {
        return { success: false, error: `Nominal minimal Rp ${config.topupMin.toLocaleString('id-ID')}.` };
    }
    if (n > config.topupMax) {
        return { success: false, error: `Nominal maksimal Rp ${config.topupMax.toLocaleString('id-ID')}.` };
    }

    // Best-effort rekonsiliasi order pending lama (penting saat bot sempat restart)
    // supaya status PAID/EXPIRED terbaru tercermin sebelum validasi limit top-up.
    try {
        await reconcilePendingTopupsForUser(userId, 10);
    } catch (_) {
        // Abaikan error rekonsiliasi, proses createTopup tetap lanjut.
    }

    // ── Anti-Abuse: limit pending order ──
    const limitCheck = _checkTopupLimits(userId);
    if (!limitCheck.success) {
        return limitCheck;
    }

    const { total } = calcFee(n);

    try {
        const res = await apiRequest('POST', '/qris/generate', { amount: total });

        if (!res.success || !res.data) {
            return { success: false, error: res.message || 'Gagal membuat QRIS.' };
        }

        // Simpan order pending ke ledger wallet user (sebagai transaksi pending, belum topup)
        const orderId = generateId('ord');
        const order = {
            orderId,
            userId,
            providerTransactionId: res.data.transaction_id,
            amount: n,
            fee: total - n,
            total,
            status: 'PENDING',
            checkoutUrl: res.data.checkout_url,
            qrUrl: res.data.qr_url,
            qrString: res.data.qr_string,
            expiryTime: res.data.expiry_time,
            createdAt: new Date().toISOString(),
        };
        _saveOrder(order);

        logger.info('PAYMENT', `QRIS dibuat: ${orderId} (Rp ${total}) untuk ${userId}`);
        return { success: true, data: order };
    } catch (e) {
        logger.error('PAYMENT', `Gagal buat QRIS: ${e.message}`);
        return { success: false, error: e.message };
    }
}

// AutoGoPay mengirim expiry_time sebagai waktu lokal Asia/Jakarta tanpa offset.
const EXPIRY_TZ_OFFSET = '+07:00';

function _parseExpiry(order) {
    if (!order || !order.expiryTime) return null;
    const raw = String(order.expiryTime).trim();
    const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
        ? `${raw.replace(' ', 'T')}${EXPIRY_TZ_OFFSET}`
        : raw;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Cek kedaluwarsa dari expiryTime order, tanpa bergantung status provider.
 * @param {Object} order
 * @param {number} graceMs - toleransi selisih jam (default 1 menit)
 * @returns {boolean}
 */
function isOrderExpired(order, graceMs = 60000) {
    const exp = _parseExpiry(order);
    if (!exp) return false;
    return Date.now() > exp.getTime() + graceMs;
}

/**
 * Tandai EXPIRED semua order pending yang sudah lewat masa berlaku.
 * @param {string} [userId] - batasi ke satu user, kosong = semua user
 * @returns {Array<Object>} order yang baru ditandai EXPIRED
 */
function _expireStalePendingOrders(userId = null) {
    const orders = _readOrders();
    const changed = [];
    let dirty = false;

    orders.forEach((o, i) => {
        if (o.status !== 'PENDING') return;
        if (userId && o.userId !== userId) return;
        if (!isOrderExpired(o)) return;
        orders[i] = { ...o, status: 'EXPIRED', expiredAt: new Date().toISOString() };
        changed.push(orders[i]);
        dirty = true;
    });

    if (dirty) {
        _writeOrders(orders);
        changed.forEach(o => {
            logger.info('PAYMENT', `Order ${o.orderId} kedaluwarsa (berlaku s/d ${o.expiryTime}) → EXPIRED.`);
        });
    }
    return changed;
}

/**
 * Rekonsiliasi order pending user terhadap provider.
 * Berguna ketika bot sempat restart saat polling berlangsung.
 * @param {string} userId
 * @param {number} limit
 * @returns {Promise<{ success: boolean, checked: number, paid: number, expired: number, paidOrders: Array<Object>, expiredOrders: Array<Object> }>}
 */
async function reconcilePendingTopupsForUser(userId, limit = 10) {
    const pendingOrders = _readOrders()
        .filter(o => o.userId === userId && o.status === 'PENDING')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);

    let checked = 0;
    let paid = 0;
    let expired = 0;
    const paidOrders = [];
    const expiredOrders = [];

    for (const ord of pendingOrders) {
        checked++;
        try {
            const before = getOrderById(ord.orderId);
            await checkStatus(ord.orderId);
            let after = getOrderById(ord.orderId);

            // Provider kadang tetap melaporkan "pending" walau QRIS sudah lewat masa berlaku.
            if (after?.status === 'PENDING' && isOrderExpired(after)) {
                after = _updateOrder(ord.orderId, { status: 'EXPIRED' }) || after;
                logger.info('PAYMENT', `Order ${ord.orderId} ditandai EXPIRED (lewat ${after.expiryTime}).`);
            }

            if (before?.status !== 'PAID' && after?.status === 'PAID') {
                paid++;
                paidOrders.push(after);
            }
            if (before?.status !== 'EXPIRED' && after?.status === 'EXPIRED') {
                expired++;
                expiredOrders.push(after);
            }
        } catch (_) {
            // Jika satu order gagal dicek, lanjut order lainnya.
        }
    }

    return { success: true, checked, paid, expired, paidOrders, expiredOrders };
}

/**
 * Cek limit top-up user (anti-abuse)
 * @param {string} userId
 * @returns {{ success: boolean, error?: string }}
 */
function _checkTopupLimits(userId) {
    _expireStalePendingOrders(userId);
    const orders = _readOrders();

    // 1. Limit order pending (belum dibayar)
    const pending = orders
        .filter(o => o.userId === userId && o.status === 'PENDING')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (pending.length >= config.topupMaxPending) {
        return {
            success: false,
            code: 'PENDING_EXISTS',
            pendingOrder: pending[0] || null,
            error: `Anda masih punya ${pending.length} pembayaran belum selesai. Selesaikan/dibatalkan dulu sebelum membuat QRIS baru.`,
        };
    }

    // 2. Cooldown antar pembuatan QRIS
    if (config.topupCooldownMin > 0) {
        const recent = orders
            .filter(o => o.userId === userId)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        if (recent) {
            const diffMin = (Date.now() - new Date(recent.createdAt).getTime()) / 60000;
            if (diffMin < config.topupCooldownMin) {
                return {
                    success: false,
                    error: `Tunggu ${Math.ceil(config.topupCooldownMin - diffMin)} menit lagi sebelum membuat QRIS baru.`,
                };
            }
        }
    }

    // 3. Limit topup berhasil per hari
    if (config.topupMaxDaily > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const paidToday = orders.filter(o =>
            o.userId === userId && o.status === 'PAID' && (o.paidAt || o.createdAt).slice(0, 10) === today
        );
        if (paidToday.length >= config.topupMaxDaily) {
            return {
                success: false,
                error: `Batas top-up harian Anda (${config.topupMaxDaily}x) sudah tercapai. Coba lagi besok.`,
            };
        }
    }

    return { success: true };
}

// ── Penyimpanan order ──
const path = require('path');
const { bacaJSON, tulisJSON, ensureDir } = require('./utils/helpers');

function _orderFile() {
    return path.join(config.dataDir, 'database_orders.json');
}

function _readOrders() {
    ensureDir(config.dataDir);
    return bacaJSON(_orderFile()) || [];
}

function _writeOrders(orders) {
    tulisJSON(_orderFile(), orders);
}

function _saveOrder(order) {
    const orders = _readOrders();
    orders.push(order);
    _writeOrders(orders);
}

function _updateOrder(orderId, patch) {
    const orders = _readOrders();
    const idx = orders.findIndex(o => o.orderId === orderId);
    if (idx === -1) return null;
    orders[idx] = { ...orders[idx], ...patch };
    _writeOrders(orders);
    return orders[idx];
}

function getOrderById(orderId) {
    return _readOrders().find(o => o.orderId === orderId) || null;
}

function getOrderByProviderTxId(txId) {
    return _readOrders().find(o => o.providerTransactionId === txId) || null;
}

function getLatestPendingOrder(userId) {
    return _readOrders()
        .filter(o => o.userId === userId && o.status === 'PENDING')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

/**
 * Tandai order sebagai PAID & top-up saldo user
 * @param {string} providerTransactionId
 * @param {Object} paymentInfo - info pembayaran dari webhook
 * @returns {{ success: boolean, order?: Object, error?: string }}
 */
function markPaid(providerTransactionId, paymentInfo = {}) {
    const order = getOrderByProviderTxId(providerTransactionId);
    if (!order) return { success: false, error: 'Order tidak ditemukan.' };

    if (order.status === 'PAID') {
        return { success: true, order, already: true };
    }

    // Anti double-credit
    const updated = _updateOrder(order.orderId, {
        status: 'PAID',
        paidAt: new Date().toISOString(),
        paymentInfo,
    });

    // Tambah saldo
    const result = wallet.mutateBalance(
        order.userId,
        order.amount,
        'TOPUP',
        `Top-up saldo via AutoGoPay (${paymentInfo.payment_method || 'QRIS'})`,
        { orderId: order.orderId, providerTransactionId }
    );

    if (!result.success) {
        // Rollback status jika topup gagal (harusnya tidak terjadi)
        _updateOrder(order.orderId, { status: 'PENDING' });
        return { success: false, error: result.error };
    }

    // ── Auto-aktifkan akun jika sebelumnya nonaktif ──
    try {
        const user = auth.findUserById(order.userId);
        if (user && user.isActive === false) {
            auth.setActive(order.userId, true);
            logger.success('PAYMENT', `Akun ${user.email} otomatis DIAKTIFKAN setelah pembayaran.`);
        }
    } catch (e) {
        logger.warn('PAYMENT', `Gagal auto-aktif akun: ${e.message}`);
    }

    logger.success('PAYMENT', `Top-up berhasil: ${order.orderId} → +Rp ${order.amount} untuk ${order.userId}`);
    return { success: true, order: updated };
}

/**
 * Cek status pembayaran order (polling manual)
 */
async function checkStatus(orderId) {
    const order = getOrderById(orderId);
    if (!order) return { success: false, error: 'Order tidak ditemukan.' };
    if (order.status === 'PAID') return { success: true, order };

    try {
        const res = await apiRequest('POST', '/qris/status', { transaction_id: order.providerTransactionId });
        if (!res.success || !res.data) {
            return { success: false, error: res.message || 'Gagal cek status.' };
        }

        // AutoGoPay memakai field "transaction_status" (bukan "status")
        const st = (res.data.transaction_status || res.data.status || '').toLowerCase();

        if (st === 'settlement' || st === 'paid' || st === 'success') {
            markPaid(order.providerTransactionId, { payment_method: 'QRIS' });
            return { success: true, order: getOrderById(orderId) };
        }
        if (st === 'expire' || st === 'expired' || st === 'cancel' || st === 'cancelled') {
            _updateOrder(orderId, { status: 'EXPIRED' });
            return { success: false, error: 'Pembayaran kedaluwarsa.' };
        }
        return { success: true, order: getOrderById(orderId) }; // masih pending
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ════════════════════════════════
//  ADMIN OPERATIONS
// ════════════════════════════════

/**
 * Daftar semua order (untuk admin), paling baru dulu
 */
function listOrders(limit = 100) {
    return _readOrders()
        .slice()
        .reverse()
        .slice(0, limit);
}

/**
 * Batalkan order pending (untuk admin)
 */
function cancelOrder(orderId) {
    const order = getOrderById(orderId);
    if (!order) return { success: false, error: 'Order tidak ditemukan.' };
    if (order.status === 'PAID') return { success: false, error: 'Order sudah dibayar, tidak bisa dibatalkan.' };
    _updateOrder(orderId, { status: 'CANCELLED' });
    return { success: true, order: getOrderById(orderId) };
}

module.exports = {
    apiRequest,
    verifyWebhookSignature,
    calcFee,
    createTopup,
    markPaid,
    checkStatus,
    getOrderById,
    getOrderByProviderTxId,
    getLatestPendingOrder,
    isOrderExpired,
    reconcilePendingTopupsForUser,
    listOrders,
    cancelOrder,
};
