module.exports = {
  apps: [
    {
      name: 'auto-petrip-bot',
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      min_uptime: '30s',
      // Dinaikkan drastis: dengan max_restarts kecil, PM2 menyerah dan menandai app
      // "errored" sehingga bot mati permanen sampai `pm2 restart all` manual.
      max_restarts: 1000,
      kill_timeout: 15000,
      listen_timeout: 15000,
      cron_restart: '0 4 * * *', // Restart otomatis setiap jam 04:00 subuh agar browser selalu fresh
      watch: false, // Disarankan false untuk produksi agar tidak restart tiba-tiba
      max_memory_restart: '1G',
      node_args: '--max-old-space-size=768',

      // PM2 logging hardening (tidak mudah gemuk di VPS)
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_size: '10M',
      retain: 7,
      compress: true,

      env: {
        NODE_ENV: 'production',
      },
      // Konfigurasi jika pengguna tetap ingin menggunakan watch mode
      ignore_watch: [
        'node_modules',
        'logs',
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
