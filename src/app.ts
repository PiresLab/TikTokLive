import { createAdminApi, type SourceStatus } from './admin/adminApi.js';
import { EventLog } from './admin/eventLog.js';
import { GameEngine, type GameState, type SeasonEndedInfo } from './gameEngine/GameEngine.js';
import { validateBalance } from './gameEngine/balance.js';
import { logger } from './logger.js';
import { startStaticServer } from './net/staticServer.js';
import { GameWsServer } from './net/wsServer.js';
import { getHealth, touch } from './ops/heartbeat.js';
import { isObsIntegrationEnabled, refreshBrowserSource } from './ops/obsRefresh.js';
import type { Database, LeaderboardEntry } from './persistence/db.js';
import { levelForXp } from './progression/levels.js';
import { ProgressionService, type ProgressMessage } from './progression/ProgressionService.js';
import type { GameEvent } from './types/GameEvent.js';

const SNAPSHOT_INTERVAL_MS = 30_000;
const LEADERBOARD_LIMIT = 10;
const CLIENT_DISCONNECTED_ALERT_MS = 20_000;
const BALANCE_SETTING_KEY = 'balance';
const PROFILE_COMMAND = /^\s*!perfil\b/i;
const PROFILE_COOLDOWN_MS = 15_000;
const HEROES_BY_LEVEL = 8;
const HEROES_RECENT = 4;

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
  const progression = new ProgressionService(db, { getDay: () => engine.getState().seasonDay });
  const profileAskedAt = new Map<string, number>();

  /** Coloca o nível de cada pessoa nas listas de ranking. */
  const withLevels = (entries: LeaderboardEntry[]): LeaderboardEntry[] => {
    const xp = db.getXpMap(entries.map((e) => e.userId));
    return entries.map((e) => ({ ...e, level: levelForXp(xp.get(e.userId) ?? 0).level }));
  };

  const getLeaderboard = () => ({
    today: {
      gifters: withLevels(db.getTodayTopGifters(LEADERBOARD_LIMIT)),
      chatters: withLevels(db.getTodayTopChatters(LEADERBOARD_LIMIT)),
    },
    allTime: {
      gifters: withLevels(db.getTopGifters(LEADERBOARD_LIMIT)),
      chatters: withLevels(db.getTopChatters(LEADERBOARD_LIMIT)),
    },
    // os de maior nível + os mais recentes: seguir continua dando um herói novo na hora, e quem evolui fica
    heroes: db
      .getHeroesForDisplay(HEROES_BY_LEVEL, HEROES_RECENT)
      .map((h) => ({ userId: h.userId, nickname: h.nickname, heroSince: h.heroSince, ...progression.describe(h) })),
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
    progression,
    getTopLevels: () => db.getTopXp(10).map((p) => ({ userId: p.userId, nickname: p.nickname, xp: Math.floor(p.xp), ...progression.describe(p) })),
    saveBalance: () => db.setSetting(BALANCE_SETTING_KEY, engine.getBalance()),
    clearSavedBalance: () => db.deleteSetting(BALANCE_SETTING_KEY),
  });

  startStaticServer(config.httpPort, { getHealth, getLeaderboard, admin });

  engine.on('state', (state) => {
    touch();
    ws.broadcast({ type: 'state', payload: state });
  });
  engine.on('fx', (event: GameEvent) => {
    // evento de teste do painel admin afeta o jogo, mas nunca o ranking/estatística/progressão real
    if (!event.isTest) {
      recordUserStat(db, event);
      progression.handleEvent(event);
    }
    ws.broadcast({ type: 'fx', payload: event.isTest ? event : { ...event, level: progression.levelOf(event.user.userId) } });
    log.event(event);
    if (!event.isTest && event.type === 'comment' && PROFILE_COMMAND.test(event.comment ?? '')) sendProfile(event.user.userId);
  });
  engine.on('narrative', (narrative) => {
    if (narrative.kind === 'bossDefeated') progression.handleBossDefeated(narrative.by);
    ws.broadcast({ type: 'narrative', payload: narrative });
    log.narrative(narrative);
  });
  progression.on('progress', (message: ProgressMessage) => {
    ws.broadcast({ type: 'progress', payload: message });
    log.system(describeProgress(message));
  });

  /** `!perfil` no chat: mostra o cartão da pessoa na tela (com intervalo mínimo por pessoa). */
  function sendProfile(userId: string): void {
    const now = Date.now();
    if (now - (profileAskedAt.get(userId) ?? 0) < PROFILE_COOLDOWN_MS) return;
    const card = progression.getProfile(userId);
    if (!card) return;
    profileAskedAt.set(userId, now);
    ws.broadcast({ type: 'profile', payload: card });
  }
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
    const { era, paused, goal, world, ...state } = engine.getState();
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

function describeProgress(m: ProgressMessage): string {
  switch (m.kind) {
    case 'levelUp':
      return `${m.user.nickname} subiu para o nível ${m.level} (${m.title})`;
    case 'mission':
      return `${m.user.nickname} cumpriu a missão "${m.title}" (+${m.xp} XP)`;
    case 'achievement':
      return `${m.user.nickname} desbloqueou "${m.title}"`;
  }
}
