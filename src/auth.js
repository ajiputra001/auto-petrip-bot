// ══════════════════════════════════════
// 🔐 AUTH — Manajemen User, Password & Token
// ══════════════════════════════════════

const crypto = require('crypto');
const config = require('./config');
const logger = require('./utils/logger');
const { bacaJSON, tulisJSON, ensureDir } = require('./utils/helpers');

/**
 * Hash password dengan scrypt + salt (built-in Node.js, tanpa dependensi native)
 * @param {string} password - Password plaintext
 * @param {string} [salt] - Salt hex (opsional, generate baru jika kosong)
 * @returns {string} Format: "salt:hash"
 */
function hashPassword(password, salt = null) {
    const s = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
    return `${s}:${hash}`;
}

/**
 * Verifikasi password terhadap hash
 * @param {string} password - Password plaintext
 * @param {string} stored - Format "salt:hash"
 * @returns {boolean}
 */
function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const computed = hashPassword(password, salt);
    // Timing-safe compare
    const a = Buffer.from(computed.split(':')[1], 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

/**
 * Sign token (HMAC-SHA256) — pengganti JWT tanpa dependensi tambahan
 * @param {Object} payload - Data yang ditandatangani
 * @param {number} [ttlSeconds] - Masa berlaku token (default 30 hari)
 * @returns {string} token base64url
 */
function signToken(payload, ttlSeconds = 60 * 60 * 24 * 30) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    })).toString('base64url');
    const sig = crypto
        .createHmac('sha256', config.jwtSecret)
        .update(`${header}.${body}`)
        .digest('base64url');
    return `${header}.${body}.${sig}`;
}

/**
 * Verifikasi & decode token
 * @param {string} token
 * @returns {Object|null} Payload atau null jika invalid/expired
 */
