// Config do PM2 — supervisiona o app principal e o watchdog como processos
// separados, cada um com autorestart. Rodar com: npm run pm2:start
// (builda com tsc antes, porque tsx não é ideal pra rodar 24/7 via PM2).
require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'reino-em-guerra',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      restart_delay: 3000,
      env: {
        TIKTOK_USERNAME: process.env.TIKTOK_USERNAME || '',
        HTTP_PORT: process.env.HTTP_PORT || '8080',
        WS_PORT: process.env.WS_PORT || '8787',
        ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL || '',
        OBS_WS_URL: process.env.OBS_WS_URL || '',
        OBS_WS_PASSWORD: process.env.OBS_WS_PASSWORD || '',
        OBS_SOURCE_NAME: process.env.OBS_SOURCE_NAME || '',
      },
      error_file: 'logs/reino-error.log',
      out_file: 'logs/reino-out.log',
      time: true,
    },
    {
      name: 'reino-watchdog',
      script: 'dist/ops/watchdog.js',
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      env: {
        HEALTH_URL: process.env.HEALTH_URL || 'http://localhost:8080/health',
        PM2_APP_NAME: 'reino-em-guerra',
        ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL || '',
      },
      error_file: 'logs/watchdog-error.log',
      out_file: 'logs/watchdog-out.log',
      time: true,
    },
  ],
};
