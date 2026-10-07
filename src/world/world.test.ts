import { describe, expect, it } from 'vitest';
import { GameEngine, type NarrativeEvent } from '../gameEngine/GameEngine.js';
import type { GameEvent } from '../types/GameEvent.js';
import { parseCommand } from '../admin/commands.js';
import { WorldDirector, EVENT_INTERVAL_MAX_MS, EVENT_INTERVAL_MIN_MS } from './director.js';
import { MODIFIER_RANGES, modifiersFor, NEUTRAL_MODIFIERS } from './events.js';
import { WeatherMachine, WEATHER_MAX_MS, WEATHER_MIN_MS } from './weather.js';
import { worldClock } from './worldClock.js';

const HOUR = 3_600_000;
const user = { userId: 'u1', username: 'u1', nickname: 'u1' };
const ev = (type: GameEvent['type'], extra: Partial<GameEvent> = {}): GameEvent => ({ type, user, timestamp: 0, ...extra });

/** RNG determinístico (LCG) pra os testes não dependerem de sorte. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('worldClock', () => {
  it('starts at sunrise, peaks at midday of the first half, sets at 0.5 and is night after', () => {
    const day = 24 * HOUR;
    expect(worldClock(0, 0, day)).toMatchObject({ timeOfDay: 0, phase: 'dawn' });
    expect(worldClock(day * 0.25, 0, day)).toMatchObject({ phase: 'day' });
    expect(worldClock(day * 0.25, 0, day).sunHeight).toBeCloseTo(1, 5);
    expect(worldClock(day * 0.5, 0, day).phase).toBe('dusk');
    expect(worldClock(day * 0.75, 0, day)).toMatchObject({ phase: 'night' });
    expect(worldClock(day * 0.99, 0, day).phase).toBe('dawn');
  });
  it('wraps around and never goes negative', () => {
    const t = worldClock(5.3 * HOUR, 0, 2 * HOUR).timeOfDay;
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1);
    expect(worldClock(-1000, 0, HOUR).timeOfDay).toBeGreaterThanOrEqual(0);
  });
});

describe('WeatherMachine', () => {
  it('changes only after its duration (3 to 8 minutes) and never goes to storm without rain first', () => {
    const rng = seeded(7);
    const machine = new WeatherMachine(rng, 0);
    let now = 0;
    let previous = machine.state().kind;
    for (let i = 0; i < 400; i += 1) {
      now += 30_000;
      const changed = machine.tick(now);
      if (changed) {
        expect(changed.until - changed.since).toBeGreaterThanOrEqual(WEATHER_MIN_MS);
        expect(changed.until - changed.since).toBeLessThanOrEqual(WEATHER_MAX_MS);
        if (changed.kind === 'storm') expect(previous).toBe('rain');
        previous = changed.kind;
      }
    }
  });
  it('can be forced by the admin', () => {
    const machine = new WeatherMachine(seeded(1), 0);
    expect(machine.force('snow', 1000).kind).toBe('snow');
    expect(machine.state().kind).toBe('snow');
  });
});

describe('modifiers', () => {
  it('are neutral with no event and always inside their safe ranges', () => {
    expect(modifiersFor(null, undefined)).toEqual(NEUTRAL_MODIFIERS);
    for (const timed of [null, 'bloodMoon', 'dawnBlessing'] as const) {
      for (const affix of [undefined, 'armored'] as const) {
        const m = modifiersFor(timed, affix);
        for (const key of Object.keys(m) as Array<keyof typeof m>) {
          expect(m[key]).toBeGreaterThanOrEqual(MODIFIER_RANGES[key][0]);
          expect(m[key]).toBeLessThanOrEqual(MODIFIER_RANGES[key][1]);
        }
      }
    }
  });
  it('encode the designed trade-offs', () => {
    expect(modifiersFor('bloodMoon', undefined)).toMatchObject({ like: 1.5, comment: 1.5, decay: 2 });
    expect(modifiersFor('dawnBlessing', undefined)).toMatchObject({ gift: 1.25, regen: 1.5 });
    expect(modifiersFor(null, 'armored')).toMatchObject({ like: 0.5, comment: 2 });
  });
});

describe('WorldDirector', () => {
  const ctx = { monsterTagged: false, isBoss: false, seasonStartedAt: 0, seasonDurationMs: 24 * HOUR };

  it('schedules one event every 8 to 15 minutes and never two at once', () => {
    const director = new WorldDirector(seeded(3), 0);
    const starts: number[] = [];
    let now = 0;
    let activeCount = 0;
    for (let i = 0; i < 6 * 3600; i += 1) {
      now += 1000;
      const out = director.tick(now, ctx);
      if (out.started) starts.push(now);
      activeCount = director.activeEvent() ? 1 : 0;
      expect(activeCount).toBeLessThanOrEqual(1);
    }
    expect(starts.length).toBeGreaterThan(10);
    for (let i = 1; i < starts.length; i += 1) {
      const gap = starts[i] - starts[i - 1];
      expect(gap).toBeGreaterThanOrEqual(EVENT_INTERVAL_MIN_MS - 1000);
      expect(gap).toBeLessThanOrEqual(EVENT_INTERVAL_MAX_MS + 120_000 + 60_000);
    }
  });

  it('does not start a monster event while a tagged monster is in the field, nor horde/elite over a boss', () => {
    const director = new WorldDirector(seeded(5), 0);
    const out = director.tick(EVENT_INTERVAL_MAX_MS + 1000, { ...ctx, monsterTagged: true });
    expect(out.started).toBeUndefined();

    for (let seed = 1; seed < 60; seed += 1) {
      const d = new WorldDirector(seeded(seed), 0);
      const r = d.tick(EVENT_INTERVAL_MAX_MS + 1000, { ...ctx, isBoss: true });
      if (r.started) expect(['bloodMoon', 'dawnBlessing']).toContain(r.started);
    }
  });

  it('ends a timed event when its time is up', () => {
    const director = new WorldDirector(seeded(2), 0);
    director.begin('bloodMoon', 0);
    expect(director.activeEvent()?.kind).toBe('bloodMoon');
    expect(director.tick(119_000, ctx).ended).toBeUndefined();
    expect(director.tick(121_000, ctx).ended?.kind).toBe('bloodMoon');
    expect(director.activeEvent()).toBeNull();
  });
});

describe('GameEngine world integration', () => {
  function makeEngine(startWave = 1) {
    let t = 0;
    const engine = new GameEngine({ wave: startWave }, { now: () => t, rng: seeded(11), seasonDurationMs: 24 * HOUR });
    return { engine, advance: (ms: number) => { t += ms; }, narratives: (() => { const list: NarrativeEvent[] = []; engine.on('narrative', (n: NarrativeEvent) => list.push(n)); return list; })() };
  }

  it('exposes the world state in getState', () => {
    const { engine } = makeEngine();
    const { world } = engine.getState();
    expect(world).toMatchObject({ phase: 'dawn', weather: 'clear', event: null });
  });

  it('Blood Moon boosts like damage x1.5 and doubles the kingdom decay, then ends', () => {
    const { engine, advance, narratives } = makeEngine();
    expect(engine.adminTriggerEvent('bloodMoon')).toBe('Lua de Sangue');
    expect(narratives.some((n) => n.kind === 'eventStarted' && n.event === 'bloodMoon')).toBe(true);

    const hp = engine.getState().monsterHp;
    engine.handleEvent(ev('like', { likeCount: 10 }));
    expect(hp - engine.getState().monsterHp).toBeCloseTo(10 * 0.3 * 1.5, 5);

    const before = engine.getState().kingdomHp;
    engine.simulateTicks(1);
    expect(before - engine.getState().kingdomHp).toBeCloseTo(0.35 * 2, 5);

    advance(121_000);
    engine.simulateTicks(1);
    expect(narratives.some((n) => n.kind === 'eventEnded' && n.event === 'bloodMoon')).toBe(true);
    expect(engine.getModifiers()).toEqual(NEUTRAL_MODIFIERS);
  });

  it('Dawn Blessing heals the kingdom gradually', () => {
    const { engine } = makeEngine();
    engine.adminDamageKingdom(300);
    engine.adminTriggerEvent('dawnBlessing');
    const before = engine.getState().kingdomHp;
    engine.simulateTicks(10);
    expect(engine.getState().kingdomHp).toBeGreaterThan(before + 10);
  });

  it('Horde shares one bigger health bar and is cleared when the monster dies', () => {
    const { engine } = makeEngine();
    const normalHp = engine.getState().monsterMaxHp;
    engine.adminTriggerEvent('horde');
    const s = engine.getState();
    expect(s.horde).toBe(5);
    expect(s.monsterMaxHp).toBe(Math.round(normalHp * 2.5));
    expect(s.isBoss).toBe(false);
    expect(() => engine.adminTriggerEvent('horde')).toThrow();

    engine.handleEvent(ev('gift', { totalDiamondValue: 10_000 }));
    expect(engine.getState().horde).toBeUndefined();
    expect(engine.getState().wave).toBeGreaterThan(1);
  });

  it('Elite boss is armored: likes count half, comments double, and the affix clears on death', () => {
    const { engine, narratives } = makeEngine();
    engine.adminTriggerEvent('eliteBoss');
    const s = engine.getState();
    expect(s.isBoss).toBe(true);
    expect(s.affix).toBe('armored');
    expect(narratives.some((n) => n.kind === 'bossSpawned')).toBe(true);

    const hp = s.monsterHp;
    engine.handleEvent(ev('like', { likeCount: 10 }));
    expect(hp - engine.getState().monsterHp).toBeCloseTo(10 * 0.3 * 0.5, 5);
    const hp2 = engine.getState().monsterHp;
    engine.handleEvent(ev('comment', { comment: 'oi' }));
    expect(hp2 - engine.getState().monsterHp).toBeCloseTo(3 * 2, 5);

    engine.handleEvent(ev('gift', { totalDiamondValue: 1_000_000 }));
    expect(engine.getState().affix).toBeUndefined();
  });

  it('a pending horde does not stop a forced boss from clearing the horde flag', () => {
    const { engine } = makeEngine();
    engine.adminTriggerEvent('horde');
    engine.adminSpawnBoss();
    expect(engine.getState().horde).toBeUndefined();
  });

  it('long-run balance: random events never create a multi-hour wall (virtual clock, same damage as the regression test)', () => {
    let t = 0;
    const engine = new GameEngine(undefined, { now: () => t, rng: seeded(99), seasonDurationMs: 24 * HOUR });
    const wavePerHour: number[] = [];
    for (let hour = 0; hour < 6; hour += 1) {
      for (let min = 0; min < 60; min += 1) {
        engine.handleEvent(ev('gift', { totalDiamondValue: 300, comboEnded: true }));
        engine.handleEvent(ev('follow'));
        for (let sec = 0; sec < 60; sec += 1) {
          t += 1000;
          engine.simulateTicks(1);
        }
      }
      wavePerHour.push(engine.getState().wave);
    }
    expect(engine.getState().wave).toBeGreaterThan(25);
    for (let i = 1; i < wavePerHour.length; i += 1) expect(wavePerHour[i]).toBeGreaterThan(wavePerHour[i - 1]);
  });
});

describe('admin commands for the world', () => {
  it('validates triggerEvent and setWeather', () => {
    expect(parseCommand({ cmd: 'triggerEvent', event: 'horde' })).toEqual({ ok: true, command: { cmd: 'triggerEvent', event: 'horde' } });
    expect(parseCommand({ cmd: 'triggerEvent', event: 'meteoro' }).ok).toBe(false);
    expect(parseCommand({ cmd: 'setWeather', weather: 'storm' })).toEqual({ ok: true, command: { cmd: 'setWeather', weather: 'storm' } });
    expect(parseCommand({ cmd: 'setWeather', weather: 'tornado' }).ok).toBe(false);
  });
});
