import OBSWebSocket from 'obs-websocket-js';
import { logger } from '../logger.js';
import { sendAlert } from './alerts.js';

const OBS_WS_URL = process.env.OBS_WS_URL;
const OBS_WS_PASSWORD = process.env.OBS_WS_PASSWORD;
const OBS_SOURCE_NAME = process.env.OBS_SOURCE_NAME ?? 'Reino em Guerra';
const MIN_REFRESH_INTERVAL_MS = 15_000;

let obs: OBSWebSocket | null = null;
let connecting: Promise<OBSWebSocket> | null = null;
let lastRefreshAt = 0;

const enabled = Boolean(OBS_WS_URL);

async function getConnection(): Promise<OBSWebSocket> {
  if (obs) return obs;
  if (connecting) return connecting;

  connecting = (async () => {
    const client = new OBSWebSocket();
    client.on('ConnectionClosed', () => {
      logger.warn('Conexão com OBS (obs-websocket) caiu');
      obs = null;
    });
    await client.connect(OBS_WS_URL, OBS_WS_PASSWORD);
    logger.info({ source: OBS_SOURCE_NAME }, 'Conectado ao OBS via obs-websocket');
    obs = client;
    return client;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

/**
 * Força o OBS a recarregar a Browser Source (sem cache) — usado quando o
 * client Phaser fica desconectado do WS por tempo demais (aba travou/crashou
 * dentro do OBS). Desligado por padrão: só ativa com OBS_WS_URL configurada.
 * Debounce de 15s pra não ficar martelando refresh em flapping de conexão.
 */
export async function refreshBrowserSource(): Promise<void> {
  if (!enabled) return;

  const now = Date.now();
  if (now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return;
  lastRefreshAt = now;

  try {
    const client = await getConnection();
    await client.call('PressInputPropertiesButton', {
      inputName: OBS_SOURCE_NAME,
      propertyName: 'refreshnocache',
    });
    logger.info({ source: OBS_SOURCE_NAME }, 'Browser Source do OBS recarregada');
  } catch (err) {
    logger.error({ err }, 'Falha ao recarregar Browser Source no OBS');
    await sendAlert(`não consegui recarregar a Browser Source "${OBS_SOURCE_NAME}" no OBS`);
  }
}

export function isObsIntegrationEnabled(): boolean {
  return enabled;
}
