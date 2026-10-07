import 'dotenv/config';
import { createApp } from './app.js';
import { TikTokClient } from './ingestion/tiktokClient.js';
import { logger } from './logger.js';
import { sendAlert } from './ops/alerts.js';
import { Database } from './persistence/db.js';

const uniqueId = process.argv[2] ?? process.env.TIKTOK_USERNAME;
const WS_PORT = Number(process.env.WS_PORT ?? 8787);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
const TIKTOK_DISCONNECTED_ALERT_MS = 5 * 60_000;

if (!uniqueId) {
  logger.error('Uso: npm run dev -- <usuario_tiktok_sem_@>');
  process.exit(1);
}

// Falha não tratada: loga, alerta e derruba o processo de propósito — o PM2
// (ou qualquer supervisor) reinicia limpo em vez do processo mancar quebrado.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException — encerrando pro supervisor reiniciar');
  void sendAlert(`processo caiu com exceção não tratada: ${String(err)}`).finally(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandledRejection — encerrando pro supervisor reiniciar');
  void sendAlert(`processo caiu com rejeição não tratada: ${String(reason)}`).finally(() => process.exit(1));
});

const db = new Database();
const client = new TikTokClient(uniqueId);

const app = createApp({
  mode: 'live',
  db,
  httpPort: HTTP_PORT,
  wsPort: WS_PORT,
  persistSnapshot: true,
  getSourceStatus: () => ({ kind: 'tiktok', ...client.status }),
});

let lastTikTokConnectedAt = Date.now();
let tiktokDownAlertSent = false;

client.on('event', (event) => app.engine.handleEvent(event));
client.on('connected', () => {
  logger.info('ingestão pronta, motor rodando');
  app.log.system(`TikTok conectado (@${uniqueId})`);
  lastTikTokConnectedAt = Date.now();
  tiktokDownAlertSent = false;
});
client.on('disconnected', () => app.log.system('TikTok desconectado — reconectando'));
client.on('streamEnd', () => app.log.system('live encerrou — aguardando o streamer voltar'));

const tiktokWatchdog = setInterval(() => {
  const downFor = Date.now() - lastTikTokConnectedAt;
  if (!client.status.connected && downFor > TIKTOK_DISCONNECTED_ALERT_MS && !tiktokDownAlertSent) {
    tiktokDownAlertSent = true;
    void sendAlert(`conector TikTok sem conexão há mais de ${Math.round(downFor / 60_000)} min`);
  }
}, 30_000);

app.start();
void client.connect();

logger.info({ httpPort: HTTP_PORT, wsPort: WS_PORT }, `Abra http://localhost:${HTTP_PORT} no OBS Browser Source`);
logger.info(`Painel admin: http://localhost:${HTTP_PORT}/admin/ (só aceita acesso local)`);

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function shutdown(signal: string): void {
  logger.info({ signal }, 'encerrando');
  clearInterval(tiktokWatchdog);
  app.shutdown();
  db.close();
  void client.stop().finally(() => process.exit(0));
}
