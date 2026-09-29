// ══════════════════════════════════════
// 🌐 WEB SERVER — Dashboard, API & Webhook
// ══════════════════════════════════════

const path = require('path');
const fs = require('fs');
const http = require('http');
const config = require('./config');
const logger = require('./utils/logger');
const auth = require('./auth');
const wallet = require('./wallet');
const payment = require('./payment');
const settings = require('./settings');
const { formatRupiah } = require('./utils/helpers');

/**
 * Parser body JSON + raw body (untuk verifikasi signature webhook)
 */
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({ raw, body: raw ? JSON.parse(raw) : {} });
        });
        req.on('error', reject);
    });
}

function sendJSON(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}

/**
 * Ekstrak token dari header Authorization
 */
function extractToken(req) {
    const h = req.headers['authorization'] || '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/**
 * Ambil user dari request (verifikasi token). Return null jika tidak valid.
 */
function authUser(req) {
    const payload = auth.verifyToken(extractToken(req));
    if (!payload) return null;
    return auth.findUserById(payload.sub) || null;
}

/**
 * Wajib admin, return user admin atau null
 */
function requireAdmin(req) {
    const user = authUser(req);
    if (!user || user.role !== 'admin') return null;
    return user;
}

/**
 * Parse query string
 */
function parseQuery(req) {
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams;
}

/**
 * Serve file statis dari folder public/
 */
function serveStatic(req, res) {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const filePath = path.join(config.webDir, p);
    if (!filePath.startsWith(config.webDir)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }
    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end('Not Found');
    }
    const ext = path.extname(filePath);
    const mime = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
}

/**
 * Router utama
 */
