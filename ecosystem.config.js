module.exports = {
  apps: [
    {
      name: 'auto-petrip-bot',
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
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
