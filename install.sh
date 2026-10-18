#!/usr/bin/env bash
#
# ==============================================================================
# 🚀 AUTO-PETRIP BOT — PEMASANG OTOMATIS VPS
# ==============================================================================
# Satu perintah untuk menyiapkan VPS dari nol:
#   • Paket sistem & pustaka Chromium headless
#   • Node.js 20 LTS + dependensi proyek + Chrome untuk Puppeteer
#   • Swap 4 GB (mencegah bot mati kehabisan RAM saat buka browser)
#   • PM2 + log rotate + auto-start saat VPS reboot
#   • Berkas .env, folder kerja, dan pemulihan data dari cadangan
#
# Pemakaian:
#   sudo bash install.sh                 pemasangan normal
#   sudo bash install.sh --no-swap       lewati pembuatan swap
#   sudo bash install.sh --swap 2        buat swap 2 GB
#   sudo bash install.sh --restore FILE  pulihkan data dari arsip cadangan
#   sudo bash install.sh --help          tampilkan bantuan
# ==============================================================================

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

SWAP_SIZE_GB=4
BUAT_SWAP=true
ARSIP_RESTORE=""
TOTAL_TAHAP=9
TAHAP=0

PERINGATAN=()

info()    { echo -e "${CYAN}   •${NC} $*"; }
sukses()  { echo -e "${GREEN}   ✔${NC} $*"; }
ingat()   { echo -e "${YELLOW}   ⚠${NC} $*"; PERINGATAN+=("$*"); }
galat()   { echo -e "${RED}   ✘${NC} $*"; }

tahap() {
    TAHAP=$((TAHAP + 1))
    echo -e "\n${BLUE}${BOLD}[${TAHAP}/${TOTAL_TAHAP}] $*${NC}"
}

mati() {
    echo -e "\n${RED}${BOLD}✘ GAGAL:${NC} $*\n"
    exit 1
}

bantuan() {
    sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

# ── Argumen ───────────────────────────────────────────────────────────────────
# Catatan: `shift 2` gagal diam-diam bila hanya tersisa satu argumen, dan
# perulangan jadi tak berujung. Karena itu nilai opsi selalu diperiksa dulu.
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-swap)
            BUAT_SWAP=false; shift ;;
        --swap)
            [ $# -ge 2 ] || mati "Opsi --swap butuh ukuran dalam GB. Contoh: --swap 2"
            SWAP_SIZE_GB="$2"
            [[ "$SWAP_SIZE_GB" =~ ^[0-9]+$ ]] \
                || mati "Ukuran swap harus angka bulat (GB), bukan \"$SWAP_SIZE_GB\"."
            [ "$SWAP_SIZE_GB" -eq 0 ] && BUAT_SWAP=false
            shift 2 ;;
        --restore)
            [ $# -ge 2 ] || mati "Opsi --restore butuh lokasi berkas cadangan."
            ARSIP_RESTORE="$2"; shift 2 ;;
        -h|--help)
            bantuan ;;
        *)
            echo -e "${YELLOW}Argumen tidak dikenal: $1${NC}"; shift ;;
    esac
done

clear 2>/dev/null || true
echo -e "${BLUE}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║      🤖  AUTO-PETRIP BOT — PEMASANG OTOMATIS VPS      ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Root ──────────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        echo -e "${YELLOW}[!] Menjalankan ulang dengan sudo...${NC}"
        exec sudo -E bash "$0" "$@"
    fi
    mati "Skrip ini butuh akses root. Jalankan: sudo bash install.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || mati "Tidak bisa masuk ke folder proyek."

# User pemilik proyek: hindari menjalankan bot sebagai root bila memungkinkan.
APP_USER="${SUDO_USER:-root}"
[ -z "$APP_USER" ] && APP_USER="root"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
[ -z "$APP_HOME" ] && APP_HOME="/root"

# Jalankan perintah sebagai pemilik proyek (bukan root) bila relevan.
# `env` dipakai eksplisit supaya HOME benar-benar sampai ke proses anak:
# tanpa itu, npm & pm2 menulis cache/konfigurasi ke /root dan berkasnya
# jadi tak terbaca oleh user biasa saat bot dijalankan.
sebagai_user() {
    if [ "$APP_USER" != "root" ]; then
        sudo -u "$APP_USER" env HOME="$APP_HOME" PATH="$PATH" "$@"
    else
        env HOME="$APP_HOME" "$@"
    fi
}

