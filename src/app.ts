import { createAdminApi, type SourceStatus } from './admin/adminApi.js';
import { EventLog } from './admin/eventLog.js';
import { GameEngine, type GameState, type SeasonEndedInfo } from './gameEngine/GameEngine.js';
import { validateBalance } from './gameEngine/balance.js';
import { logger } from './logger.js';
import { startStaticServer } from './net/staticServer.js';
import { GameWsServer } from './net/wsServer.js';
import { getHealth, touch } from './ops/heartbeat.js';
import { isObsIntegrationEnabled, refreshBrowserSource } from './ops/obsRefresh.js';
import type { Database } from './persistence/db.js';
import type { GameEvent } from './types/GameEvent.js';

const SNAPSHOT_INTERVAL_MS = 30_000;
const LEADERBOARD_LIMIT = 10;
const CLIENT_DISCONNECTED_ALERT_MS = 20_000;
const BALANCE_SETTING_KEY = 'balance';

export interface AppConfig {
  /** 'live' = fonte é o TikTok; 'fake' = eventos sintéticos (dev). */
  mode: 'live' | 'fake';
  db: Database;
  httpPort: number;
  wsPort: number;
  seasonDurationMs?: number;
  /** Restaura/salva o snapshot do jogo no banco (live: sim; dev:fake: não, sempre começa limpo). */
  persistSnapshot: boolean;
  getSourceStatus: () => SourceStatus;
}

export interface App {
  engine: GameEngine;
  ws: GameWsServer;
  log: EventLog;
  /** Liga o motor (tick). A fonte de eventos é plugada por quem criou o app. */
  start: () => void;
  shutdown: () => void;
}

/**
 * Fiação única de tudo que o jogo precisa (motor, WS, HTTP, banco, stats,
 * season, OBS, painel admin). `index.ts` pluga o TikTok; `devInjector.ts` pluga
 * eventos falsos — assim o painel admin funciona nos dois sem duplicar nada.
 */
export function createApp(config: AppConfig): App {
  const { db } = config;

  const savedState = config.persistSnapshot ? db.loadSnapshot<GameState>() : null;
  if (savedState) {
    logger.info({ wave: savedState.wave, day: savedState.seasonDay }, 'Estado restaurado do último snapshot');
  }

  const savedBalance = loadSavedBalance(db);
  const engine = new GameEngine(savedState ?? undefined, {
    seasonDurationMs: config.seasonDurationMs,
    balance: savedBalance,
  });
  const ws = new GameWsServer(config.wsPort);
  const log = new EventLog();

  const getLeaderboard = () => ({
    today: {
      gifters: db.getTodayTopGifters(LEADERBOARD_LIMIT),
      chatters: db.getTodayTopChatters(LEADERBOARD_LIMIT),
    },
    allTime: {
      gifters: db.getTopGifters(LEADERBOARD_LIMIT),
      chatters: db.getTopChatters(LEADERBOARD_LIMIT),
    },
    heroes: db.getRecentHeroes(LEADERBOARD_LIMIT),
    heroCount: db.getHeroCount(),
    hallOfFame: db.getHallOfFame(5),
  });

  const admin = createAdminApi({
    mode: config.mode,
    engine,
    ws,
    log,
    getSourceStatus: config.getSourceStatus,
    getLeaderboard,
    saveBalance: () => db.setSetting(BALANCE_SETTING_KEY, engine.getBalance()),
    clearSavedBalance: () => db.deleteSetting(BALANCE_SETTING_KEY),
  });

  startStaticServer(config.httpPort, { getHealth, getLeaderboard, admin });

  engine.on('state', (state) => {
    touch();
    ws.broadcast({ type: 'state', payload: state });
  });
  engine.on('fx', (event: GameEvent) => {
    ws.broadcast({ type: 'fx', payload: event });
    log.event(event);
    // evento de teste do painel admin afeta o jogo, mas nunca o ranking/estatística real
    if (!event.isTest) recordUserStat(db, event);
  });
  engine.on('narrative', (narrative) => {
    ws.broadcast({ type: 'narrative', payload: narrative });
    log.narrative(narrative);
  });
  engine.on('seasonEnded', (info: SeasonEndedInfo) => {
    db.archiveDayAndReset(info.day, info.waveReached);
    logger.info(info, 'Season encerrada, arquivada no Hall da Fama');
  });
  engine.on('balanceChanged', (balance) => ws.broadcastAdmin({ type: 'balance', payload: balance }));
  log.on('entry', (entry) => ws.broadcastAdmin({ type: 'log', payload: entry }));

  ws.on('clientsChanged', (counts) => {
    log.system(`clientes WS: jogo=${counts.render} preview=${counts.preview} admin=${counts.admin}`);
  });

  // Se o render client (aba do OBS) ficar 0 por tempo demais, tenta forçar
  // refresh da Browser Source — só age se OBS_WS_URL estiver configurada.
  let clientDisconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  ws.on('clientCountChanged', (count: number) => {
    if (clientDisconnectedTimer) {
      clearTimeout(clientDisconnectedTimer);
      clientDisconnectedTimer = null;
    }
    if (count === 0 && isObsIntegrationEnabled()) {
      clientDisconnectedTimer = setTimeout(() => {
        logger.warn('Render client sem reconectar — acionando refresh no OBS');
        log.system('render client sem reconectar — acionando refresh no OBS');
        void refreshBrowserSource();
      }, CLIENT_DISCONNECTED_ALERT_MS);
    }
  });

  const persistableState = (): GameState => {
    const { era, paused, goal, ...state } = engine.getState();
    return state;
  };

  const snapshotHandle = config.persistSnapshot
    ? setInterval(() => db.saveSnapshot(persistableState()), SNAPSHOT_INTERVAL_MS)
    : null;

  return {
    engine,
    ws,
    log,
    start: () => engine.start(),
    shutdown: () => {
      if (snapshotHandle) clearInterval(snapshotHandle);
      if (clientDisconnectedTimer) clearTimeout(clientDisconnectedTimer);
      admin.dispose();
      if (config.persistSnapshot) db.saveSnapshot(persistableState());
      engine.stop();
    },
  };
}

function loadSavedBalance(db: Database) {
  const saved = db.getSetting<unknown>(BALANCE_SETTING_KEY);
  if (saved === null) return undefined;
  const result = validateBalance(saved);
  if (!result.ok) {
    logger.warn({ error: result.error }, 'balanceamento salvo inválido — usando o padrão');
    return undefined;
  }
  logger.info('Balanceamento customizado carregado do banco');
  return result.value;
}

function recordUserStat(db: Database, event: GameEvent): void {
  switch (event.type) {
    case 'comment':
      db.recordActivity({ userId: event.user.userId, nickname: event.user.nickname, commentDelta: 1 });
      break;
    case 'like':
      db.recordActivity({
        userId: event.user.userId,
        nickname: event.user.nickname,
        likeDelta: event.likeCount ?? 1,
      });
      break;
    case 'gift':
      db.recordActivity({
        userId: event.user.userId,
        nickname: event.user.nickname,
        diamondValueDelta: event.totalDiamondValue ?? 0,
      });
      break;
    case 'follow':
      db.recordActivity({ userId: event.user.userId, nickname: event.user.nickname, markHero: true });
      break;
    default:
      break;
  }
}
