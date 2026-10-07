import { describe, expect, it } from 'vitest';
import { GameEngine } from './GameEngine.js';
import { DEFAULT_BALANCE } from './balance.js';
import type { GameEvent } from '../types/GameEvent.js';

function user(id = 'u1'): GameEvent['user'] {
  return { userId: id, username: id, nickname: id };
}

const like = (n = 10, isTest = false): GameEvent => ({
  type: 'like',
  user: user(),
  timestamp: Date.now(),
  likeCount: n,
  isTest,
});

describe('GameEngine admin actions', () => {
  it('adminSpawnBoss turns the current wave into a boss with scaled HP and emits bossSpawned', () => {
    const engine = new GameEngine();
    const narratives: string[] = [];
    engine.on('narrative', (e) => narratives.push(e.kind));
    const normalHp = engine.getState().monsterMaxHp;

    engine.adminSpawnBoss();

    const state = engine.getState();
    expect(state.isBoss).toBe(true);
    expect(state.monsterMaxHp).toBe(Math.round(normalHp * DEFAULT_BALANCE.bossHpMultiplier));
    expect(state.monsterHp).toBe(state.monsterMaxHp);
    expect(narratives).toContain('bossSpawned');
  });

  it('adminSetWave jumps to the wave (min 1) and respects the boss cadence', () => {
    const engine = new GameEngine();
    engine.adminSetWave(10);
    expect(engine.getState().wave).toBe(10);
    expect(engine.getState().isBoss).toBe(true); // 10 % 5 === 0

    engine.adminSetWave(-3);
    expect(engine.getState().wave).toBe(1);
    expect(engine.getState().isBoss).toBe(false);
  });

  it('adminHealKingdom caps at max; adminDamageKingdom to 0 triggers a fall immediately', () => {
    const engine = new GameEngine({ kingdomHp: 400, wave: 8 });
    engine.adminHealKingdom(100_000);
    expect(engine.getState().kingdomHp).toBe(engine.getState().kingdomMaxHp);

    let fell = false;
    engine.on('narrative', (e) => {
      if (e.kind === 'kingdomFall') fell = true;
    });
    engine.adminDamageKingdom(1_000_000);

    expect(fell).toBe(true);
    expect(engine.getState().wave).toBe(1);
    expect(engine.getState().kingdomHp).toBe(engine.getState().kingdomMaxHp);
  });

  it('adminEndSeason advances the day, resets the siege and emits seasonEnded + newSeason', () => {
    const engine = new GameEngine({ wave: 6, totalDiamondValue: 321 });
    const ended: Array<{ day: number; waveReached: number }> = [];
    const narratives: string[] = [];
    engine.on('seasonEnded', (i) => ended.push(i));
    engine.on('narrative', (e) => narratives.push(e.kind));

    engine.adminEndSeason();

    const state = engine.getState();
    expect(state.seasonDay).toBe(2);
    expect(state.wave).toBe(1);
    expect(state.totalDiamondValue).toBe(321);
    expect(ended).toEqual([{ day: 1, waveReached: 6 }]);
    expect(narratives).toContain('newSeason');
  });

  it('adminAddLifetimeScore raises the Era', () => {
    const engine = new GameEngine();
    expect(engine.getState().era.tier).toBe(0);
    engine.adminAddLifetimeScore(30_000);
    expect(engine.getState().era.tier).toBe(3);
  });
});

describe('GameEngine pause', () => {
  it('paused: events still emit fx but change no HP and no totals', () => {
    const engine = new GameEngine();
    const fx: string[] = [];
    engine.on('fx', (e) => fx.push(e.type));
    engine.setPaused(true);
    const before = engine.getState();

    engine.handleEvent(like(500));
    engine.handleEvent({ type: 'follow', user: user(), timestamp: Date.now() });

    const after = engine.getState();
    expect(fx).toEqual(['like', 'follow']);
    expect(after.monsterHp).toBe(before.monsterHp);
    expect(after.totalLikes).toBe(0);
    expect(after.totalFollows).toBe(0);
    expect(after.paused).toBe(true);
  });

  it('paused: ticks do not decay the kingdom, and resuming restores normal play', () => {
    const engine = new GameEngine();
    engine.setPaused(true);
    engine.simulateTicks(100);
    expect(engine.getState().kingdomHp).toBe(engine.getState().kingdomMaxHp);

    engine.setPaused(false);
    engine.simulateTicks(10);
    expect(engine.getState().kingdomHp).toBeLessThan(engine.getState().kingdomMaxHp);
  });
});

describe('GameEngine test events (isTest)', () => {
  it('damage the monster but do not count toward lifetime totals / Era', () => {
    const engine = new GameEngine();
    const before = engine.getState().monsterHp;

    engine.handleEvent(like(100, true));
    expect(engine.getState().monsterHp).toBeLessThan(before);

    engine.handleEvent({
      type: 'gift',
      user: user(),
      timestamp: Date.now(),
      totalDiamondValue: 5_000,
      isTest: true,
    });

    const state = engine.getState();
    expect(state.wave).toBeGreaterThan(1); // o gift de teste também causa dano de verdade
    expect(state.totalLikes).toBe(0);
    expect(state.totalGifts).toBe(0);
    expect(state.totalDiamondValue).toBe(0);
    expect(state.era.tier).toBe(0);
  });
});

describe('GameEngine balance', () => {
  it('setBalance applies valid patches and emits balanceChanged', () => {
    const engine = new GameEngine();
    let changed = 0;
    engine.on('balanceChanged', () => {
      changed += 1;
    });

    const result = engine.setBalance({ dmgPerLike: 5 });

    expect(result.ok).toBe(true);
    expect(engine.getBalance().dmgPerLike).toBe(5);
    expect(changed).toBe(1);

    const before = engine.getState().monsterHp;
    engine.handleEvent(like(10));
    expect(engine.getState().monsterHp).toBe(before - 50);
  });

  it('setBalance rejects invalid patches without changing anything', () => {
    const engine = new GameEngine();
    const result = engine.setBalance({ monsterHpGrowth: 9 });
    expect(result.ok).toBe(false);
    expect(engine.getBalance()).toEqual(DEFAULT_BALANCE);
  });

  it('changing kingdomMaxHp clamps current kingdom HP', () => {
    const engine = new GameEngine();
    engine.setBalance({ kingdomMaxHp: 500 });
    const state = engine.getState();
    expect(state.kingdomMaxHp).toBe(500);
    expect(state.kingdomHp).toBe(500);
  });

  it('resetBalance restores the defaults', () => {
    const engine = new GameEngine(undefined, { balance: { dmgPerLike: 7 } });
    expect(engine.getBalance().dmgPerLike).toBe(7);
    engine.resetBalance();
    expect(engine.getBalance()).toEqual(DEFAULT_BALANCE);
  });
});
