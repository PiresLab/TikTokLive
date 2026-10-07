import { EventEmitter } from 'node:events';
import { EventType, TikTokLiveClient } from 'piratetok-live-js';
import { logger } from '../logger.js';
import type { GameEvent } from '../types/GameEvent.js';
import {
  normalizeChat,
  normalizeFollow,
  normalizeGift,
  normalizeLike,
  normalizeShare,
  type ChatData,
  type GiftPayload,
  type LikeData,
  type SocialData,
} from './eventNormalizer.js';

const BASE_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const LAG_REPORT_MS = 30_000;
const LAG_SAMPLES = 400;

/** Atraso entre o TikTok gerar o evento e ele chegar aqui (usa common.createTime do protobuf). */
function sourceLagMs(data: unknown, now: number): number | null {
  const raw = (data as { common?: { createTime?: string | number } } | null)?.common?.createTime;
  const created = Number(raw);
  if (!Number.isFinite(created) || created <= 0) return null;
  const createdMs = created < 1e12 ? created * 1000 : created; // alguns payloads vêm em segundos
  const lag = now - createdMs;
  return lag >= 0 && lag < 60_000 ? lag : null;
}

function cdnFromEnv(client: TikTokLiveClient): void {
  const cdn = process.env.TIKTOK_CDN?.trim();
  if (!cdn) return;
  if (cdn === 'eu') client.cdnEU();
  else if (cdn === 'us') client.cdnUS();
  else client.cdn(cdn);
}

/**
 * Envelopa o piratetok-live-js (lib não-oficial) atrás de um contrato fixo.
 * Resto do jogo só escuta 'event' com GameEvent normalizado — se a lib trocar,
 * só este arquivo + eventNormalizer.ts mudam.
 *
 * A lib já reconecta sozinha (backoff + rotação de ttwid) enquanto a live está
 * no ar; o backoff daqui cobre só o que ela não cobre: live offline no connect(),
 * retry esgotado ('disconnected') e fim de live ('liveEnded'). Cada tentativa usa
 * uma instância nova do cliente.
 */
export class TikTokClient extends EventEmitter {
  private client: TikTokLiveClient | null = null;
  private reconnectDelay = BASE_RECONNECT_DELAY_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private connected = false;
  private lastEventAtMs: number | null = null;
  private lagSamples: number[] = [];
  private lagTimer: NodeJS.Timeout | null = null;

  /** Estado da conexão pro painel admin. */
  get status(): { username: string; connected: boolean; lastEventAt: number | null } {
    return { username: this.uniqueId, connected: this.connected, lastEventAt: this.lastEventAtMs };
  }

  constructor(private readonly uniqueId: string) {
    super();
  }

  private createClient(): TikTokLiveClient {
    const client = new TikTokLiveClient(this.uniqueId);
    cdnFromEnv(client);

    client.on(EventType.connected, (data) => {
      if (this.client !== client) return;
      this.connected = true;
      this.reconnectDelay = BASE_RECONNECT_DELAY_MS;
      logger.info({ roomId: (data as { roomId?: string } | null)?.roomId }, 'Conectado à live');
      this.emit('connected');
    });

    client.on(EventType.reconnecting, (info) => {
      if (this.client !== client) return;
      this.connected = false;
      logger.warn({ info }, 'Conexão caiu, lib tentando reconectar');
    });

    client.on(EventType.disconnected, () => {
      if (this.client !== client) return;
      this.connected = false;
      logger.warn('Desconectado da live');
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    client.on('error', (err) => {
      logger.error({ err }, 'Erro na conexão TikTok');
    });

    client.on(EventType.liveEnded, () => {
      if (this.client !== client) return;
      this.connected = false;
      logger.warn('Streamer saiu do ar (liveEnded) — aguardando retomada');
      this.emit('streamEnd');
      this.client = null;
      client.disconnect();
      this.scheduleReconnect();
    });

    client.on(EventType.chat, (data) => {
      this.recordLag(data);
      this.emitGameEvent(normalizeChat(data as ChatData));
    });

    client.on(EventType.like, (data) => {
      this.recordLag(data);
      this.emitGameEvent(normalizeLike(data as LikeData));
    });

    client.on(EventType.gift, (data) => {
      this.recordLag(data);
      const event = normalizeGift(data as GiftPayload);
      if (event) this.emitGameEvent(event);
    });

    client.on(EventType.follow, (data) => {
      this.recordLag(data);
      this.emitGameEvent(normalizeFollow(data as SocialData));
    });

    client.on(EventType.share, (data) => {
      this.recordLag(data);
      this.emitGameEvent(normalizeShare(data as SocialData));
    });

    return client;
  }

  private recordLag(data: unknown): void {
    const lag = sourceLagMs(data, Date.now());
    if (lag === null) return;
    this.lagSamples.push(lag);
    if (this.lagSamples.length > LAG_SAMPLES) this.lagSamples.shift();
  }

  private reportLag(): void {
    if (this.lagSamples.length === 0) return;
    const sorted = [...this.lagSamples].sort((a, b) => a - b);
    const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    logger.info({ samples: sorted.length, avgMs: Math.round(avg), p95Ms: Math.round(p95), cdn: process.env.TIKTOK_CDN || 'padrão' }, 'Latência TikTok → app (criação do evento até chegar aqui)');
    this.lagSamples = [];
  }

  private emitGameEvent(event: GameEvent): void {
    this.lastEventAtMs = Date.now();
    this.emit('event', event);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    logger.info({ delayMs: delay }, 'Tentando reconectar');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) void this.connect();
    }, delay);
  }

  async connect(): Promise<void> {
    if (this.stopped) return;
    if (!this.lagTimer) this.lagTimer = setInterval(() => this.reportLag(), LAG_REPORT_MS);
    const client = this.createClient();
    this.client = client;
    try {
      await client.connect();
    } catch (err) {
      logger.error({ err }, 'Falha ao conectar, agendando nova tentativa');
      if (this.client === client) {
        this.client = null;
        client.disconnect();
        this.scheduleReconnect();
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.lagTimer) {
      clearInterval(this.lagTimer);
      this.lagTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.client;
    this.client = null;
    client?.disconnect();
  }
}
