module.exports = {
  apps: [
    {
      name: 'auto-petrip-bot',
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      restart_delay: 3000,
      cron_restart: '0 4 * * *', // Restart otomatis setiap jam 04:00 subuh agar browser selalu fresh
      watch: false, // Disarankan false untuk produksi agar tidak restart tiba-tiba
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      // Konfigurasi jika pengguna tetap ingin menggunakan watch mode
      ignore_watch: [
        'node_modules',
        'data',
        'cookies',
        'screenshots',
        'sessions',
        '.wwebjs_auth',
        '.wwebjs_cache',
        '*.log',
        '*.json'
      ],
      watch_options: {
        followSymlinks: false
      }
    }
  ]
};
