# 🤖 AUTO-PETRIP BOT (SPX Form Automation Engine) v2.0

Aplikasi WhatsApp Bot pintar untuk mengotomatisasi pengisian Google Form K3 SPX secara berkala dengan fitur telemetri real-time, ringkasan Autobot bertenaga Natural Language Generation, penanganan pemulihan mandiri (*self-healing*), penjadwalan terintegrasi, serta **sistem akun & payment gateway (QRIS) untuk pengelolaan saldo driver**.

---

## ⚡ Fitur Utama
* **Virtual Live Telemetry Terminal UI**: Update status loading berjalan secara interaktif langsung di chat WhatsApp dengan *progress bar*, durasi pengerjaan, dan status check untuk setiap tahapan.
* **Autobot Summary Generator**: Menghasilkan ringkasan kondisi medis dan kesiapan berkendara sopir secara variatif menggunakan modul generator bahasa alami.
* **Manajemen Database Dinamis (CRUD)**: Kelola driver, jadwal libur, cookie, dan berkas screenshot reaksi langsung melalui perintah chat WhatsApp.
* **Self-Healing Engine**: Membersihkan sisa-sisa kegagalan browser/crash otomatis sebelum inisialisasi ulang agar penggunaan RAM VPS tetap aman.
* **Auto-alert Cookie Expired**: Memberikan peringatan instan ke driver bersangkutan dan administrator ketika sesi Google Account terputus.
* **Smart Robust Downloader & Typo Assistant**: Pengunduhan media otomatis yang mendukung pesan balasan (*reply*) serta pemetaan nama driver toleran salah ketik (*fuzzy match*).
* **🆕 Sistem Akun (Email + Password)**: Driver punya akun sendiri dengan login aman (hash password scrypt + token HMAC).
* **🆕 Payment Gateway QRIS (AutoGoPay)**: Top-up saldo via QRIS dinamis, auto-verifikasi pembayaran via webhook, dan pemotongan saldo otomatis per proses absen.
* **🆕 Web Dashboard**: Halaman login, cek saldo, top-up, dan riwayat transaksi yang responsif (mobile & desktop).
* **🆕 Cadangan Otomatis & Pindah VPS Sekali Jalan**: Data user, saldo, driver, cookie, dan foto dibungkus jadi satu arsip yang dikirim ke WhatsApp — harian, setiap saldo masuk, dan sebelum setiap pemulihan. Pindah VPS cukup `install.sh --restore`.
* **🆕 Installer Serba-Otomatis**: Satu perintah memasang paket sistem, Node.js 20, Chrome, swap 4 GB, PM2 + log rotate, auto-start saat reboot, lalu memverifikasi hasilnya.

---

## 📋 Persyaratan Sistem
* **VPS/Server**: Linux Ubuntu (direkomendasikan) / Debian / Ubuntu
* **Node.js**: Versi `18.x` atau lebih baru
* **NPM**: Versi `9.x` atau lebih baru
* **Git**: Terpasang di VPS

---

## 🚀 Panduan Instalasi & Konfigurasi di VPS

### 1. Kloning Repositori
Masuk ke VPS Anda melalui SSH, lalu kloning proyek ini:
```bash
git clone https://github.com/ajiputra001/auto-petrip-bot.git
cd auto-petrip-bot
```

### 2. Jalankan Skrip Instalasi Otomatis (Direkomendasikan)
Satu perintah menyiapkan VPS dari nol. Mendukung **Debian 11, 12, 13** dan **Ubuntu 20, 22, 24**.

```bash
sudo bash install.sh
```

Yang dikerjakan skrip secara otomatis:

