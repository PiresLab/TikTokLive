import { describe, expect, it } from 'vitest';
import { GameEngine } from './GameEngine.js';
import type { GameEvent } from '../types/GameEvent.js';

function user(id = 'u1'): GameEvent['user'] {
  return { userId: id, username: id, nickname: id };
}

describe('GameEngine', () => {
  it('monster HP growth stays sustainable — no multi-hour wall under fixed moderate damage (Fase 5 balance regression)', () => {
    // Regressão de um bug real: com MONSTER_HP_GROWTH=1.18 (valor original), a
    // simulação de 24h (npm run balance) travava 6h seguidas na onda 30 (chefão
    // de ~109k HP) antes do Reino cair. Dano fixo e determinístico aqui (sem
    // aleatoriedade) — 150 de dano/min por 6h simuladas — tem que avançar bem
    // além da onda 30 sem nenhuma hora de estagnação total.
    const engine = new GameEngine();
    const wavePerHour: number[] = [];

    for (let hour = 0; hour < 6; hour += 1) {
      for (let min = 0; min < 60; min += 1) {
        engine.handleEvent({
          type: 'gift',
          user: user(),
          timestamp: Date.now(),
          totalDiamondValue: 300, // DMG_PER_DIAMOND=0.5 -> 150 dano/min
          repeatCount: 1,
          comboEnded: true,
        });
        // sem follow pra curar o Reino, dano puro de gift derruba o cerco por
        // decaimento (mecânica separada, testada em "emits kingdomFall..."),
        // o que mascara o que este teste quer isolar: só o crescimento do
        // monstro. 1 follow/min mantém o Reino de pé sem interferir no dano.
        engine.handleEvent({ type: 'follow', user: user(), timestamp: Date.now() });
        engine.simulateTicks(60);
      }
      wavePerHour.push(engine.getState().wave);
    }

    expect(engine.getState().wave).toBeGreaterThan(30);
    for (let i = 1; i < wavePerHour.length; i += 1) {
      expect(wavePerHour[i]).toBeGreaterThan(wavePerHour[i - 1]);
    }
  });

  it('starts with wave 1, season day 1 and full kingdom HP', () => {
    const state = new GameEngine().getState();
    expect(state.wave).toBe(1);
    expect(state.seasonDay).toBe(1);
    expect(state.kingdomHp).toBe(state.kingdomMaxHp);
    expect(state.monsterHp).toBe(state.monsterMaxHp);
    expect(state.era.tier).toBe(0);
  });

  it('era tier rises with lifetime score and never resets on kingdom fall', () => {
    const engine = new GameEngine();
    engine.handleEvent({
      type: 'gift',
      user: user(),
      timestamp: Date.now(),
      totalDiamondValue: 6_000,
    });
    const afterGift = engine.getState();
    expect(afterGift.era.tier).toBeGreaterThanOrEqual(2);

    const forced = new GameEngine({ ...afterGift, kingdomHp: 0.1 });
    forced.start();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        forced.stop();
        expect(forced.getState().era.tier).toBe(afterGift.era.tier);
        resolve();
      }, 1200);
    });
  });

  it('rolls over to a new season day after seasonDurationMs, preserving totals', () => {
    const engine = new GameEngine(
      { wave: 3, totalDiamondValue: 777 },
      { seasonDurationMs: 100 },
    );
    const seasonEndedPayloads: Array<{ day: number; waveReached: number }> = [];
    const newSeasonNarratives: Array<{ day: number }> = [];
    engine.on('seasonEnded', (info) => seasonEndedPayloads.push(info));
    engine.on('narrative', (e) => {
      if (e.kind === 'newSeason') newSeasonNarratives.push(e);
    });

    engine.start();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        engine.stop();
        const state = engine.getState();
        expect(state.seasonDay).toBe(2);
        expect(state.wave).toBe(1);
        expect(state.totalDiamondValue).toBe(777);
        expect(seasonEndedPayloads).toEqual([{ day: 1, waveReached: 3 }]);
        expect(newSeasonNarratives[0]?.day).toBe(2);
        resolve();
      }, 1200);
    });
  });

  it('like chips monster HP proportionally to likeCount', () => {
    const engine = new GameEngine();
    const before = engine.getState().monsterHp;
    engine.handleEvent({ type: 'like', user: user(), timestamp: Date.now(), likeCount: 10 });
    expect(engine.getState().monsterHp).toBeLessThan(before);
    expect(engine.getState().totalLikes).toBe(10);
  });

  it('gift damage scales with totalDiamondValue and tracks totals', () => {
    const engine = new GameEngine();
    const before = engine.getState().monsterHp;
    engine.handleEvent({
      type: 'gift',
      user: user(),
      timestamp: Date.now(),
      giftName: 'Rosa',
      totalDiamondValue: 50,
      repeatCount: 1,
      comboEnded: true,
    });
    const state = engine.getState();
    expect(state.monsterHp).toBeLessThan(before);
    expect(state.totalGifts).toBe(1);
    expect(state.totalDiamondValue).toBe(50);
  });

  it('follow heals the kingdom instead of damaging the monster', () => {
    const damaged = { ...new GameEngine().getState(), kingdomHp: 500 };
    const engine = new GameEngine(damaged);
    engine.handleEvent({ type: 'like', user: user(), timestamp: Date.now(), likeCount: 50 });
    const monsterHpAfterLike = engine.getState().monsterHp;
    const kingdomBefore = engine.getState().kingdomHp;

    engine.handleEvent({ type: 'follow', user: user(), timestamp: Date.now() });
    const state = engine.getState();

    expect(state.monsterHp).toBe(monsterHpAfterLike);
    expect(state.kingdomHp).toBeGreaterThan(kingdomBefore);
    expect(state.totalFollows).toBe(1);
  });

  it('advances wave and heals kingdom when the monster is defeated', () => {
    const engine = new GameEngine();
    const waveCleared: number[] = [];
    engine.on('narrative', (e) => {
      if (e.kind === 'waveCleared') waveCleared.push(e.wave);
    });

    let guard = 0;
    while (engine.getState().wave === 1 && guard < 10_000) {
      engine.handleEvent({ type: 'gift', user: user(), timestamp: Date.now(), totalDiamondValue: 50 });
      guard += 1;
    }

    expect(engine.getState().wave).toBe(2);
    expect(waveCleared).toEqual([1]);
  });

  it('every 5th wave is a boss with scaled HP', () => {
    const engine = new GameEngine();
    let guard = 0;
    // hp>0 some waves depois de vencidas (monstro seguinte já nasce com HP positivo),
    // então o critério de parada tem que ser a onda alvo, não "monstro morto".
    while (engine.getState().wave < 5 && guard < 100_000) {
      engine.handleEvent({ type: 'gift', user: user(), timestamp: Date.now(), totalDiamondValue: 100 });
      guard += 1;
    }
    const state = engine.getState();
    expect(state.wave).toBe(5);
    expect(state.isBoss).toBe(true);
  });

  it('emits kingdomFall and resets to wave 1 when kingdom HP hits 0', () => {
    const initial = {
      wave: 7,
      isBoss: false,
      monsterName: 'Teste',
      monsterHp: 999,
      monsterMaxHp: 999,
      kingdomHp: 0.1,
      kingdomMaxHp: 1000,
      totalLikes: 0,
      totalComments: 0,
      totalGifts: 0,
      totalDiamondValue: 0,
      totalFollows: 0,
      totalShares: 0,
    };
    const engine = new GameEngine(initial);
    let fell = false;
    engine.on('narrative', (e) => {
      if (e.kind === 'kingdomFall') fell = true;
    });

    engine.start();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        engine.stop();
        expect(fell).toBe(true);
        expect(engine.getState().wave).toBe(1);
        expect(engine.getState().kingdomHp).toBe(engine.getState().kingdomMaxHp);
        resolve();
      }, 1200);
    });
  });

  it('preserves lifetime totals across a kingdom fall', () => {
    const engine = new GameEngine();
    engine.handleEvent({ type: 'like', user: user(), timestamp: Date.now(), likeCount: 7 });
    engine.handleEvent({
      type: 'gift',
      user: user(),
      timestamp: Date.now(),
      totalDiamondValue: 30,
    });

    // força queda do reino direto no estado interno via snapshot + novo engine
    const forced = new GameEngine({ ...engine.getState(), kingdomHp: 0.1 });
    forced.start();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        forced.stop();
        const state = forced.getState();
        expect(state.totalLikes).toBe(7);
        expect(state.totalDiamondValue).toBe(30);
        expect(state.wave).toBe(1);
        resolve();
      }, 1200);
    });
  });
});
