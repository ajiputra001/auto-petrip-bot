// ══════════════════════════════════════
// 🛡️ Admin Panel Frontend Logic
// ══════════════════════════════════════

let token = localStorage.getItem('admin_token');
let admin = JSON.parse(localStorage.getItem('admin_user') || 'null');

let currentUser = null; // user yang sedang dikelola di modal

function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
}

function setError(id, msg) {
    const el = document.getElementById(id);
    if (msg) { el.textContent = msg; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
}

function formatRp(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401 && path !== '/api/login') {
        logout();
        throw new Error('Unauthorized');
    }
    return res.json();
}

function logout() {
    token = null;
    admin = null;
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    showView('login');
}

// ── Init ──
if (token && admin) {
    showPanel();
} else {
    showView('login');
}

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    setError('login-error', '');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const res = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });

    if (!res.success) return setError('login-error', res.error || 'Login gagal.');
    if (res.user.role !== 'admin') return setError('login-error', 'Akun ini bukan admin.');

    token = res.token;
    admin = res.user;
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_user', JSON.stringify(admin));
    showPanel();
});

document.getElementById('logout-btn').addEventListener('click', logout);

// ── Panel ──
function showPanel() {
    showView('panel');
    document.getElementById('admin-name').textContent = admin?.nama || admin?.email;
    loadAll();
}

async function loadAll() {
    await Promise.all([loadStats(), loadUsers(), loadTransactions(), loadOrders(), loadSettings()]);
}

async function loadSettings() {
    const res = await api('/api/admin/settings');
    if (!res.success) return;
    document.getElementById('current-form-url').textContent = res.formUrl;
    document.getElementById('form-url-input').value = res.formUrl;
}

document.getElementById('form-url-form').addEventListener('submit', async e => {
    e.preventDefault();
    setError('form-url-error', '');
    const formUrl = document.getElementById('form-url-input').value.trim();

    const res = await api('/api/admin/settings/form', {
        method: 'POST',
        body: JSON.stringify({ formUrl }),
    });

    if (!res.success) {
        return setError('form-url-error', res.error || 'Gagal menyimpan link.');
    }
    setError('form-url-error', '');
    document.getElementById('current-form-url').textContent = res.url;
    alert('✅ Link form berhasil diperbarui.');
});

async function loadStats() {
    const res = await api('/api/admin/stats');
    if (!res.success) return;
    const s = res.stats;
    document.getElementById('st-users').textContent = s.totalUsers;
    document.getElementById('st-active').textContent = s.activeUsers;
    document.getElementById('st-balance').textContent = formatRp(s.totalBalance);
    document.getElementById('st-topup').textContent = formatRp(s.totalTopup);
    document.getElementById('st-pending').textContent = s.pendingOrders;
    document.getElementById('st-orders').textContent = s.totalOrders;
}

async function loadUsers() {
    const res = await api('/api/admin/users');
    if (!res.success) return;
    const tbody = document.getElementById('users-body');
    tbody.innerHTML = res.users.map(u => `
        <tr>
            <td><strong>${u.nama}</strong></td>
            <td>${u.email}</td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-driver'}">${u.role}</span></td>
            <td><span class="badge ${u.isActive !== false ? 'badge-active' : 'badge-inactive'}">${u.isActive !== false ? 'Aktif' : 'Nonaktif'}</span></td>
            <td>${formatRp(u.balance)}</td>
            <td><button class="action-btn" onclick="openUser('${u.id}')">Kelola</button></td>
        </tr>
    `).join('');
}

async function loadTransactions() {
    const res = await api('/api/admin/transactions?limit=100');
    if (!res.success) return;
    const tbody = document.getElementById('transactions-body');
    const typeMap = { TOPUP: '💰 Top-up', POTONG_ABSEN: '🤖 Absen', ADJUST: '🔧 Adjust', BONUS: '🎁 Bonus', REFUND: '↩️ Refund' };
    tbody.innerHTML = res.transactions.map(t => `
        <tr>
            <td>${new Date(t.createdAt).toLocaleString('id-ID')}</td>
            <td>${t.userName || t.userId}</td>
            <td>${typeMap[t.type] || t.type}</td>
            <td>${t.description}</td>
            <td style="color:${t.amount >= 0 ? 'var(--success)' : 'var(--danger)'}">${t.amount >= 0 ? '+' : ''}${formatRp(t.amount)}</td>
        </tr>
    `).join('');
}

