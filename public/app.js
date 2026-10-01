// ══════════════════════════════════════
// 🖥️ Dashboard Frontend Logic
// ══════════════════════════════════════

const API = '';

let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user') || 'null');

// ── View switching ──
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
    const res = await fetch(API + path, { ...opts, headers });
    return res.json();
}

// ── Auth flow ──
if (token && user) {
    showDashboard();
} else {
    showView('login');
}

document.getElementById('show-register').addEventListener('click', e => {
    e.preventDefault();
    setError('login-error', '');
    showView('register');
});
document.getElementById('show-login').addEventListener('click', e => {
    e.preventDefault();
    setError('reg-error', '');
    showView('login');
});

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    setError('login-error', '');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const res = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });

    if (!res.success) {
        return setError('login-error', res.error || 'Login gagal.');
    }

    token = res.token;
    user = res.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    showDashboard();
});

document.getElementById('register-form').addEventListener('submit', async e => {
    e.preventDefault();
    setError('reg-error', '');
    const nama = document.getElementById('reg-nama').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    const res = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ nama, email, password }),
    });

    if (!res.success) {
        return setError('reg-error', res.error || 'Registrasi gagal.');
    }

    setError('reg-error', '✅ Berhasil! Silakan login.');
    showView('login');
});

document.getElementById('logout-btn').addEventListener('click', () => {
    token = null;
    user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showView('login');
});

// ── Dashboard ──
function showDashboard() {
    showView('dashboard');
    document.getElementById('user-name').textContent = user?.nama || user?.email;
    if (user?.role === 'admin') {
        document.getElementById('admin-link').style.display = 'inline-block';
    }
    loadWallet();
}

async function loadWallet() {
    const res = await api('/api/wallet');
    if (!res.success) {
        if (res.error === 'Unauthorized') { localStorage.clear(); location.reload(); }
        return;
    }
    document.getElementById('balance').textContent = formatRp(res.balance);
    renderTransactions(res.transactions || []);
}

function renderTransactions(txs) {
    const el = document.getElementById('transactions');
    if (!txs.length) {
        el.innerHTML = '<p class="muted">Belum ada transaksi.</p>';
        return;
    }
    el.innerHTML = txs.map(t => {
        const cls = t.amount >= 0 ? 'tx-pos' : 'tx-neg';
        const sign = t.amount >= 0 ? '+' : '';
        const date = new Date(t.createdAt).toLocaleString('id-ID');
        return `<div class="tx-item">
            <div><strong>${t.description}</strong><br><span class="muted">${date}</span></div>
            <div class="${cls}">${sign}${formatRp(t.amount)}</div>
        </div>`;
    }).join('');
}

document.getElementById('refresh-balance').addEventListener('click', loadWallet);

// Nominal quick buttons
document.querySelectorAll('.nominal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('topup-amount').value = btn.dataset.amt;
    });
});

document.getElementById('topup-form').addEventListener('submit', async e => {
    e.preventDefault();
    setError('topup-error', '');
    const amount = Number(document.getElementById('topup-amount').value);

    if (!amount || amount < 5000) {
        return setError('topup-error', 'Nominal minimal Rp 5.000.');
    }

    const res = await api('/api/topup', {
        method: 'POST',
        body: JSON.stringify({ amount }),
    });

    if (!res.success) {
        return setError('topup-error', res.error || 'Gagal membuat pembayaran.');
    }

    openPayModal(res.data);
});

// ── Payment modal ──
let pollInterval = null;
let currentOrderId = null;

function openPayModal(order) {
    currentOrderId = order.orderId;
    document.getElementById('pay-amount').textContent = `Total bayar: ${formatRp(order.total)}`;
    document.getElementById('pay-qr').src = order.qrUrl;
    document.getElementById('pay-link').href = order.checkoutUrl;
    document.getElementById('pay-status').textContent = 'Menunggu pembayaran...';
    document.getElementById('modal-pay').classList.remove('hidden');
    startPolling();
}

function closePayModal() {
    document.getElementById('modal-pay').classList.add('hidden');
    stopPolling();
}

document.getElementById('close-pay').addEventListener('click', closePayModal);
document.getElementById('pay-done').addEventListener('click', async () => {
    await checkOnce();
    closePayModal();
    loadWallet();
});

function startPolling() {
    stopPolling();
    pollInterval = setInterval(checkOnce, 5000);
}

function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

async function checkOnce() {
    if (!currentOrderId) return;
    const res = await api('/api/topup/status?orderId=' + currentOrderId);
    if (res.success && res.order && res.order.status === 'PAID') {
        document.getElementById('pay-status').textContent = '✅ Pembayaran diterima! Saldo bertambah.';
        stopPolling();
        loadWallet();
    } else if (res.success && res.order && res.order.status === 'EXPIRED') {
        document.getElementById('pay-status').textContent = '❌ Pembayaran kedaluwarsa.';
        stopPolling();
    }
}