# ══════════════════════════════════════════════════════════════════════════════
tahap "Memeriksa sistem"
# ══════════════════════════════════════════════════════════════════════════════

[ -f /etc/os-release ] || mati "/etc/os-release tidak ada. Hanya mendukung Debian/Ubuntu."
. /etc/os-release
OS_ID="${ID:-}"; OS_NAME="${NAME:-Linux}"; OS_VERSION="${VERSION_ID:-?}"

DIDUKUNG=false
[[ "$OS_ID" == "ubuntu" || "$OS_ID" == "debian" ]] && DIDUKUNG=true
if [ "$DIDUKUNG" = false ] && [ -n "${ID_LIKE:-}" ]; then
    for like in $ID_LIKE; do
        if [[ "$like" == "ubuntu" || "$like" == "debian" ]]; then DIDUKUNG=true; break; fi
    done
fi
[ "$DIDUKUNG" = true ] || mati "OS ${OS_NAME} tidak didukung (hanya Debian/Ubuntu)."

RAM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
DISK_FREE_GB=$(df -BG --output=avail "$SCRIPT_DIR" | tail -1 | tr -dc '0-9')
ARCH=$(uname -m)

sukses "OS      : ${OS_NAME} ${OS_VERSION} (${ARCH})"
sukses "RAM     : ${RAM_MB} MB"
sukses "Disk    : ${DISK_FREE_GB} GB tersedia"
sukses "User    : ${APP_USER}"
sukses "Proyek  : ${SCRIPT_DIR}"

[ "$DISK_FREE_GB" -lt 5 ] && ingat "Disk tersisa ${DISK_FREE_GB} GB — Chrome + swap butuh ±5 GB."

if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "aarch64" ]; then
    ingat "Arsitektur ${ARCH} tidak lazim; Chrome untuk Puppeteer mungkin gagal dipasang."
fi

# ══════════════════════════════════════════════════════════════════════════════
tahap "Memasang paket sistem"
# ══════════════════════════════════════════════════════════════════════════════

export DEBIAN_FRONTEND=noninteractive

info "Memperbarui indeks paket..."
apt-get update -y -qq || ingat "apt-get update tidak mulus; melanjutkan."

info "Memasang alat dasar..."
apt-get install -y -qq curl git wget ca-certificates gnupg lsb-release \
    tar gzip procps >/dev/null 2>&1 || mati "Gagal memasang alat dasar."
sukses "Alat dasar siap (curl, git, tar, gzip)."

# Nama paket ALSA berbeda antar rilis (libasound2 vs libasound2t64).
PAKET_AUDIO="libasound2"
apt-cache show libasound2t64 >/dev/null 2>&1 && PAKET_AUDIO="libasound2t64"

info "Memasang pustaka Chromium headless (${PAKET_AUDIO})..."
apt-get install -y -qq \
    fonts-liberation "$PAKET_AUDIO" libatk-bridge2.0-0 libatk1.0-0 libc6 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libexpat1 libfontconfig1 \
    libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxkbcommon0 libxrandr2 libxrender1 libxss1 libxtst6 xdg-utils \
    >/dev/null 2>&1 || ingat "Sebagian pustaka Chromium gagal dipasang."
sukses "Pustaka Chromium headless terpasang."

# Layar virtual untuk /logindriver: Google menolak login dari Chrome headless,
# jadi sesi login memakai Chrome berlayar di atas Xvfb.
info "Memasang layar virtual Xvfb (untuk /logindriver)..."
apt-get install -y -qq xvfb xauth xdotool ffmpeg fonts-noto-color-emoji >/dev/null 2>&1 \
    || ingat "Xvfb/xdotool/ffmpeg gagal dipasang — /logindriver tidak akan berfungsi."
command -v Xvfb >/dev/null 2>&1 && command -v xdotool >/dev/null 2>&1 \
    && command -v ffmpeg >/dev/null 2>&1 && sukses "Xvfb, xdotool & ffmpeg siap."

# ══════════════════════════════════════════════════════════════════════════════
tahap "Menyiapkan swap ${SWAP_SIZE_GB} GB"
# ══════════════════════════════════════════════════════════════════════════════
# Chrome headless mudah menghabiskan RAM VPS kecil. Tanpa swap, kernel
# mematikan proses bot (OOM killer) di tengah absen.

if [ "$BUAT_SWAP" = false ]; then
    info "Dilewati (--no-swap)."
elif [ -f /.dockerenv ] || grep -qa 'container=lxc' /proc/1/environ 2>/dev/null; then
    ingat "Terdeteksi container — swap tidak bisa dibuat dari dalam. Dilewati."