| Tahap | Rincian |
| --- | --- |
| 🔍 Periksa sistem | Deteksi OS, RAM, disk & arsitektur; berhenti lebih awal bila tidak didukung |
| 📦 Paket sistem | `curl`, `git`, `tar`, plus seluruh pustaka Chromium headless (nama paket ALSA menyesuaikan rilis) |
| 🧠 Swap 4 GB | Dibuat & dipasang permanen di `/etc/fstab` dengan `swappiness=10`, mencegah bot dimatikan OOM killer saat Chrome berjalan |
| 🟢 Node.js 20 LTS | Dipasang bila belum ada atau versinya di bawah 18 |
| 📂 Folder & `.env` | Membuat `data`, `cookies`, `screenshots`, `sessions`, `logs`, `backups`; menyalin `.env` dari contoh dengan `JWT_SECRET` acak |
| ⬇️ Dependensi | `npm ci` + Chrome untuk Puppeteer, dijalankan sebagai pemilik proyek (bukan root) |
| 🔄 PM2 | PM2 + `pm2-logrotate` (maks 10 MB, simpan 7 hari, dikompres) + auto-start saat VPS reboot |
| ♻️ Pemulihan data | Opsional, lewat `--restore` |
| ✅ Verifikasi | Memeriksa Node, npm, PM2, `.env`, sintaks `index.js` & pemuatan modul; menampilkan ringkasan peringatan |

Opsi yang tersedia:
```bash
sudo bash install.sh                 # pemasangan normal (swap 4 GB)
sudo bash install.sh --swap 2        # ukuran swap khusus (GB)
sudo bash install.sh --no-swap       # lewati pembuatan swap
sudo bash install.sh --restore backup_autopetrip_20261015_220000.tar.gz
sudo bash install.sh --help
```

*(Atau jika Anda ingin melakukan instalasi secara manual, silakan ikuti langkah di bawah ini).*

### 3. Instalasi Manual (Opsional)
Pasang library Node.js yang dibutuhkan:
```bash
npm install
```

Karena bot ini menggunakan headless browser Puppeteer (Google Chrome), pasang dependensi sistem operasi Linux agar browser Chrome bisa diluncurkan dengan sukses:
```bash
# Update package list
sudo apt update

# Pasang dependensi Chrome di VPS Ubuntu/Debian
sudo apt install -y libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 \
libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation \
libnss3 lsb-release xdg-utils wget libgbm-dev
```
*(Catatan: Untuk Ubuntu 24.04 dan Debian 13, ganti `libasound2` dengan `libasound2t64` jika terjadi kesalahan paket tidak ditemukan).*

Pastikan juga cache binary Chrome untuk Puppeteer terpasang:
```bash
npx puppeteer browsers install chrome
```

### 4. Konfigurasi Environment (`.env`)
Salin file template `.env.example` ke `.env`:
```bash
cp .env.example .env
```

Edit file `.env` menggunakan editor teks (misal `nano`):
```bash
nano .env
```
Isi variabel yang ada sesuai dengan kebutuhan Anda:
```env
# WhatsApp
WA_ADMIN=6285xxxxx2x5@c.us            # ID WhatsApp Administrator
WA_GRUP=12xxxxxxx0557@g.us            # JID Grup WhatsApp Laporan
FORM_URL=https://docs.google.com/forms/... # Link Google Form SPX utama
CRON_SCHEDULE=0 8 * * *               # Jadwal absen otomatis (jam 08:00)
CRON_TIMEZONE=Asia/Jakarta            # Zona waktu cron

# Web Dashboard
WEB_PORT=3000                         # Port dashboard (0 = nonaktif)
PUBLIC_BASE_URL=http://IP-VPS:3000    # URL publik (untuk webhook harus HTTPS)
JWT_SECRET=ganti-dengan-string-acak   # Secret token login

# Payment Gateway AutoGoPay
AUTOGOPAY_API_KEY=agp_API_KEY_KAMU    # API key dari https://autogopay.site
TOPUP_MIN=10000                       # Minimal top-up
TOPUP_MAX=10000000                    # Maksimal top-up
TOPUP_FEE_PERCENT=0                   # Biaya admin (%) — 0 = gratis
PRICE_PER_ABSEN=0                     # Harga per 1x pengisian form (0 = gratis)
```
*Simpan perubahan dengan `CTRL+O`, `Enter`, lalu `CTRL+X`.*

