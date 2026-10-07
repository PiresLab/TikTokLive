import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../persistence/db.js';
import type { GameEvent } from '../types/GameEvent.js';
import { classFor } from './classes.js';
import { levelForXp, xpToReach } from './levels.js';
import { missionsFor } from './missions.js';
import { ProgressionService, type ProgressMessage } from './ProgressionService.js';
import { xpForEvent } from './xp.js';

const user = (id = 'u1', nickname = 'Ana'): GameEvent['user'] => ({ userId: id, username: id, nickname });
const ev = (type: GameEvent['type'], extra: Partial<GameEvent> = {}, u = user()): GameEvent => ({ type, user: u, timestamp: Date.now(), ...extra });

describe('levels and xp', () => {
  it('uses the same weights as the kingdom lifetime score', () => {
    expect(xpForEvent(ev('like', { likeCount: 10 }))).toBe(1);
    expect(xpForEvent(ev('comment'))).toBe(2);
    expect(xpForEvent(ev('follow'))).toBe(10);
    expect(xpForEvent(ev('share'))).toBe(15);
    expect(xpForEvent(ev('gift', { totalDiamondValue: 300 }))).toBe(300);
  });

  it('level thresholds are strictly increasing and levelForXp is consistent with them', () => {
    for (let level = 1; level < 60; level += 1) expect(xpToReach(level + 1)).toBeGreaterThan(xpToReach(level));
    for (const level of [1, 2, 5, 10, 25, 40]) expect(levelForXp(xpToReach(level)).level).toBe(level);
    expect(levelForXp(xpToReach(10) - 1).level).toBe(9);
  });

  it('maps level bands to titles', () => {
    expect(levelForXp(0).title).toBe('Recruta');
    expect(levelForXp(xpToReach(5)).title).toBe('Soldado');
    expect(levelForXp(xpToReach(10)).title).toBe('Cavaleiro');
    expect(levelForXp(xpToReach(40)).title).toBe('Lenda');
    expect(levelForXp(xpToReach(40)).titleIndex).toBe(5);
  });

  it('reports progress inside the current level', () => {
    const info = levelForXp(xpToReach(3) + (xpToReach(4) - xpToReach(3)) / 2);
    expect(info.level).toBe(3);
    expect(info.progress).toBeCloseTo(0.5, 1);
  });
});

describe('classes', () => {
  const base = { totalLikes: 0, totalComments: 0, totalDiamondValue: 0, totalFollows: 0, totalShares: 0 };
  it('picks the class by dominant weighted contribution', () => {
    expect(classFor({ ...base, totalLikes: 5000 })).toBe('knight');
    expect(classFor({ ...base, totalComments: 400 })).toBe('archer');
    expect(classFor({ ...base, totalDiamondValue: 2000 })).toBe('mage');
    expect(classFor({ ...base, totalFollows: 1, totalShares: 5 })).toBe('guardian');
  });
  it('a fresh follower is a guardian and an empty profile defaults to knight', () => {
    expect(classFor({ ...base, totalFollows: 1 })).toBe('guardian');
    expect(classFor(base)).toBe('knight');
  });
});

describe('missions', () => {
  it('is deterministic per user and day, gives 3 distinct kinds and never asks for a follow', () => {
    const a = missionsFor('u1', 4);
    expect(missionsFor('u1', 4)).toEqual(a);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((m) => m.kind)).size).toBe(3);
    expect(a.every((m) => (m.kind as string) !== 'follow')).toBe(true);
  });
  it('changes across days for the same user', () => {
    const days = new Set(Array.from({ length: 12 }, (_, d) => missionsFor('u1', d).map((m) => m.id).join(',')));
    expect(days.size).toBeGreaterThan(1);
  });
});