else
    SWAP_AKTIF_MB=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)

    if [ "$SWAP_AKTIF_MB" -ge 1024 ]; then
        sukses "Swap sudah aktif: ${SWAP_AKTIF_MB} MB — tidak diubah."
    elif [ "$DISK_FREE_GB" -lt $((SWAP_SIZE_GB + 3)) ]; then
        ingat "Disk tidak cukup untuk swap ${SWAP_SIZE_GB} GB. Dilewati."
    else
        BERKAS_SWAP="/swapfile"

        if [ -f "$BERKAS_SWAP" ]; then
            info "Mematikan swapfile lama..."
            swapoff "$BERKAS_SWAP" 2>/dev/null || true
            rm -f "$BERKAS_SWAP"
        fi

        info "Membuat ${BERKAS_SWAP} sebesar ${SWAP_SIZE_GB} GB..."
        if ! fallocate -l "${SWAP_SIZE_GB}G" "$BERKAS_SWAP" 2>/dev/null; then
            info "fallocate tidak tersedia, memakai dd (lebih lambat)..."
            dd if=/dev/zero of="$BERKAS_SWAP" bs=1M count=$((SWAP_SIZE_GB * 1024)) \
                status=none 2>/dev/null || ingat "Gagal mengalokasikan swapfile."
        fi

        if [ -f "$BERKAS_SWAP" ]; then
            chmod 600 "$BERKAS_SWAP"
            if mkswap "$BERKAS_SWAP" >/dev/null 2>&1 && swapon "$BERKAS_SWAP" 2>/dev/null; then
                # Pasang permanen agar swap tetap ada setelah reboot.
                if ! grep -q "^${BERKAS_SWAP}" /etc/fstab 2>/dev/null; then
                    echo "${BERKAS_SWAP} none swap sw 0 0" >> /etc/fstab
                fi
                # Pakai swap hanya saat RAM benar-benar menipis supaya tetap gesit.
                sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
                grep -q '^vm.swappiness' /etc/sysctl.conf 2>/dev/null \
                    || echo 'vm.swappiness=10' >> /etc/sysctl.conf
                sukses "Swap ${SWAP_SIZE_GB} GB aktif & permanen (swappiness=10)."
            else
                rm -f "$BERKAS_SWAP"
                ingat "Gagal mengaktifkan swap (VPS mungkin melarangnya)."
            fi
        fi
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
tahap "Memasang Node.js"
# ══════════════════════════════════════════════════════════════════════════════

PASANG_NODE=true
if command -v node >/dev/null 2>&1; then
    NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then
        sukses "Node.js $(node -v) sudah memenuhi syarat."
        PASANG_NODE=false
    else
        ingat "Node.js $(node -v) terlalu lama (butuh ≥18). Akan diperbarui."
    fi
fi

if [ "$PASANG_NODE" = true ]; then
    info "Memasang Node.js 20 LTS dari NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 \
        || mati "Gagal mengambil repositori NodeSource (cek koneksi internet)."
    apt-get install -y -qq nodejs >/dev/null 2>&1 || mati "Gagal memasang Node.js."
    sukses "Node.js $(node -v) terpasang."
fi

command -v npm >/dev/null 2>&1 || mati "npm tidak ditemukan setelah instalasi Node.js."

# ══════════════════════════════════════════════════════════════════════════════
tahap "Menyiapkan folder & konfigurasi"
# ══════════════════════════════════════════════════════════════════════════════

for d in data cookies screenshots sessions logs backups; do
    mkdir -p "$SCRIPT_DIR/$d"
done
sukses "Folder kerja siap (data, cookies, screenshots, sessions, logs, backups)."

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    if [ -f "$SCRIPT_DIR/.env.example" ]; then
        cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
        # Acak rahasia JWT supaya tiap VPS tidak memakai nilai contoh yang sama.
        RAHASIA=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)
        sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${RAHASIA}|" "$SCRIPT_DIR/.env" 2>/dev/null || true
        sukses "Berkas .env dibuat dari contoh (JWT_SECRET diacak)."
        ingat "WAJIB sesuaikan .env — terutama FORM_URL dan WA_GRUP."
    else
        ingat ".env dan .env.example tidak ada — bot mungkin gagal start."
    fi
else
    sukses "Berkas .env sudah ada — tidak ditimpa."
fi

