import { GameEngine } from './gameEngine/GameEngine.js';
import { logger } from './logger.js';
import type { GameEvent } from './types/GameEvent.js';

/**
 * Teste de carga isolado (sem WS/HTTP/DB) — só mede se o GameEngine aguenta
 * um pico de milhares de eventos/min sem travar, sem NaN e sem estado
 * inconsistente. Roda com: npm run loadtest
 */

const EVENTS_PER_BURST = Number(process.env.LOADTEST_EVENTS ?? 20_000);

function randomEvent(i: number): GameEvent {
  const user = { userId: `u${i % 500}`, username: `u${i % 500}`, nickname: `u${i % 500}` };
  const roll = i % 10;

  if (roll < 6) return { type: 'like', user, timestamp: Date.now(), likeCount: 1 + (i % 20) };
  if (roll < 8) return { type: 'comment', user, timestamp: Date.now(), comment: 'teste de carga' };
  if (roll === 8) {
    return {
      type: 'gift',
      user,
      timestamp: Date.now(),
      giftName: 'Rosa',
      totalDiamondValue: 1 + (i % 5000),
      repeatCount: 1,
      comboEnded: true,
    };
  }
  return { type: 'follow', user, timestamp: Date.now() };
}

function assertFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${label} não é finito: ${value}`);
}

function run(): void {
  const engine = new GameEngine();
  let narrativeCount = 0;
  engine.on('narrative', () => {
    narrativeCount += 1;
  });

  logger.info({ events: EVENTS_PER_BURST }, 'Disparando burst sincrono de eventos');
  const start = process.hrtime.bigint();

  for (let i = 0; i < EVENTS_PER_BURST; i += 1) {
    engine.handleEvent(randomEvent(i));
  }

  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const state = engine.getState();

  assertFinite('monsterHp', state.monsterHp);
  assertFinite('kingdomHp', state.kingdomHp);
  assertFinite('totalDiamondValue', state.totalDiamondValue);
  if (state.monsterHp < 0 || state.kingdomHp < 0) throw new Error('HP negativo — bug no clamp');
  if (state.wave < 1) throw new Error('wave inválida');

  const perSec = Math.round(EVENTS_PER_BURST / (elapsedMs / 1000));

  logger.info(
    {
      elapsedMs: Math.round(elapsedMs),
      eventsPerSec: perSec,
      finalWave: state.wave,
      finalEra: state.era.name,
      narrativeEvents: narrativeCount,
    },
    `OK — processou ${EVENTS_PER_BURST} eventos (equivalente a ${Math.round(perSec * 60).toLocaleString('pt-BR')} eventos/min sustentado)`,
  );
}

run();
