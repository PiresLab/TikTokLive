import { TikTokClient } from './ingestion/tiktokClient.js';
import { logger } from './logger.js';
import type { GameEvent } from './types/GameEvent.js';

const uniqueId = process.argv[2] ?? process.env.TIKTOK_USERNAME;

if (!uniqueId) {
  logger.error('Uso: npm run dev:probe -- <usuario_tiktok_sem_@>');
  process.exit(1);
}

logger.info({ uniqueId }, 'Fase 0 — prova de conceito: conectando na live');

const client = new TikTokClient(uniqueId);

client.on('event', (event: GameEvent) => {
  logger.info({ event }, `evento: ${event.type}`);
});

client.on('connected', () => logger.info('client pronto, escutando eventos'));
client.on('disconnected', () => logger.warn('client caiu, reconectando...'));
client.on('streamEnd', () => logger.warn('live encerrou, aguardando streamer voltar'));

process.on('SIGINT', () => {
  logger.info('encerrando probe (SIGINT)');
  void client.stop().finally(() => process.exit(0));
});

void client.connect();