### 5. Konfigurasi Payment Gateway (AutoGoPay)
1. Daftar gratis di [AutoGoPay](https://autogopay.site/register).
2. Dapatkan **API Key** dari dashboard AutoGoPay.
3. Set **Callback URL** di dashboard ke: `https://IP-VPS-ANDA:3000/api/webhook/payment`.
   > ⚠️ Untuk webhook production, wajib HTTPS (bisa pakai reverse proxy Nginx + Let's Encrypt, atau tunnel).
4. Masukkan API Key ke `.env` pada `AUTOGOPAY_API_KEY`.

### 6. Mengonfigurasi Data Driver (`data/`)
Agar bot mengetahui daftar driver yang harus diabsenkan, buat/sesuaikan file konfigurasi data driver di folder `data/`:

* **`data/database_driver.json`**
  ```json
  [
      {
          "nama": "Randi",
          "id": "2xxx04",
          "usia": "31",
          "reaksi": "268",
          "fileCookie": "cookie_randi.json",
          "fileSS": "ss_randi.jpg",
          "noWa": "6285xxxxxxxx@c.us"
      }
  ]
  ```
  *Keterangan:*
  - `fileCookie`: Letakkan file JSON cookie driver di folder `cookies/cookie_randi.json`
  - `fileSS`: Letakkan screenshot reaksi driver di folder `screenshots/ss_randi.jpg`
  - `noWa`: Nomor WhatsApp driver (dipakai untuk mengaitkan akun/saldo)

* **`data/jadwal_libur.json`**
  ```json
  { "Randi": "-" }
  ```
  *(Isi `-` jika masuk penuh, atau isi nama hari seperti `Minggu` jika diliburkan).*

---

## 🏃 Cara Menjalankan Bot

### Mode Pengembangan (Development)
```bash
npm run dev
```

### Mode Produksi di Background (VPS Terus Aktif)
1. Pasang PM2:
   ```bash
   sudo npm install -g pm2
   ```
2. Jalankan bot (pakai ecosystem agar anti-crash + kontrol memory):
   ```bash
   npm run pm2:start:prod
   ```
3. Aktifkan log rotation PM2 agar log tidak bengkak di VPS:
   ```bash
   npm run pm2:logrotate:install
   npm run pm2:logrotate:setup
   ```
4. Auto-restart saat reboot:
   ```bash
   pm2 startup
   npm run pm2:save
   ```
5. Perintah PM2 berguna:
   * `pm2 status` — status bot
   * `pm2 logs auto-petrip-bot` — log real-time
   * `pm2 restart auto-petrip-bot` — restart bot
   * `pm2 stop auto-petrip-bot` — hentikan bot
   * `npm run pm2:flush` — bersihkan log PM2 saat darurat

> Rekomendasi production: gunakan konfigurasi default `ecosystem.config.js` (sudah berisi `max_memory_restart`, backoff restart, dan rotasi log PM2 lokal). Dengan ini bot jauh lebih stabil untuk jangka panjang di VPS.

---

## 💬 Perintah WhatsApp (Command List)

### Manajemen Worker
| Perintah | Deskripsi |
| --- | --- |
| `/menu` | Menu pusat bantuan |
| `/status` | Status sistem & diagnostik |
| `/tambahdriver [Nama]#[ID]#[Usia]#[Reaksi]` | Tambah driver |
| `/editdriver [Nama]#[Kolom]#[Nilai]` | Edit data driver |
| `/hapusdriver [Nama]` | Hapus driver (khusus admin, minta konfirmasi, cookie & foto ikut dibersihkan) |
| `/listdriver` | Daftar driver & kesiapan data |

### Media & Jadwal
| Perintah | Deskripsi |
| --- | --- |
| `/updatefoto [Nama]` | Update screenshot reaksi (+ gambar) |
| `/updatecookie [Nama]` | Update cookie session (+ JSON) |
| `/setlibur [Nama] [Hari]` | Set hari libur driver |
| `/setmasuk [Nama]` | Kembalikan driver aktif |
| `/ceklibur` | Cek jadwal libur semua driver |

### Control System
| Perintah | Deskripsi |
| --- | --- |
| `/absen [Nama]` | Absen paksa driver tertentu |
| `/absenmanual` | Absen semua driver |

### 🛡️ Admin Override (khusus admin)

**Cara masuk sebagai admin:**

Hak admin menempel pada *akun*, bukan pada nomor WhatsApp. Jadi nomor Anda harus login dulu ke akun yang ber-role `admin`:

```
/login admin@gmail.com [password]
```

Akun admin dibuat otomatis saat bot pertama kali hidup, memakai `ADMIN_EMAIL` dan `ADMIN_PASSWORD` dari `.env` (default: `admin@autopetrip.id` / `admin12345`). Lupa password? Hentikan bot, lalu set `ADMIN_PASSWORD` baru di `.env` — **tapi** akun admin yang sudah ada tidak akan ikut berubah, karena bot hanya membuatnya bila belum ada admin sama sekali. Reset lewat admin lain dengan `/adminreset`.

Cek apakah login sudah berhasil dengan `/saldo`. Kalau muncul "BELUM LOGIN", berarti sesi WhatsApp Anda belum tertaut ke akun mana pun.

> ⚠️ Satu sesi login berlaku per nomor WhatsApp. Kalau Anda ganti nomor atau bot dipindah ke VPS baru tanpa membawa `data/database_session.json`, Anda perlu `/login` ulang.

> 🎛️ **Cukup ketik `/admin` satu kali.** Setelah itu semua aksi dilakukan dengan membalas angka atau menekan tombol — tidak perlu menghafal satu pun perintah. Daftar user & driver ditampilkan bernomor, tinggal pilih.

```
🛡️ PANEL ADMIN
 1️⃣ 👥 Kelola User & Akun    → lihat/aktifkan/nonaktifkan/reset password/jadikan admin/tautkan driver
 2️⃣ 💰 Saldo & Transaksi    → lihat saldo, tambah/potong saldo, daftar order
 3️⃣ 🚀 Absen Override       → absenkan 1 driver (bayar/gratis) atau semua driver
 4️⃣ ⚙️ Form & Sistem        → lihat/ganti/reset link form, status server, jadwal libur
 5️⃣ 📊 Statistik Sistem
 0️⃣ ❌ Keluar
```

Setiap aksi berisiko (nonaktifkan akun, ubah saldo, jadikan admin, absen massal) selalu meminta **konfirmasi tombol ✅ Ya / ❌ Batal** terlebih dahulu.

Perintah manual tetap tersedia bila diperlukan:

| Perintah | Deskripsi |
| --- | --- |
| `/admin` | Buka panel admin interaktif |
| `/listuser` | Daftar semua user & saldo |
| `/aktifkan [email]` / `/nonaktifkan [email]` | Kelola status akun |
| `/setadmin [email]` | Jadikan user sebagai admin |
| `/adminreset [email] [pass]` | Reset password user |
| `/adjust [email] [nominal]` | Tambah/potong saldo **satu** user |
| `/adjustsemua [nominal]` | Tambah/potong saldo **banyak user sekaligus** |
| `/adjustsemua [nominal] 1,3` · `2-5` | Pilih penerima berdasarkan nomor daftar |
| `/hapusakun [email]` | Hapus akun user permanen (saldo & sesi ikut dibersihkan) |
| `/orderlist` · `/adminstat` | Order top-up & statistik sistem |
| `/setform [link]` · `/getform` · `/resetform` | Kelola link Google Form |
| `/absenkan [Nama\|email]` | **Absen manual atas nama driver mana pun** |
| `/absenkan [Nama] gratis` | Absen tanpa memotong saldo driver |
| `/absenkansemua` | Absen semua driver tanpa potong saldo |
| `/linkdriveruser [email] [Nama Driver]` | Tautkan akun user ke driver |
| `/backup` | Cadangkan seluruh data & kirim berkasnya ke WhatsApp |
| `/listbackup` | Daftar arsip cadangan yang tersimpan di VPS |
| `/restore` | Pulihkan data (lampirkan berkas cadangan) |

> Catatan tombol: WhatsApp membatasi tombol interaktif (maks. 3 per pesan, dan dukungannya bergantung versi WhatsApp). Karena itu panel memakai **navigasi angka** sebagai mekanisme utama yang selalu jalan, dengan tombol asli dipakai pada layar konfirmasi. Bila tombol tidak muncul di perangkat Anda, sistem otomatis menampilkan versi teks bernomor — fungsinya identik.

> Gunakan `/absenkan` bila akun driver bermasalah/error: admin tetap bisa menjalankan absen atas nama driver tersebut. Tambahkan kata `gratis` agar saldo driver tidak terpotong saat proses penanganan error.

### 🆕 Akun & Saldo (Payment)
| Perintah | Deskripsi |
| --- | --- |
| `/daftar [email] [password] [nama]` | Buat akun baru (auto login) |
| `/login [email] [password]` | Login ke akun |
| `/logout` | Logout dari akun |
| `/saldo` | Cek saldo akun |
| `/topup [nominal]` | Buat QRIS top-up saldo |
| `/riwayat` | Riwayat transaksi |
| `/linkakun` | Link dashboard web |

---

## 🔐 Alur Kerja Sistem Saldo (Payment)

```
Driver daftar akun (email+password)  →  Top-up saldo (QRIS AutoGoPay)
        │                                        │
        ▼                                        ▼
   Akun tersimpan                       Webhook "transaction.received"
   (scrypt + token HMAC)                → verifikasi signature HMAC-SHA256
        │                                        │
        ▼                                        ▼
   Login via WA/Web                    Saldo otomatis bertambah
                                            │
                                            ▼
   Driver jalankan /absen  →  Sistem cek saldo → cukup? → potong saldo → isi form
                                            │
                                            └─ tidak cukup → batalkan + notif topup
```

> **Catatan**: Cookie Google Form tetap digunakan untuk otentikasi pengisian form sebagai driver. Sistem akun (email+password) adalah lapisan baru untuk mengelola *akses bot* dan *saldo*, bukan menggantikan cookie Google.

---

## 💾 Cadangan Data & Pindah VPS

Ganti VPS tidak lagi berarti mendaftar ulang user dan mengisi ulang saldo satu per satu. Seluruh data penting dibungkus jadi satu berkas `.tar.gz` yang dikirim lewat WhatsApp.

**Isi arsip:**

| Bagian | Keterangan |
| --- | --- |
| `data/*.json` | Akun user, saldo & mutasi, driver, jadwal libur |
| `cookies/` | Token sesi Google tiap driver |
| `screenshots/` | Foto reaction time milik driver |

> Sesi WhatsApp (`.wwebjs_auth`) **sengaja tidak ikut**: ukurannya besar dan dua VPS yang memakai sesi sama akan saling memutus koneksi. Setelah pindah, cukup pindai ulang QR satu kali.

**Kapan cadangan dibuat:**
* **Harian** — otomatis dikirim ke WhatsApp admin (default pukul 22:00, atur lewat `BACKUP_SCHEDULE`).
* **Setiap saldo masuk** — top-up, bonus, dan penyesuaian saldo memicu cadangan lokal. Transaksi beruntun digabung jadi satu arsip agar tidak memberatkan disk.
* **Manual** — kapan saja lewat `/backup`.
* **Sebelum restore** — kondisi lama selalu diamankan dulu, jadi arsip yang salah unggah tidak membuat data hilang.

Arsip tersimpan di `backups/` (maksimal 10 arsip terbaru, sisanya dibuang otomatis).

**Langkah pindah VPS:**

```bash
# 1. Di VPS lama — lewat WhatsApp
/backup                       # simpan berkas yang dikirim bot

# 2. Di VPS baru
git clone https://github.com/ajiputra001/auto-petrip-bot.git
cd auto-petrip-bot
sudo bash install.sh --restore /path/backup_autopetrip_20261015_220000.tar.gz

# 3. Jalankan & pindai ulang QR
pm2 start ecosystem.config.js --env production
pm2 logs auto-petrip-bot
pm2 save
```

Alternatifnya, pulihkan langsung lewat WhatsApp: ketik `/restore` sambil melampirkan berkas cadangan, bot menampilkan isinya (jumlah user, driver, total saldo), lalu balas `/restore ya` untuk mengonfirmasi. Jangan lupa `pm2 restart auto-petrip-bot` setelahnya.

Matikan cadangan otomatis dengan `BACKUP_ENABLED=false` di `.env`.

---

## 📌 Catatan & Disclaimer
* **Disclaimer:** Harap untuk mengecek email hasil laporan setiap hari. Tidak ada paksaan untuk menggunakan project autobot ini. Robot ini diciptakan hanya untuk meringankan pekerjaan para pengguna sehari-hari. **Ingat! Karena ini robot, bisa saja sewaktu-waktu membuat kesalahan/error.**
* Pastikan file JSON cookie berformat standar Netscape/Chrome JSON Array dan berstatus aktif.
* **Keamanan**: Ganti `JWT_SECRET` dengan string acak panjang. Jangan bagikan `AUTOGOPAY_API_KEY` ke siapapun.