chmod 600 "$SCRIPT_DIR/.env" 2>/dev/null || true
chown -R "$APP_USER":"$APP_USER" "$SCRIPT_DIR" 2>/dev/null || true

# ══════════════════════════════════════════════════════════════════════════════
tahap "Memasang dependensi proyek"
# ══════════════════════════════════════════════════════════════════════════════

info "Menjalankan npm install (bisa beberapa menit)..."
if [ -f "$SCRIPT_DIR/package-lock.json" ]; then
    sebagai_user npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 \
        || sebagai_user npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 \
        || mati "npm install gagal. Jalankan manual untuk melihat pesannya: npm install"
else
    sebagai_user npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 \
        || mati "npm install gagal. Jalankan manual: npm install"
fi
sukses "Dependensi Node.js terpasang."

# whatsapp-web.js 1.34.7 tidak bisa mengirim berkas sama sekali di WhatsApp Web
# versi 2026 (galat "Data passed to getter must include an id property").
# postinstall sudah menanganinya, tapi `npm ci` bisa melewati skrip bila
# dijalankan dengan --ignore-scripts, jadi pastikan sekali lagi di sini.
sebagai_user node scripts/patch-wwebjs.js >/dev/null 2>&1 \
    && sukses "Tambalan pengiriman berkas WhatsApp diterapkan." \
    || ingat "Tambalan whatsapp-web.js gagal. Jalankan manual: npm run patch:wwebjs"

info "Memasang Chrome untuk Puppeteer..."
if sebagai_user npx --yes puppeteer browsers install chrome >/dev/null 2>&1; then
    sukses "Chrome untuk Puppeteer siap."
else
    ingat "Gagal memasang Chrome Puppeteer. Coba manual: npx puppeteer browsers install chrome"
fi

# ══════════════════════════════════════════════════════════════════════════════
tahap "Menyiapkan PM2"
# ══════════════════════════════════════════════════════════════════════════════

if ! command -v pm2 >/dev/null 2>&1; then
    info "Memasang PM2 global..."
    npm install -g pm2 >/dev/null 2>&1 || mati "Gagal memasang PM2."
fi
sukses "PM2 $(pm2 -v 2>/dev/null) siap."

info "Memasang modul pm2-logrotate..."
if sebagai_user pm2 install pm2-logrotate >/dev/null 2>&1; then
    # Tanpa rotasi, log PM2 bisa memenuhi disk VPS dalam hitungan minggu.
    sebagai_user pm2 set pm2-logrotate:max_size 10M        >/dev/null 2>&1
    sebagai_user pm2 set pm2-logrotate:retain 7            >/dev/null 2>&1
    sebagai_user pm2 set pm2-logrotate:compress true       >/dev/null 2>&1
    sebagai_user pm2 set pm2-logrotate:workerInterval 30   >/dev/null 2>&1
    sebagai_user pm2 set pm2-logrotate:rotateInterval '0 0 * * *' >/dev/null 2>&1
    sebagai_user pm2 set pm2-logrotate:dateFormat 'YYYY-MM-DD_HH-mm-ss' >/dev/null 2>&1
    sukses "Log rotate aktif (maks 10 MB, simpan 7 hari, dikompres)."
else
    ingat "pm2-logrotate gagal dipasang. Coba manual: pm2 install pm2-logrotate"
fi

info "Mengaktifkan start otomatis saat VPS reboot..."
if pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null 2>&1; then
    sukses "PM2 akan otomatis hidup setelah reboot."
else
    ingat "Gagal memasang PM2 startup. Jalankan manual: pm2 startup"
fi

# ══════════════════════════════════════════════════════════════════════════════
tahap "Memulihkan data cadangan"
# ══════════════════════════════════════════════════════════════════════════════

if [ -z "$ARSIP_RESTORE" ]; then
    info "Tidak ada arsip diberikan (--restore). Dilewati."
elif [ ! -f "$ARSIP_RESTORE" ]; then
    ingat "Berkas cadangan tidak ditemukan: ${ARSIP_RESTORE}"
else
    info "Memulihkan dari: ${ARSIP_RESTORE}"
    ARSIP_ABS="$(cd "$(dirname "$ARSIP_RESTORE")" && pwd)/$(basename "$ARSIP_RESTORE")"
    if sebagai_user node -e "
        require('./src/services/backup')
          .pulihkanBackup(process.argv[1])
          .then(h => {
            const r = h.manifest.ringkasan || {};
            console.log('   user=' + r.user + ' driver=' + r.driver +
                        ' saldo=Rp' + (r.totalSaldo || 0).toLocaleString('id-ID'));
          })
          .catch(e => { console.error(e.message); process.exit(1); });
    " "$ARSIP_ABS"; then
        chown -R "$APP_USER":"$APP_USER" "$SCRIPT_DIR" 2>/dev/null || true
        sukses "Data berhasil dipulihkan."
    else
        ingat "Pemulihan gagal. Pulihkan lewat WhatsApp: /restore (lampirkan berkas)."
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
tahap "Verifikasi akhir"
# ══════════════════════════════════════════════════════════════════════════════