describe('ProgressionService', () => {
  let dir: string;
  let db: Database;
  let day: number;
  let today: string;
  let service: ProgressionService;
  let messages: ProgressMessage[];

  /** Simula o app: o banco registra a atividade e depois a progressão processa o mesmo evento. */
  const feed = (event: GameEvent) => {
    switch (event.type) {
      case 'comment':
        db.recordActivity({ userId: event.user.userId, nickname: event.user.nickname, commentDelta: 1 });
        break;
      case 'like':
        db.recordActivity({ userId: event.user.userId, nickname: event.user.nickname, likeDelta: event.likeCount ?? 1 });
        break;
      case 'gift':
        db.recordActivity({ userId: event.user.userId, nickname: event.user.nickname, diamondValueDelta: event.totalDiamondValue ?? 0 });
        break;
      case 'follow':
        db.recordActivity({ userId: event.user.userId, nickname: event.user.nickname, markHero: true });
        break;
      default:
        db.recordActivity({ userId: event.user.userId, nickname: event.user.nickname });
    }
    service.handleEvent(event);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reino-prog-'));
    db = new Database(join(dir, 'test.sqlite'));
    day = 1;
    today = '2026-01-01';
    service = new ProgressionService(db, { getDay: () => day, today: () => today });
    messages = [];
    service.on('progress', (m: ProgressMessage) => messages.push(m));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('accumulates xp, follows and shares, and unlocks first-time achievements', () => {
    feed(ev('follow'));
    feed(ev('share'));
    const p = db.getProgress('u1');
    expect(p).toMatchObject({ totalFollows: 1, totalShares: 1, isHero: 1 });
    // 10 (follow) + 15 (share) + bônus da missão de compartilhar, se ela caiu pra essa pessoa hoje
    const shareBonus = missionsFor('u1', 1).find((m) => m.kind === 'share')?.xp ?? 0;
    expect(p?.xp).toBe(25 + shareBonus);
    const ids = messages.filter((m) => m.kind === 'achievement').map((m) => (m as { id: string }).id);
    expect(ids).toEqual(expect.arrayContaining(['first_follow', 'herald']));
  });

  it('never repeats an achievement', () => {
    feed(ev('follow'));
    feed(ev('follow'));
    expect(messages.filter((m) => m.kind === 'achievement' && (m as { id: string }).id === 'first_follow')).toHaveLength(1);
  });

  it('tracks the hero class as the player changes what they do', () => {
    expect(service.classOf('ghost')).toBe('knight');
    feed(ev('follow'));
    expect(service.classOf('u1')).toBe('guardian');
    for (let i = 0; i < 40; i += 1) feed(ev('comment', { comment: 'oi' }));
    expect(service.classOf('u1')).toBe('archer');
  });

  it('emits levelUp once when xp crosses a level and reports the class', () => {
    feed(ev('gift', { totalDiamondValue: 400 })); // 400 xp = nível 5 (Soldado)
    const level = messages.find((m) => m.kind === 'levelUp');
    expect(level).toMatchObject({ kind: 'levelUp', level: 5, title: 'Soldado', classKey: 'mage' });
    expect(service.levelOf('u1')).toBe(5);
  });

  it('completes a daily mission, awards bonus xp and renews on the next day', () => {
    const def = missionsFor('u1', 1).find((m) => m.kind === 'comment' || m.kind === 'like') as ReturnType<typeof missionsFor>[number];
    const type = def.kind === 'comment' ? 'comment' : 'like';
    for (let i = 0; i < def.target; i += 1) feed(ev(type, type === 'like' ? { likeCount: 1 } : { comment: 'oi' }));
    expect(messages.some((m) => m.kind === 'mission')).toBe(true);
    const card = service.getProfile('u1');
    expect(card?.missions.find((m) => m.title === def.title)).toMatchObject({ done: true, progress: def.target });

    day = 2;
    expect(service.getProfile('u1')?.missions.every((m) => !m.done)).toBe(true);
  });

  it('counts active days only once per calendar day', () => {
    feed(ev('comment'));
    feed(ev('comment'));
    today = '2026-01-02';
    feed(ev('comment'));
    expect(db.getProgress('u1')?.daysActive).toBe(2);
  });

  it('ignores admin test events', () => {
    feed(ev('gift', { totalDiamondValue: 5000, isTest: true }));
    expect(db.getProgress('u1')?.xp ?? 0).toBe(0);
    expect(messages).toHaveLength(0);
  });

  it('grants the boss slayer achievement and grantXp / resetAll work', () => {
    feed(ev('comment'));
    service.handleBossDefeated({ userId: 'u1', nickname: 'Ana' });
    expect(messages.some((m) => m.kind === 'achievement' && (m as { id: string }).id === 'boss_slayer')).toBe(true);

    expect(service.grantXp('Ana', 100)).toContain('Ana');
    expect(db.getProgress('u1')?.xp).toBe(102);
    expect(() => service.grantXp('Ninguém', 1)).toThrow();

    service.resetAll();
    expect(db.getProgress('u1')?.xp).toBe(0);
    expect(db.getAchievements('u1')).toHaveLength(0);
  });

  it('picks heroes for display: top xp plus the most recent, without duplicates', () => {
    for (let i = 0; i < 6; i += 1) {
      const u = user(`h${i}`, `Her${i}`);
      db.recordActivity({ userId: u.userId, nickname: u.nickname, markHero: true });
      db.addProgress(u.userId, u.nickname, { xpDelta: i === 0 ? 5000 : i });
    }
    const shown = db.getHeroesForDisplay(2, 2).map((h) => h.userId);
    expect(shown).toHaveLength(4);
    expect(new Set(shown).size).toBe(4);
    expect(shown).toContain('h0'); // o de maior XP, mesmo sendo o mais antigo
  });
});

describe('database migration', () => {
  it('upgrades a database created before the progression columns without losing data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reino-mig-'));
    const path = join(dir, 'old.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE user_stats (userId TEXT PRIMARY KEY, nickname TEXT NOT NULL, totalDiamondValue INTEGER NOT NULL DEFAULT 0,
      totalComments INTEGER NOT NULL DEFAULT 0, totalLikes INTEGER NOT NULL DEFAULT 0, isHero INTEGER NOT NULL DEFAULT 0, heroSince INTEGER);
      INSERT INTO user_stats (userId, nickname, totalComments, totalLikes) VALUES ('old', 'Veterana', 7, 90);`);
    old.close();

    const db = new Database(path);
    expect(db.getProgress('old')).toMatchObject({ nickname: 'Veterana', totalComments: 7, totalLikes: 90, xp: 0, totalFollows: 0 });
    db.addProgress('old', 'Veterana', { xpDelta: 12 });
    expect(db.getProgress('old')?.xp).toBe(12);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
