import 'dotenv/config';
import { join } from 'node:path';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { Database } from './persistence/db.js';
import { randomFakeEvent } from './testing/fakeEvents.js';

/**
 * Entry de desenvolvimento: mesma pipeline (e mesmo painel admin) da live
 * real, mas sem TikTok — gera GameEvent sintético a cada poucos segundos.
 * Serve pra testar ondas, chefão, queda do reino, season/Hall da Fama,
 * heróis, leaderboard e o painel admin sem precisar estar ao vivo nem
 * esperar 24h. Season aqui dura só 40s (em vez de 24h) pra dar pra ver o
 * ciclo completo num teste curto — ajustável via SEASON_DURATION_MS. Usa um
 * SQLite separado (data/reino.dev.sqlite) pra não misturar dado fake com
 * estatística real, e não restaura/salva snapshot (sempre começa limpo).
 */

const WS_PORT = Number(process.env.WS_PORT ?? 8787);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);
const SEASON_DURATION_MS = Number(process.env.SEASON_DURATION_MS ?? 40_000);
const INJECT_INTERVAL_MS = Number(process.env.INJECT_INTERVAL_MS ?? 1_500);

const db = new Database(join(process.cwd(), 'data', 'reino.dev.sqlite'));

const app = createApp({
  mode: 'fake',
  db,
  httpPort: HTTP_PORT,
  wsPort: WS_PORT,
  seasonDurationMs: SEASON_DURATION_MS,
  persistSnapshot: false,
  getSourceStatus: () => ({ kind: 'fake' }),
});

app.start();
logger.info(
  { httpPort: HTTP_PORT, seasonDurationMs: SEASON_DURATION_MS },
  `Injetor de teste rodando — abra http://localhost:${HTTP_PORT}`,
);
logger.info(`Painel admin: http://localhost:${HTTP_PORT}/admin/`);

const injectorHandle = setInterval(() => app.engine.handleEvent(randomFakeEvent()), INJECT_INTERVAL_MS);

process.on('SIGINT', () => {
  clearInterval(injectorHandle);
  app.shutdown();
  db.close();
  process.exit(0);
});