async function loadOrders() {
    const res = await api('/api/admin/orders');
    if (!res.success) return;
    const tbody = document.getElementById('orders-body');
    const statusBadge = { PENDING: 'badge-pending', PAID: 'badge-paid', EXPIRED: 'badge-expired', CANCELLED: 'badge-cancelled' };
    tbody.innerHTML = res.orders.map(o => `
        <tr>
            <td>${new Date(o.createdAt).toLocaleString('id-ID')}</td>
            <td>${o.userName || o.userId}</td>
            <td>${formatRp(o.total)}</td>
            <td><span class="badge ${statusBadge[o.status] || 'badge-cancelled'}">${o.status}</span></td>
            <td>${o.status === 'PENDING' ? `<button class="action-btn danger" onclick="cancelOrder('${o.orderId}')">Batalkan</button>` : '-'}</td>
        </tr>
    `).join('');
}

// ── User modal ──
async function openUser(userId) {
    const res = await api('/api/admin/users');
    if (!res.success) return;
    currentUser = res.users.find(u => u.id === userId);
    if (!currentUser) return;

    document.getElementById('user-detail').innerHTML = `
        <strong>${currentUser.nama}</strong><br>
        📧 ${currentUser.email}<br>
        👑 Role: ${currentUser.role}<br>
        🔌 Status: ${currentUser.isActive !== false ? 'Aktif' : 'Nonaktif'}<br>
        💰 Saldo: ${formatRp(currentUser.balance)}<br>
        📱 WA: ${currentUser.noWa || '-'}
    `;
    document.getElementById('modal-user').classList.remove('hidden');
}

document.getElementById('close-user').addEventListener('click', () => {
    document.getElementById('modal-user').classList.add('hidden');
});

// Tambah/potong saldo
document.getElementById('btn-adjust').addEventListener('click', async () => {
    if (!currentUser) return;
    const amount = prompt('Nominal saldo (+ tambah / - potong):', '50000');
    if (amount === null) return;
    const reason = prompt('Alasan:', 'Penyesuaian admin') || 'Penyesuaian admin';
    const res = await api('/api/admin/users/adjust', {
        method: 'POST',
        body: JSON.stringify({ userId: currentUser.id, amount: Number(amount), reason }),
    });
    if (res.success) { alert('✅ Saldo diperbarui.'); closeModal(); loadAll(); }
    else alert('❌ ' + (res.error || 'Gagal.'));
});

// Aktif/nonaktif
document.getElementById('btn-toggle-active').addEventListener('click', async () => {
    if (!currentUser) return;
    const res = await api('/api/admin/users/update', {
        method: 'POST',
        body: JSON.stringify({ userId: currentUser.id, isActive: currentUser.isActive === false }),
    });
    if (res.success) { alert('✅ Status diperbarui.'); closeModal(); loadAll(); }
    else alert('❌ ' + (res.error || 'Gagal.'));
});

// Ubah role
document.getElementById('btn-toggle-role').addEventListener('click', async () => {
    if (!currentUser) return;
    const role = currentUser.role === 'admin' ? 'driver' : 'admin';
    const res = await api('/api/admin/users/update', {
        method: 'POST',
        body: JSON.stringify({ userId: currentUser.id, role }),
    });
    if (res.success) { alert('✅ Role diperbarui.'); closeModal(); loadAll(); }
    else alert('❌ ' + (res.error || 'Gagal.'));
});

// Reset password
document.getElementById('btn-reset-pw').addEventListener('click', async () => {
    if (!currentUser) return;
    const pw = prompt('Password baru (min 6 karakter):', '');
    if (!pw) return;
    const res = await api('/api/admin/users/update', {
        method: 'POST',
        body: JSON.stringify({ userId: currentUser.id, newPassword: pw }),
    });
    if (res.success) alert('✅ Password direset.');
    else alert('❌ ' + (res.error || 'Gagal.'));
});

function closeModal() {
    document.getElementById('modal-user').classList.add('hidden');
}

// Cancel order
async function cancelOrder(orderId) {
    if (!confirm('Batalkan order ini?')) return;
    const res = await api('/api/admin/orders/cancel', {
        method: 'POST',
        body: JSON.stringify({ orderId }),
    });
    if (res.success) { alert('✅ Order dibatalkan.'); loadOrders(); }
    else alert('❌ ' + (res.error || 'Gagal.'));
}

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});
