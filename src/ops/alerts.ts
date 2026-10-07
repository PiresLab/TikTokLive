import { logger } from '../logger.js';

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;

/**
 * Alerta de falha crítica via webhook (Discord-compatible: {content: string}).
 * Sem ALERT_WEBHOOK_URL configurada, só loga warn e segue — nunca derruba o
 * processo principal por causa de alerta.
 */
export async function sendAlert(message: string): Promise<void> {
  logger.warn({ alert: message }, 'ALERTA');

  if (!WEBHOOK_URL) return;

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🚨 Reino em Guerra: ${message}` }),
    });
    if (!res.ok) logger.error({ status: res.status }, 'Falha ao enviar alerta pro webhook');
  } catch (err) {
    logger.error({ err }, 'Erro ao enviar alerta pro webhook');
  }
}
