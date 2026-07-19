# 🤖 AUTO-PETRIP BOT (SPX Form Automation Engine) v1.0

Aplikasi WhatsApp Bot pintar untuk mengotomatisasi pengisian Google Form K3 SPX secara berkala dengan fitur telemetri real-time, ringkasan Autobot bertenaga Natural Language Generation, penanganan pemulihan mandiri (*self-healing*), dan penjadwalan terintegrasi.

---

## ⚡ Fitur Utama
* **Virtual Live Telemetry Terminal UI**: Update status loading berjalan secara interaktif langsung di chat WhatsApp dengan *progress bar*, durasi pengerjaan, dan status check untuk setiap tahapan.
* **Autobot Summary Generator**: Menghasilkan ringkasan kondisi medis dan kesiapan berkendara sopir secara variatif menggunakan modul generator bahasa alami.
* **Manajemen Database Dinamis (CRUD)**: Kelola driver, jadwal libur, cookie, dan berkas screenshot master langsung melalui perintah chat WhatsApp.
* **Self-Healing Engine**: Membersihkan sisa-sisa kegagalan browser/crash otomatis sebelum inisialisasi ulang agar penggunaan RAM VPS tetap aman.
* **Auto-alert Cookie Expired**: Memberikan peringatan instan ke driver bersangkutan dan administrator ketika sesi Google Account terputus.

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

### 2. Pasang Dependensi Node.js & Linux
Pasang library Node.js yang dibutuhkan:
```bash
npm install
```

Karena bot ini menggunakan headless browser Puppeteer (Google Chrome), pasang dependensi sistem operasi Linux agar browser Chrome bisa diluncurkan dengan sukses:
```bash
# Update package list
sudo apt update

# Pasang dependensi Chrome di VPS Ubuntu/Debian
sudo apt install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 \
libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation \
libappindicator1 libnss3 lsb-release xdg-utils wget libgbm-dev
```

Pastikan juga cache binary Chrome untuk Puppeteer terpasang:
```bash
npx puppeteer folders install chrome
```

### 3. Konfigurasi Environment (`.env`)
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
WA_ADMIN=6285xxxxx2x5@c.us              # ID WhatsApp Administrator
WA_GRUP=12xxxxxxx0557@g.us          # JID Grup WhatsApp Laporan
FORM_URL=https://docs.google.com/forms/... # Link Google Form SPX utama
CRON_SCHEDULE=0 8 * * *                  # Jadwal absen otomatis (Setiap jam 08:00 Pagi)
CRON_TIMEZONE=Asia/Jakarta               # Zona waktu cron scheduler
```
*Simpan perubahan dengan menekan `CTRL+O`, `Enter`, lalu keluar dengan `CTRL+X`.*

### 4. Mengonfigurasi Data Driver (`data/`)
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
  - `fileSS`: Letakkan screenshot master driver di folder `screenshots/ss_randi.jpg`

* **`data/jadwal_libur.json`**
  ```json
  {
      "Randi": "-"
  }
  ```
  *(Isi `-` jika masuk penuh, atau isi nama hari seperti `Minggu` jika diliburkan).*

---

## 🏃 Cara Menjalankan Bot

### Mode Pengembangan (Development)
Untuk memantau log secara langsung di terminal:
```bash
npm run dev
```

### Mode Produksi di Background (VPS Terus Aktif)
Agar bot tetap berjalan di VPS meskipun sesi SSH Anda ditutup, gunakan manajer proses **PM2**:

1. Pasang PM2 secara global:
   ```bash
   sudo npm install -g pm2
   ```
2. Jalankan bot dengan PM2:
   ```bash
   pm2 start index.js --name "autobot"
   ```
3. Setelan PM2 agar otomatis menyala saat VPS restart:
   ```bash
   pm2 startup
   pm2 save
   ```
4. Perintah PM2 berguna lainnya:
   * **Melihat status bot**: `pm2 status`
   * **Melihat log real-time**: `pm2 logs autobot`
   * **Merestart bot**: `pm2 restart autobot`
   * **Menghentikan bot**: `pm2 stop autobot`

---

## 💬 Perintah WhatsApp (Command List)

Kirimkan perintah-perintah berikut ke nomor WhatsApp bot:

| Perintah | Deskripsi | Contoh |
| --- | --- | --- |
| `/menu` | Menampilkan menu pusat bantuan & instruksi | `/menu` |
| `/status` | Menampilkan status sistem, diagnostik VPS, & RAM | `/status` |
| `/absen [Nama]` | Menjalankan absen paksa untuk driver tertentu | `/absen Randi` |
| `/absenmanual` | Menjalankan absen untuk semua driver yang terdaftar | `/absenmanual` |
| `/updatefoto [Nama]` | Memperbarui berkas screenshot master harian *(lampirkan foto)* | `/updatefoto Randi` (+ gambar) |
| `/updatecookie [Nama]` | Memperbarui file cookie session Google *(lampirkan JSON)* | `/updatecookie Randi` (+ file/teks JSON) |
| `/libur [Nama] [Hari]` | Mengubah hari libur mingguan driver | `/libur Randi Minggu` |
| `/masuk [Nama]` | Mengembalikan status driver kembali aktif bekerja penuh | `/masuk Randi` |

---

## 📌 Catatan & Disclaimer
* **Disclaimer:** Harap untuk mengecek email hasil laporan setiap hari. Tidak ada paksaan untuk menggunakan project autobot ini. Robot ini diciptakan hanya untuk meringankan pekerjaan para pengguna sehari-hari. **Ingat! Karena ini robot, bisa saja sewaktu-waktu membuat kesalahan/error.**
* Pastikan file JSON cookie berformat standar Netscape/Chrome JSON Array dan berstatus aktif.
