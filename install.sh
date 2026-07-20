#!/usr/bin/env bash

# ==============================================================================
# 🚀 AUTO-PETRIP BOT - UNIVERSAL LINUX AUTO-INSTALLER
# Supports: Debian 11, 12, 13 & Ubuntu 20.04, 22.04, 24.04
# ==============================================================================

# Definisikan warna output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0;37m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}   🤖 AUTO-PETRIP BOT - Linux Installer Helper       ${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Cek Hak Akses Root / Sudo
if [ "$EUID" -ne 0 ]; then
    # Jika bukan root, coba jalankan dengan sudo jika tersedia
    if command -v sudo >/dev/null 2>&1; then
        echo -e "${YELLOW}[!] Menjalankan ulang skrip menggunakan sudo...${NC}"
        exec sudo bash "$0" "$@"
    else
        echo -e "${RED}[Error] Skrip ini membutuhkan hak akses root. Silakan jalankan sebagai root atau gunakan sudo.${NC}"
        exit 1
    fi
fi

# 2. Deteksi OS & Versi
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID=$ID
    OS_VERSION=$VERSION_ID
    OS_NAME=$NAME
else
    echo -e "${RED}[Error] File /etc/os-release tidak ditemukan. Hanya mendukung Linux Debian & Ubuntu.${NC}"
    exit 1
fi

echo -e "${GREEN}[*] Terdeteksi Sistem Operasi: ${OS_NAME} (${OS_VERSION})${NC}"

# Validasi dukungan OS
SUPPORTED=false
if [[ "$OS_ID" == "ubuntu" || "$OS_ID" == "debian" ]]; then
    SUPPORTED=true
fi

# Juga cek via ID_LIKE
if [ "$SUPPORTED" = false ] && [ -n "$ID_LIKE" ]; then
    for like in $ID_LIKE; do
        if [[ "$like" == "ubuntu" || "$like" == "debian" ]]; then
            SUPPORTED=true
            OS_ID=$like
            break
        fi
    done
fi

if [ "$SUPPORTED" = false ]; then
    echo -e "${RED}[Error] OS ${OS_NAME} tidak didukung secara resmi.${NC}"
    echo -e "Skrip ini hanya mendukung Debian 11, 12, 13 & Ubuntu 20.04, 22.04, 24.04."
    exit 1
fi

# 3. Update Package List & Install Prasyarat Awal (curl, git)
echo -e "\n${BLUE}[1/5] Memperbarui daftar paket & memasang modul dasar...${NC}"
apt-get update -y
apt-get install -y curl git wget lsb-release ca-certificates

# 4. Verifikasi dan Instalasi Node.js (Minimal Versi 18)
echo -e "\n${BLUE}[2/5] Memeriksa instalasi Node.js & NPM...${NC}"
INSTALL_NODE=false

if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VER" | cut -d'.' -f1)
    echo -e "${GREEN}[*] Node.js sudah terpasang: v${NODE_VER}${NC}"
    
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo -e "${YELLOW}[!] Versi Node.js terlalu usang (butuh >= 18). Akan di-upgrade ke v20 LTS...${NC}"
        INSTALL_NODE=true
    fi
else
    echo -e "${YELLOW}[!] Node.js tidak ditemukan. Mempersiapkan instalasi Node.js v20 LTS...${NC}"
    INSTALL_NODE=true
fi

if [ "$INSTALL_NODE" = true ]; then
    echo -e "${BLUE}[*] Mengunduh skrip setup NodeSource untuk Node.js v20...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    echo -e "${BLUE}[*] Menginstal Node.js & NPM...${NC}"
    apt-get install -y nodejs
    echo -e "${GREEN}[*] Node.js berhasil dipasang: $(node -v)${NC}"
fi

# 5. Deteksi Audio Package secara Dinamis (libasound2 vs libasound2t64)
echo -e "\n${BLUE}[3/5] Menyesuaikan dependensi audio dengan repositori Linux...${NC}"
AUDIO_PKG="libasound2"
if apt-cache show libasound2t64 >/dev/null 2>&1; then
    AUDIO_PKG="libasound2t64"
    echo -e "${GREEN}[*] Menggunakan paket audio baru: ${AUDIO_PKG}${NC}"
else
    echo -e "${GREEN}[*] Menggunakan paket audio standar: ${AUDIO_PKG}${NC}"
fi

# 6. Install System Dependencies untuk Headless Chromium/Puppeteer
echo -e "\n${BLUE}[4/5] Menginstal pustaka sistem Linux untuk Chromium...${NC}"
apt-get install -y \
    fonts-liberation \
    "$AUDIO_PKG" \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgbm-dev \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils

# 7. Memasang Dependensi Node.js & Puppeteer Chrome
echo -e "\n${BLUE}[5/5] Memasang dependensi Node.js & Puppeteer Chrome...${NC}"
# Berpindah ke folder project (jika dijalankan dari luar root proyek)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit

# Kembalikan hak kepemilikan file sementara ke user normal jika terdeteksi sudo user
# untuk menghindari permission error saat npm install/run di kemudian hari.
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    echo -e "${YELLOW}[*] Menyesuaikan kepemilikan file untuk user: $SUDO_USER...${NC}"
    chown -R "$SUDO_USER:$SUDO_USER" .
    
    # Jalankan npm install dan chrome install sebagai user non-root (SUDO_USER)
    echo -e "${BLUE}[*] Menjalankan 'npm install' sebagai user '$SUDO_USER'...${NC}"
    sudo -u "$SUDO_USER" npm install
    
    echo -e "${BLUE}[*] Memasang Google Chrome binary lokal untuk Puppeteer...${NC}"
    sudo -u "$SUDO_USER" npx puppeteer browsers install chrome
else
    echo -e "${BLUE}[*] Menjalankan 'npm install' sebagai root...${NC}"
    npm install
    
    echo -e "${BLUE}[*] Memasang Google Chrome binary lokal untuk Puppeteer...${NC}"
    npx puppeteer browsers install chrome
fi

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}  🎉 INSTALASI & KONFIGURASI SELESAI DENGAN SUKSES!    ${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "Untuk mengkonfigurasi bot, silakan sesuaikan file ${YELLOW}.env${NC}."
echo -e "Jalankan bot menggunakan salah satu perintah di bawah ini:"
echo -e "  • Mode Pengembangan:  ${BLUE}npm run dev${NC}"
echo -e "  • Mode Produksi:      ${BLUE}npm start${NC}"
echo -e "======================================================\n"
