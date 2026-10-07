import 'dotenv/config';
import { execFile } from 'node:child_process';
import { logger } from '../logger.js';
import { sendAlert } from './alerts.js';

/**
 * Processo separado (PM2 app própria) que só verifica se o app principal
 * responde em /health. Fica fora do processo principal de propósito: se o
 * principal travar de um jeito que nem o event loop responde, ele mesmo não
 * consegue se auto-detectar — precisa de alguém de fora olhando.
 */

const HEALTH_URL = process.env.HEALTH_URL ?? `http://localhost:${process.env.HTTP_PORT ?? 8080}/health`;
const CHECK_INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS ?? 15_000);
const PM2_APP_NAME = process.env.PM2_APP_NAME ?? 'reino-em-guerra';
const RESTART_COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let lastRestartAt = 0;

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

function restartApp(): void {
  const now = Date.now();
  if (now - lastRestartAt < RESTART_COOLDOWN_MS) {
    logger.warn('Restart pedido mas ainda em cooldown, ignorando');
    return;
  }
  lastRestartAt = now;

  logger.error({ app: PM2_APP_NAME }, 'Reiniciando app principal via PM2');
  execFile('npx', ['pm2', 'restart', PM2_APP_NAME], (err, stdout, stderr) => {
    if (err) {
      logger.error({ err, stderr }, 'Falha ao rodar "pm2 restart" — reinicie manualmente');
      void sendAlert(`watchdog não conseguiu reiniciar "${PM2_APP_NAME}" via PM2: ${err.message}`);
      return;
    }
    logger.info({ stdout }, 'pm2 restart disparado com sucesso');
  });
}

async function tick(): Promise<void> {
  const healthy = await checkHealth();

  if (healthy) {
    if (consecutiveFailures > 0) logger.info('App principal voltou a responder em /health');
    consecutiveFailures = 0;
    return;
  }

  consecutiveFailures += 1;
  logger.warn({ consecutiveFailures }, 'App principal não respondeu em /health');

  // exige algumas falhas seguidas antes de agir — evita restart por um blip de rede
  if (consecutiveFailures >= 3) {
    void sendAlert(`app principal não responde há ${consecutiveFailures} checagens seguidas, reiniciando`);
    restartApp();
    consecutiveFailures = 0;
  }
}

logger.info({ healthUrl: HEALTH_URL, intervalMs: CHECK_INTERVAL_MS }, 'Watchdog rodando');

const handle = setInterval(() => void tick(), CHECK_INTERVAL_MS);

process.on('SIGINT', () => {
  clearInterval(handle);
  process.exit(0);
});
process.on('SIGTERM', () => {
  clearInterval(handle);
  process.exit(0);
});
