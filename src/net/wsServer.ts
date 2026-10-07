import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../logger.js';
import type { GameStateView, NarrativeEvent } from '../gameEngine/GameEngine.js';
import type { GameEvent } from '../types/GameEvent.js';
import { checkAdminWs } from './adminGuard.js';

export type OutboundMessage =
  | { type: 'state'; payload: GameStateView }
  | { type: 'fx'; payload: GameEvent }
  | { type: 'narrative'; payload: NarrativeEvent };

/** Mensagens só pro painel admin (log do feed, status, balanceamento…). */
export interface AdminMessage {
  type: 'log' | 'balance' | 'status';
  payload: unknown;
}

/**
 * render  = o jogo de verdade (aba do OBS) — é o único papel que conta pra
 *           detectar queda do OBS;
 * preview = o iframe de pré-visualização dentro do painel admin;
 * admin   = o painel (só aceita conexão local).
 */
export type SocketRole = 'render' | 'preview' | 'admin';

export interface ClientCounts {
  render: number;
  preview: number;
  admin: number;
}

function parseRole(req: IncomingMessage): SocketRole {
  const raw = new URL(req.url ?? '/', 'http://internal').searchParams.get('role');
  return raw === 'admin' || raw === 'preview' ? raw : 'render';
}

/** Emite 'clientCountChanged' (number de clientes `render`) pro index saber se o OBS caiu. */
export class GameWsServer extends EventEmitter {
  private readonly wss: WebSocketServer;
  private readonly roles = new WeakMap<WebSocket, SocketRole>();

  constructor(port: number) {
    super();
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (socket, req) => this.onConnection(socket, req));
    logger.info({ port }, 'WS server pronto pro client Phaser');
  }

  private onConnection(socket: WebSocket, req: IncomingMessage): void {
    const role = parseRole(req);

    if (role === 'admin') {
      const guard = checkAdminWs({
        remoteAddress: req.socket.remoteAddress,
        host: req.headers.host,
        origin: req.headers.origin,
      });
      if (!guard.ok) {
        logger.warn({ reason: guard.reason, remote: req.socket.remoteAddress }, 'WS admin recusado');
        socket.close(1008, 'forbidden');
        return;
      }
    }

    this.roles.set(socket, role);
    logger.info({ role }, 'cliente WS conectado');
    this.emitCounts();

    socket.on('close', () => {
      logger.info({ role }, 'cliente WS desconectou');
      this.emitCounts();
    });
  }

  private emitCounts(): void {
    this.emit('clientCountChanged', this.getClientCounts().render);
    this.emit('clientsChanged', this.getClientCounts());
  }

  getClientCounts(): ClientCounts {
    const counts: ClientCounts = { render: 0, preview: 0, admin: 0 };
    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const role = this.roles.get(client);
      if (role) counts[role] += 1;
    }
    return counts;
  }

  /** Estado/efeitos do jogo: vai pra todos (render, preview e admin). */
  broadcast(message: OutboundMessage): void {
    this.send(message, () => true);
  }

  broadcastAdmin(message: AdminMessage): void {
    this.send(message, (role) => role === 'admin');
  }

  private send(message: OutboundMessage | AdminMessage, accept: (role: SocketRole) => boolean): void {
    let data: string | null = null;
    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const role = this.roles.get(client);
      if (!role || !accept(role)) continue;
      data ??= JSON.stringify(message);
      client.send(data);
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }
}
