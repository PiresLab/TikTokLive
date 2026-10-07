import { logger } from '../logger.js';
import { BALANCE_RANGES, DEFAULT_BALANCE } from '../gameEngine/balance.js';
import type { GameEngine } from '../gameEngine/GameEngine.js';
import type { AdminHttpResult } from '../net/staticServer.js';
import type { GameWsServer } from '../net/wsServer.js';
import { getHealth } from '../ops/heartbeat.js';
import { isObsIntegrationEnabled } from '../ops/obsRefresh.js';
import { buildTestEvent, randomFakeEvent } from '../testing/fakeEvents.js';
import { parseCommand, type AdminCommand } from './commands.js';
import type { EventLog } from './eventLog.js';

export type SourceStatus =
  | { kind: 'tiktok'; username: string; connected: boolean; lastEventAt: number | null }
  | { kind: 'fake' };

export interface AdminDeps {
  mode: 'live' | 'fake';
  engine: GameEngine;
  ws: GameWsServer;
  log: EventLog;
  getSourceStatus: () => SourceStatus;
  getLeaderboard: () => unknown;
  saveBalance: () => void;
  clearSavedBalance: () => void;
}

interface BurstState {
  ratePerSec: number;
  endsAt: number;
}

const BURST_TICK_MS = 100;

export interface AdminApi {
  getStatus: () => unknown;
  runCommand: (body: unknown) => AdminHttpResult;
  dispose: () => void;
}

export function createAdminApi(deps: AdminDeps): AdminApi {
  const { engine, log } = deps;
  const startedAt = Date.now();
  let burst: BurstState | null = null;
  let burstTimer: ReturnType<typeof setInterval> | null = null;
  let burstCarry = 0;

  function stopBurst(): void {
    if (burstTimer) clearInterval(burstTimer);
    burstTimer = null;
    burst = null;
    burstCarry = 0;
  }

  function startBurst(ratePerSec: number, seconds: number): void {
    stopBurst();
    burst = { ratePerSec, endsAt: Date.now() + seconds * 1000 };
    burstTimer = setInterval(() => {
      if (!burst || Date.now() >= burst.endsAt) {
        stopBurst();
        log.system('[ADMIN] rajada de teste terminou');
        return;
      }
      burstCarry += (burst.ratePerSec * BURST_TICK_MS) / 1000;
      const toSend = Math.floor(burstCarry);
      burstCarry -= toSend;
      for (let i = 0; i < toSend; i += 1) engine.handleEvent(randomFakeEvent(true));
    }, BURST_TICK_MS);
  }

  function execute(command: AdminCommand): string {
    switch (command.cmd) {
      case 'inject':
        engine.handleEvent(buildTestEvent(command.event));
        return `evento de teste (${command.event.type})`;
      case 'burst':
        startBurst(command.ratePerSec, command.seconds);
        return `rajada de teste: ${command.ratePerSec} eventos/s por ${command.seconds}s`;
      case 'stopBurst':
        stopBurst();
        return 'rajada de teste parada';
      case 'spawnBoss':
        engine.adminSpawnBoss();
        return 'chefão forçado';
      case 'setWave':
        engine.adminSetWave(command.wave);
        return `onda definida para ${command.wave}`;
      case 'healKingdom':
        engine.adminHealKingdom(command.amount);
        return `Reino curado em ${command.amount}`;
      case 'damageKingdom':
        engine.adminDamageKingdom(command.amount);
        return `Reino danificado em ${command.amount}`;
      case 'endSeason':
        engine.adminEndSeason();
        return 'season encerrada manualmente';
      case 'addScore':
        engine.adminAddLifetimeScore(command.amount);
        return `+${command.amount} de score vitalício`;
      case 'pause':
        engine.setPaused(true);
        return 'jogo pausado';
      case 'resume':
        engine.setPaused(false);
        return 'jogo retomado';
      case 'setBalance': {
        const result = engine.setBalance(command.balance);
        if (!result.ok) throw new Error(result.error);
        deps.saveBalance();
        return 'balanceamento salvo';
      }
      case 'resetBalance':
        engine.resetBalance();
        deps.clearSavedBalance();
        return 'balanceamento restaurado ao padrão';
    }
  }

  function getStatus() {
    return {
      now: Date.now(),
      mode: deps.mode,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      game: engine.getState(),
      balance: engine.getBalance(),
      balanceDefaults: DEFAULT_BALANCE,
      balanceRanges: BALANCE_RANGES,
      source: deps.getSourceStatus(),
      clients: deps.ws.getClientCounts(),
      obsEnabled: isObsIntegrationEnabled(),
      health: getHealth(),
      burst,
      leaderboard: deps.getLeaderboard(),
      log: log.recent(100),
    };
  }

  function runCommand(body: unknown): AdminHttpResult {
    const parsed = parseCommand(body);
    if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } };

    try {
      const message = execute(parsed.command);
      // evento de teste já aparece no feed pelo próprio fluxo de `fx`
      if (parsed.command.cmd !== 'inject') log.system(`[ADMIN] ${message}`);
      logger.info({ cmd: parsed.command.cmd }, `admin: ${message}`);
      return { status: 200, body: { ok: true, message } };
    } catch (err) {
      return { status: 400, body: { ok: false, error: (err as Error).message } };
    }
  }

  return { getStatus, runCommand, dispose: stopBurst };
}