async function router(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method;

    // ── Webhook Payment (dari AutoGoPay) ──
    if (pathname === '/api/webhook/payment' && method === 'POST') {
        try {
            const { raw, body } = await readBody(req);
            const signature = req.headers['x-signature'] || '';

            if (!payment.verifyWebhookSignature(raw, signature)) {
                logger.warn('WEBHOOK', 'Signature tidak valid, tolak webhook.');
                return sendJSON(res, 401, { success: false, message: 'Invalid signature' });
            }

            logger.info('WEBHOOK', `Event: ${body.event || 'unknown'}`);

            if (body.event === 'transaction.received' && body.transaction) {
                const tx = body.transaction;
                if (tx.status === 'PAID') {
                    const result = payment.markPaid(tx.transaction_id, {
                        payment_method: tx.payment_method,
                        paid_at: tx.paid_at,
                    });
                    logger.success('WEBHOOK', result.already
                        ? 'Transaksi duplikat, dilewati.'
                        : `Pembayaran diterima: ${tx.transaction_id}`);
                }
            }

            return sendJSON(res, 200, { success: true });
        } catch (e) {
            logger.error('WEBHOOK', `Error: ${e.message}`);
            return sendJSON(res, 500, { success: false, message: e.message });
        }
    }

    // ── API: Register ──
    if (pathname === '/api/register' && method === 'POST') {
        const { body } = await readBody(req);
        const result = auth.registerUser({
            email: body.email,
            password: body.password,
            nama: body.nama,
            noWa: body.noWa,
            driverNama: body.driverNama,
        });
        if (!result.success) return sendJSON(res, 400, result);
        return sendJSON(res, 201, result);
    }

    // ── API: Login ──
    if (pathname === '/api/login' && method === 'POST') {
        const { body } = await readBody(req);
        const result = auth.loginUser(body.email, body.password);
        if (!result.success) return sendJSON(res, 401, result);
        return sendJSON(res, 200, result);
    }

    // ── API: Cek auth ──
    if (pathname === '/api/me' && method === 'GET') {
        const payload = auth.verifyToken(extractToken(req));
        if (!payload) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        const user = auth.findUserById(payload.sub);
        if (!user) return sendJSON(res, 401, { success: false, error: 'User tidak ditemukan' });
        const { passwordHash, ...safe } = user;
        return sendJSON(res, 200, { success: true, user: safe });
    }

    // ── API: Saldo & riwayat ──
    if (pathname === '/api/wallet' && method === 'GET') {
        const payload = auth.verifyToken(extractToken(req));
        if (!payload) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        return sendJSON(res, 200, {
            success: true,
            balance: wallet.getBalance(payload.sub),
            transactions: wallet.getTransactions(payload.sub, 50),
        });
    }

    // ── API: Buat top-up (QRIS) ──
    if (pathname === '/api/topup' && method === 'POST') {
        const payload = auth.verifyToken(extractToken(req));
        if (!payload) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        const { body } = await readBody(req);
        const result = await payment.createTopup(payload.sub, body.amount);
        if (!result.success) return sendJSON(res, 400, result);
        return sendJSON(res, 201, result);
    }

    // ── API: Cek status order ──
    if (pathname === '/api/topup/status' && method === 'GET') {
        const payload = auth.verifyToken(extractToken(req));
        if (!payload) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        const orderId = parseQuery(req).get('orderId');
        const result = await payment.checkStatus(orderId);
        if (!result.success) return sendJSON(res, 400, result);
        return sendJSON(res, 200, result);
    }

    // ════════════════════════════════
    //  ADMIN API
    // ════════════════════════════════

    // ── Admin: ringkasan statistik ──
    if (pathname === '/api/admin/stats' && method === 'GET') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });

        const users = auth.listUsers();
        const wSummary = wallet.summary();
        const orders = payment.listOrders(200);

        const stats = {
            totalUsers: users.length,
            activeUsers: users.filter(u => u.isActive !== false).length,
            inactiveUsers: users.filter(u => u.isActive === false).length,
            totalBalance: wSummary.totalBalance,
            totalTopup: wSummary.totalTopup,
            pendingOrders: orders.filter(o => o.status === 'PENDING').length,
            paidOrders: orders.filter(o => o.status === 'PAID').length,
            totalOrders: orders.length,
        };
        return sendJSON(res, 200, { success: true, stats });
    }

    // ── Admin: daftar semua user ──
    if (pathname === '/api/admin/users' && method === 'GET') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });

        const users = auth.listUsers().map(u => ({
            ...u,
            balance: wallet.getBalance(u.id),
        }));
        return sendJSON(res, 200, { success: true, users });
    }

    // ── Admin: update user (aktif, role, saldo) ──
    if (pathname === '/api/admin/users/update' && method === 'POST') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        const { body } = await readBody(req);

        const userId = body.userId;
        if (!userId) return sendJSON(res, 400, { success: false, error: 'userId diperlukan' });

        // Ubah status aktif
        if (body.isActive !== undefined) {
            auth.setActive(userId, !!body.isActive);
        }
        // Ubah role
        if (body.role) {
            auth.setRole(userId, body.role);
        }
        // Reset password
        if (body.newPassword) {
            auth.adminResetPassword(userId, body.newPassword);
        }
        // Update profil
        if (body.nama || body.noWa || body.driverNama) {
            auth.updateUser(userId, {
                nama: body.nama,
                noWa: body.noWa,
                driverNama: body.driverNama,
            });
        }

        const updated = auth.findUserById(userId);
        const { passwordHash, ...safe } = updated;
        return sendJSON(res, 200, { success: true, user: { ...safe, balance: wallet.getBalance(userId) } });
    }

    // ── Admin: top-up manual (adjust saldo) ──
    if (pathname === '/api/admin/users/adjust' && method === 'POST') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        const { body } = await readBody(req);

        const userId = body.userId;
        const amount = Number(body.amount);
        const reason = body.reason || 'Penyesuaian admin';

        if (!userId || isNaN(amount) || amount === 0) {
            return sendJSON(res, 400, { success: false, error: 'userId & amount (bukan 0) diperlukan' });
        }

        const result = wallet.mutateBalance(userId, amount, amount > 0 ? 'ADJUST' : 'ADJUST', reason, { adminId: admin.id });
        if (!result.success) return sendJSON(res, 400, result);
        return sendJSON(res, 200, { success: true, balance: result.balance });
    }

    // ── Admin: daftar semua transaksi ──
    if (pathname === '/api/admin/transactions' && method === 'GET') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });

        const limit = parseInt(parseQuery(req).get('limit')) || 100;
        const txs = wallet.getAllTransactions(limit).map(t => {
            const u = auth.findUserById(t.userId);
            return { ...t, userName: u?.nama || '-', userEmail: u?.email || '-' };
        });
        return sendJSON(res, 200, { success: true, transactions: txs });
    }

    // ── Admin: daftar semua order top-up ──
    if (pathname === '/api/admin/orders' && method === 'GET') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });

        const orders = payment.listOrders(200).map(o => {
            const u = auth.findUserById(o.userId);
            return { ...o, userName: u?.nama || '-', userEmail: u?.email || '-' };
        });
        return sendJSON(res, 200, { success: true, orders });
    }

    // ── Admin: batalkan order ──
    if (pathname === '/api/admin/orders/cancel' && method === 'POST') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        const { body } = await readBody(req);
        const result = payment.cancelOrder(body.orderId);
        if (!result.success) return sendJSON(res, 400, result);
        return sendJSON(res, 200, result);
    }

    // ── Admin: ambil link form aktif ──
    if (pathname === '/api/admin/settings' && method === 'GET') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        return sendJSON(res, 200, { success: true, formUrl: settings.getFormUrl() });
    }

    // ── Admin: ubah link form ──
    if (pathname === '/api/admin/settings/form' && method === 'POST') {
        const admin = requireAdmin(req);
        if (!admin) return sendJSON(res, 401, { success: false, error: 'Unauthorized' });
        const { body } = await readBody(req);
        const result = settings.setFormUrl(body.formUrl);
        if (!result.success) return sendJSON(res, 400, result);
        return sendJSON(res, 200, result);
    }

    // ── Halaman statis ──
    if (method === 'GET') {
        return serveStatic(req, res);
    }

    return sendJSON(res, 404, { success: false, message: 'Not Found' });
}

/**
 * Jalankan web server (non-blocking, dalam proses bot)
 * @returns {http.Server|null}
 */
function startWebServer() {
    if (!config.webPort || config.webPort === 0) {
        logger.warn('WEB', 'Dashboard dinonaktifkan (WEB_PORT=0).');
        return null;
    }

    const server = http.createServer((req, res) => {
        router(req, res).catch((e) => {
            logger.error('WEB', `Unhandled error: ${e.message}`);
            try { sendJSON(res, 500, { success: false, message: 'Internal error' }); } catch (_) {}
        });
    });

    server.listen(config.webPort, () => {
        logger.success('WEB', `Dashboard aktif di http://0.0.0.0:${config.webPort}`);
        logger.info('WEB', `Public base URL: ${config.publicBaseUrl}`);
    });

    server.on('error', (e) => {
        logger.error('WEB', `Gagal start server: ${e.message}`);
    });

    return server;
}

module.exports = { startWebServer };
