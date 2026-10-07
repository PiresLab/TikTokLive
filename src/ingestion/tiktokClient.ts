import { EventEmitter } from 'node:events';
import {
  ControlEvent,
  TikTokLiveConnection,
  WebcastEvent,
  type WebcastChatMessage,
  type WebcastGiftMessage,
  type WebcastLikeMessage,
  type WebcastSocialMessage,
} from 'tiktok-live-connector';
import { logger } from '../logger.js';
import type { GameEvent } from '../types/GameEvent.js';
import {
  normalizeChat,
  normalizeFollow,
  normalizeGift,
  normalizeLike,
  normalizeShare,
} from './eventNormalizer.js';

const BASE_RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

/**
 * tiktok-live-connector@2.5.0 declara TikTokLiveConnection via mixin
 * (`class X extends (const: new () => TypedEventEmitter<Map>)`) e os .d.ts
 * publicados perdem os métodos do emitter nessa composição — `.on` não
 * aparece no tipo apesar de existir em runtime. Mapeamos aqui os eventos
 * que de fato usamos e chamamos `.on`/`.off` via cast único, isolando o
 * workaround num só lugar em vez de espalhar `as any` pelo arquivo.
 */
type TikTokConnectionEvents = {
  [ControlEvent.CONNECTED]: () => void;
  [ControlEvent.DISCONNECTED]: () => void;
  [ControlEvent.ERROR]: (err: unknown) => void;
  [WebcastEvent.STREAM_END]: () => void;
  [WebcastEvent.CHAT]: (msg: WebcastChatMessage) => void;
  [WebcastEvent.LIKE]: (msg: WebcastLikeMessage) => void;
  [WebcastEvent.GIFT]: (msg: WebcastGiftMessage) => void;
  [WebcastEvent.FOLLOW]: (msg: WebcastSocialMessage) => void;
  [WebcastEvent.SHARE]: (msg: WebcastSocialMessage) => void;
};

interface TypedConnection {
  on<K extends keyof TikTokConnectionEvents>(event: K, handler: TikTokConnectionEvents[K]): void;
}

function asTyped(connection: TikTokLiveConnection): TypedConnection {
  return connection as unknown as TypedConnection;
}

/**
 * Envelopa o tiktok-live-connector (lib não-oficial) atrás de um contrato fixo.
 * Resto do jogo só escuta 'event' com GameEvent normalizado — se a lib trocar,
 * só este arquivo + eventNormalizer.ts mudam.
 */
export class TikTokClient extends EventEmitter {
  private readonly connection: TikTokLiveConnection;
  private reconnectDelay = BASE_RECONNECT_DELAY_MS;
  private stopped = false;
  private connected = false;
  private lastEventAtMs: number | null = null;

  /** Estado da conexão pro painel admin. */
  get status(): { username: string; connected: boolean; lastEventAt: number | null } {
    return { username: this.uniqueId, connected: this.connected, lastEventAt: this.lastEventAtMs };
  }

  constructor(private readonly uniqueId: string) {
    super();
    this.connection = new TikTokLiveConnection(uniqueId, {
      fetchRoomInfoOnConnect: true,
    });
    this.bindEvents();
  }

  private bindEvents(): void {
    asTyped(this.connection).on(ControlEvent.CONNECTED, () => {
      this.connected = true;
      this.reconnectDelay = BASE_RECONNECT_DELAY_MS;
      logger.info({ roomId: this.connection.roomId }, 'Conectado à live');
      this.emit('connected');
    });

    asTyped(this.connection).on(ControlEvent.DISCONNECTED, () => {
      this.connected = false;
      logger.warn('Desconectado da live');
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    asTyped(this.connection).on(ControlEvent.ERROR, (err: unknown) => {
      logger.error({ err }, 'Erro na conexão TikTok');
    });

    asTyped(this.connection).on(WebcastEvent.STREAM_END, () => {
      this.connected = false;
      logger.warn('Streamer saiu do ar (streamEnd) — aguardando retomada');
      this.emit('streamEnd');
      this.scheduleReconnect();
    });

    asTyped(this.connection).on(WebcastEvent.CHAT, (msg: WebcastChatMessage) => {
      this.emitGameEvent(normalizeChat(msg));
    });

    asTyped(this.connection).on(WebcastEvent.LIKE, (msg: WebcastLikeMessage) => {
      this.emitGameEvent(normalizeLike(msg));
    });

    asTyped(this.connection).on(WebcastEvent.GIFT, (msg: WebcastGiftMessage) => {
      const event = normalizeGift(msg);
      if (event) this.emitGameEvent(event);
    });

    asTyped(this.connection).on(WebcastEvent.FOLLOW, (msg: WebcastSocialMessage) => {
      this.emitGameEvent(normalizeFollow(msg));
    });

    asTyped(this.connection).on(WebcastEvent.SHARE, (msg: WebcastSocialMessage) => {
      this.emitGameEvent(normalizeShare(msg));
    });
  }

  private emitGameEvent(event: GameEvent): void {
    this.lastEventAtMs = Date.now();
    this.emit('event', event);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    logger.info({ delayMs: delay }, 'Tentando reconectar');
    setTimeout(() => {
      if (!this.stopped) void this.connect();
    }, delay);
  }

  async connect(): Promise<void> {
    try {
      await this.connection.connect();
    } catch (err) {
      logger.error({ err }, 'Falha ao conectar, agendando nova tentativa');
      this.scheduleReconnect();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.connection.disconnect();
  }
}