function verifyToken(token) {
    try {
        const [header, body, sig] = token.split('.');
        if (!header || !body || !sig) return null;
        const expected = crypto
            .createHmac('sha256', config.jwtSecret)
            .update(`${header}.${body}`)
            .digest('base64url');
        if (expected !== sig) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

// ── Penyimpanan user ──
function _readUsers() {
    ensureDir(config.dataDir);
    return bacaJSON(config.userFile) || [];
}

function _writeUsers(users) {
    tulisJSON(config.userFile, users);
}

/**
 * Normalisasi email (lowercase + trim)
 */
function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

/**
 * Cari user berdasarkan email
 * @returns {Object|null} User (tanpa password hash di luar modul ini)
 */
function findUserByEmail(email) {
    const users = _readUsers();
    return users.find(u => u.email === normalizeEmail(email)) || null;
}

/**
 * Cari user berdasarkan ID
 */
function findUserById(id) {
    const users = _readUsers();
    return users.find(u => u.id === id) || null;
}

/**
 * Buat akun pengguna baru (email + password)
 * @param {{ email: string, password: string, nama?: string, noWa?: string, driverNama?: string }} data
 * @returns {{ success: boolean, user?: Object, error?: string }}
 */
function registerUser(data) {
    const email = normalizeEmail(data.email);
    if (!email || !email.includes('@')) {
        return { success: false, error: 'Format email tidak valid.' };
    }
    if (!data.password || String(data.password).length < 6) {
        return { success: false, error: 'Password minimal 6 karakter.' };
    }

    const users = _readUsers();
    if (users.some(u => u.email === email)) {
        return { success: false, error: 'Email sudah terdaftar. Silakan login.' };
    }

    const user = {
        id: 'usr_' + crypto.randomBytes(8).toString('hex'),
        email,
        passwordHash: hashPassword(data.password),
        nama: data.nama || email.split('@')[0],
        noWa: data.noWa || '',
        driverNama: data.driverNama || null, // link ke data driver (opsional)
        role: data.role || 'driver',         // 'admin' | 'driver'
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdAt: new Date().toISOString(),
    };

    users.push(user);
    _writeUsers(users);
    logger.success('AUTH', `User baru terdaftar: ${email} (${user.role})`);

    return { success: true, user: _sanitizeUser(user) };
}

/**
 * Login user
 * @param {string} email
 * @param {string} password
 * @returns {{ success: boolean, user?: Object, token?: string, error?: string }}
 */
function loginUser(email, password) {
    const user = findUserByEmail(email);
    if (!user) {
        return { success: false, error: 'Email belum terdaftar.' };
    }
    if (!verifyPassword(password, user.passwordHash)) {
        return { success: false, error: 'Password salah.' };
    }
    if (user.isActive === false) {
        return { success: false, error: 'Akun Anda sedang nonaktif. Hubungi admin untuk aktivasi.' };
    }

    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    return { success: true, user: _sanitizeUser(user), token };
}

/**
 * Update password user
 */
function changePassword(email, oldPassword, newPassword) {
    const users = _readUsers();
    const idx = users.findIndex(u => u.email === normalizeEmail(email));
    if (idx === -1) return { success: false, error: 'User tidak ditemukan.' };
    if (!verifyPassword(oldPassword, users[idx].passwordHash)) {
        return { success: false, error: 'Password lama salah.' };
    }
    if (!newPassword || String(newPassword).length < 6) {
        return { success: false, error: 'Password baru minimal 6 karakter.' };
    }
    users[idx].passwordHash = hashPassword(newPassword);
    _writeUsers(users);
    logger.info('AUTH', `Password diperbarui untuk ${users[idx].email}`);
    return { success: true };
}

/**
 * Hapus field sensitif dari objek user
 */
function _sanitizeUser(user) {
    const { passwordHash, ...safe } = user;
    return safe;
}

/**
 * Daftar semua user (tanpa password)
 */
function listUsers() {
    return _readUsers().map(_sanitizeUser);
}

// ════════════════════════════════
//  ADMIN OPERATIONS
// ════════════════════════════════

/**
 * Set status aktif/nonaktif user
 * @param {string} userId
 * @param {boolean} active
 */
function setActive(userId, active) {
    const users = _readUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return { success: false, error: 'User tidak ditemukan.' };
    users[idx].isActive = !!active;
    _writeUsers(users);
    logger.info('AUTH', `User ${users[idx].email} → ${active ? 'AKTIF' : 'NONAKTIF'}`);
    return { success: true, user: _sanitizeUser(users[idx]) };
}

/**
 * Set role user ('admin' | 'driver')
 */
function setRole(userId, role) {
    if (!['admin', 'driver'].includes(role)) {
        return { success: false, error: 'Role tidak valid (admin/driver).' };
    }
    const users = _readUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return { success: false, error: 'User tidak ditemukan.' };
    users[idx].role = role;
    _writeUsers(users);
    logger.info('AUTH', `User ${users[idx].email} → role ${role}`);
    return { success: true, user: _sanitizeUser(users[idx]) };
}

/**
 * Update profil user (nama, noWa, driverNama)
 */
function updateUser(userId, patch) {
    const users = _readUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return { success: false, error: 'User tidak ditemukan.' };
    const allowed = ['nama', 'noWa', 'driverNama'];
    allowed.forEach(k => {
        if (patch[k] !== undefined) users[idx][k] = patch[k];
    });
    _writeUsers(users);
    return { success: true, user: _sanitizeUser(users[idx]) };
}

/**
 * Reset password user oleh admin
 */
function adminResetPassword(userId, newPassword) {
    if (!newPassword || String(newPassword).length < 6) {
        return { success: false, error: 'Password baru minimal 6 karakter.' };
    }
    const users = _readUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return { success: false, error: 'User tidak ditemukan.' };
    users[idx].passwordHash = hashPassword(newPassword);
    _writeUsers(users);
    logger.info('AUTH', `Password direset admin untuk ${users[idx].email}`);
    return { success: true };
}

/**
 * Bootstrap admin: buat akun admin jika belum ada.
 * Dipanggil saat startup untuk memastikan selalu ada admin.
 */
function bootstrapAdmin() {
    const users = _readUsers();
    const hasAdmin = users.some(u => u.role === 'admin');
    if (hasAdmin) return { success: true, already: true };

    const result = registerUser({
        email: config.adminEmail,
        password: config.adminPassword,
        nama: config.adminName || 'Administrator',
        role: 'admin',
    });
    if (result.success) {
        logger.success('AUTH', `Akun admin dibuat otomatis: ${config.adminEmail}`);
    }
    return { success: result.success, already: false, error: result.error };
}

module.exports = {
    hashPassword,
    verifyPassword,
    signToken,
    verifyToken,
    normalizeEmail,
    findUserByEmail,
    findUserById,
    registerUser,
    loginUser,
    changePassword,
    listUsers,
    setActive,
    setRole,
    updateUser,
    adminResetPassword,
    bootstrapAdmin,
};