GAGAL_CEK=0

cek() {
    if eval "$2" >/dev/null 2>&1; then
        sukses "$1"
    else
        galat "$1"
        GAGAL_CEK=$((GAGAL_CEK + 1))
    fi
}

cek "Node.js terpasang"            "command -v node"
cek "npm terpasang"                "command -v npm"
cek "PM2 terpasang"                "command -v pm2"
cek "Dependensi node_modules ada"  "[ -d '$SCRIPT_DIR/node_modules' ]"
cek "Berkas .env ada"              "[ -f '$SCRIPT_DIR/.env' ]"
cek "index.js lolos sintaks"       "sebagai_user node --check '$SCRIPT_DIR/index.js'"
cek "Modul bot bisa dimuat"        "cd '$SCRIPT_DIR' && sebagai_user node -e \"require('./src/config')\""

SWAP_SEKARANG=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$SWAP_SEKARANG" -gt 0 ]; then
    sukses "Swap aktif: ${SWAP_SEKARANG} MB"
else
    [ "$BUAT_SWAP" = true ] && ingat "Swap tidak aktif — bot rawan mati kehabisan RAM."
fi

# ── Ringkasan ─────────────────────────────────────────────────────────────────
echo
if [ "$GAGAL_CEK" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}  ║            🎉  PEMASANGAN SELESAI & SIAP!             ║${NC}"
    echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════════════════╝${NC}"
else
    echo -e "${YELLOW}${BOLD}  ╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}${BOLD}  ║      ⚠  SELESAI, TAPI ADA ${GAGAL_CEK} PEMERIKSAAN GAGAL        ║${NC}"
    echo -e "${YELLOW}${BOLD}  ╚══════════════════════════════════════════════════════╝${NC}"
fi

if [ ${#PERINGATAN[@]} -gt 0 ]; then
    echo -e "\n${YELLOW}${BOLD}Perlu diperhatikan:${NC}"
    for p in "${PERINGATAN[@]}"; do echo -e "${YELLOW}  ⚠${NC} $p"; done
fi

echo -e "\n${BOLD}Langkah berikutnya:${NC}"
echo -e "  ${CYAN}1.${NC} Sesuaikan konfigurasi   : ${YELLOW}nano .env${NC}"
echo -e "  ${CYAN}2.${NC} Jalankan bot            : ${YELLOW}pm2 start ecosystem.config.js --env production${NC}"
echo -e "  ${CYAN}3.${NC} Pindai QR WhatsApp      : ${YELLOW}pm2 logs auto-petrip-bot${NC}"
echo -e "  ${CYAN}4.${NC} Kunci agar auto-start   : ${YELLOW}pm2 save${NC}"

echo -e "\n${BOLD}Perintah penting:${NC}"
echo -e "  ${CYAN}•${NC} Lihat log      : ${YELLOW}pm2 logs auto-petrip-bot${NC}"
echo -e "  ${CYAN}•${NC} Mulai ulang    : ${YELLOW}pm2 restart auto-petrip-bot${NC}"
echo -e "  ${CYAN}•${NC} Status         : ${YELLOW}pm2 status${NC}"
echo -e "  ${CYAN}•${NC} Cadangkan data : ketik ${YELLOW}/backup${NC} di WhatsApp"
echo -e "  ${CYAN}•${NC} Pulihkan data  : ketik ${YELLOW}/restore${NC} + lampirkan berkas cadangan"

echo -e "\n${BOLD}Pindah VPS nanti:${NC}"
echo -e "  ${CYAN}1.${NC} Di VPS lama : ketik ${YELLOW}/backup${NC} di WhatsApp, simpan berkasnya"
echo -e "  ${CYAN}2.${NC} Di VPS baru : ${YELLOW}sudo bash install.sh --restore backup_autopetrip_*.tar.gz${NC}"
echo -e "  ${CYAN}3.${NC} Pindai ulang QR WhatsApp — saldo & data user sudah ikut pindah.\n"
