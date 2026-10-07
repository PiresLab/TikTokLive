import { describe, expect, it } from 'vitest';
import { GameEngine, type NarrativeEvent } from './GameEngine.js';
import { GoalTracker } from './goals.js';
import type { GameEvent } from '../types/GameEvent.js';

const user = { userId: 'u1', username: 'u1', nickname: 'u1' };
const ev = (type: GameEvent['type'], extra: Partial<GameEvent> = {}): GameEvent => ({ type, user, timestamp: Date.now(), ...extra });

describe('GoalTracker', () => {
  it('starts with a like goal and ignores other kinds', () => {
    const goals = new GoalTracker(0);
    expect(goals.current()).toMatchObject({ kind: 'like', target: 300, progress: 0 });
    expect(goals.add('comment', 10, 0)).toBeNull();
    expect(goals.current().progress).toBe(0);
  });

  it('completes, rotates to the next kind and resets progress', () => {
    const goals = new GoalTracker(0);
    expect(goals.add('like', 299, 120_000)).toBeNull();
    const done = goals.add('like', 5, 120_000);
    expect(done?.kind).toBe('like');
    expect(done?.reward).toEqual({ type: 'damage', pctOfMonster: 0.25 });
    expect(goals.current()).toMatchObject({ kind: 'comment', progress: 0, target: 30 });
  });

  it('raises the next same-kind target when a goal is beaten very fast', () => {
    const goals = new GoalTracker(0);
    goals.add('like', 300, 10_000); // 10s: rápido demais
    goals.add('comment', 30, 20_000);
    goals.add('follow', 5, 30_000);
    expect(goals.current()).toMatchObject({ kind: 'like', target: 450 }); // 300 * 1.5
  });

  it('never drops below the base target when goals are slow', () => {
    const goals = new GoalTracker(0);
    goals.add('like', 300, 700_000); // lento: multiplicador já está em 1, não cai abaixo
    goals.add('comment', 30, 1_400_000);
    goals.add('follow', 5, 2_100_000);
    expect(goals.current().target).toBe(300);
  });

  it('eases a stalled goal but not below base or current progress', () => {
    const goals = new GoalTracker(0);
    goals.add('like', 300, 10_000); // alvo da próxima curtida: 450
    goals.add('comment', 30, 20_000);
    goals.add('follow', 5, 30_000);
    expect(goals.current().target).toBe(450);
    goals.add('like', 100, 31_000);
    goals.tick(31_000 + 601_000);
    expect(goals.current().target).toBe(315); // 450 * 0.7
    goals.tick(31_000 + 601_000 + 601_000);
    expect(goals.current().target).toBe(300); // piso = base
  });
});

describe('GameEngine goals', () => {
  it('counts likes by likeCount and fires goalCompleted with the reward', () => {
    const engine = new GameEngine();
    const narratives: NarrativeEvent[] = [];
    engine.on('narrative', (n: NarrativeEvent) => narratives.push(n));
    const before = engine.getState().monsterHp;

    engine.handleEvent(ev('like', { likeCount: 299 }));
    expect(engine.getState().goal.progress).toBe(299);
    engine.handleEvent(ev('like', { likeCount: 1 }));

    const goalEvent = narratives.find((n) => n.kind === 'goalCompleted');
    expect(goalEvent).toMatchObject({ kind: 'goalCompleted', reward: 'damage' });
    expect(engine.getState().goal.kind).toBe('comment');
    // 300 curtidas * 0.3 = 90 de dano + golpe de 25% do HP máximo (38)
    expect(before).toBe(150);
    expect(engine.getState().monsterHp).toBe(150 - 90 - 38);
  });

  it('heals the kingdom when a comment goal completes', () => {
    const engine = new GameEngine();
    // pula a meta de curtidas
    engine.handleEvent(ev('like', { likeCount: 300 }));
    engine.adminDamageKingdom(400);
    const hpBefore = engine.getState().kingdomHp;
    for (let i = 0; i < 30; i += 1) engine.handleEvent(ev('comment', { comment: 'oi' }));
    expect(engine.getState().kingdomHp).toBeGreaterThanOrEqual(hpBefore + 150 - 1);
    expect(engine.getState().goal.kind).toBe('follow');
  });

  it('does not progress while paused and ignores gifts', () => {
    const engine = new GameEngine();
    engine.setPaused(true);
    engine.handleEvent(ev('like', { likeCount: 50 }));
    expect(engine.getState().goal.progress).toBe(0);
    engine.setPaused(false);
    engine.handleEvent(ev('gift', { totalDiamondValue: 10 }));
    expect(engine.getState().goal.progress).toBe(0);
  });
});
