import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logger } from '../logger.js';

const DEFAULT_DB_PATH = join(process.cwd(), 'data', 'reino.sqlite');

export interface UserStatPatch {
  userId: string;
  nickname: string;
  diamondValueDelta?: number;
  commentDelta?: number;
  likeDelta?: number;
  markHero?: boolean;
}

export interface LeaderboardEntry {
  userId: string;
  nickname: string;
  value: number;
}

export interface HeroEntry {
  userId: string;
  nickname: string;
  heroSince: number;
}

export interface HallOfFameEntry {
  day: number;
  archivedAt: number;
  topGifterNickname: string | null;
  topGifterValue: number;
  topChatterNickname: string | null;
  topChatterValue: number;
  waveReached: number;
}

/**
 * node:sqlite nativo (builtin do Node >=22) em vez de better-sqlite3 — evita
 * depender de Visual Studio/build tools pra compilar módulo nativo no Windows.
 * Ainda é experimental na API do Node, mas suficiente pro uso local aqui.
 */
export class Database {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
    logger.info({ path: dbPath }, 'SQLite pronto (WAL)');
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_stats (
        userId TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        totalDiamondValue INTEGER NOT NULL DEFAULT 0,
        totalComments INTEGER NOT NULL DEFAULT 0,
        totalLikes INTEGER NOT NULL DEFAULT 0,
        isHero INTEGER NOT NULL DEFAULT 0,
        heroSince INTEGER
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        userId TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        diamondValue INTEGER NOT NULL DEFAULT 0,
        comments INTEGER NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS hall_of_fame (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day INTEGER NOT NULL,
        archivedAt INTEGER NOT NULL,
        topGifterNickname TEXT,
        topGifterValue INTEGER NOT NULL DEFAULT 0,
        topChatterNickname TEXT,
        topChatterValue INTEGER NOT NULL DEFAULT 0,
        waveReached INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS game_snapshot (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        stateJson TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  getSetting<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value));
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  /** Atualiza o total vitalício (user_stats) e o total do dia (daily_stats) numa tacada só. */
  recordActivity(patch: UserStatPatch): void {
    this.upsertInto('user_stats', patch);
    this.upsertInto('daily_stats', patch);
  }

  private upsertInto(table: 'user_stats' | 'daily_stats', patch: UserStatPatch): void {
    const diamondCol = table === 'user_stats' ? 'totalDiamondValue' : 'diamondValue';
    const commentCol = table === 'user_stats' ? 'totalComments' : 'comments';
    const likeCol = table === 'user_stats' ? 'totalLikes' : 'likes';

    const existing = this.db.prepare(`SELECT userId FROM ${table} WHERE userId = ?`).get(patch.userId);

    if (!existing) {
      const heroCols = table === 'user_stats' ? ', isHero, heroSince' : '';
      const heroVals = table === 'user_stats' ? ', 0, NULL' : '';
      this.db
        .prepare(
          `INSERT INTO ${table} (userId, nickname, ${diamondCol}, ${commentCol}, ${likeCol}${heroCols})
           VALUES (?, ?, 0, 0, 0${heroVals})`,
        )
        .run(patch.userId, patch.nickname);
    }

    const heroSet = table === 'user_stats' ? ', isHero = CASE WHEN ? = 1 THEN 1 ELSE isHero END, heroSince = CASE WHEN ? = 1 AND heroSince IS NULL THEN ? ELSE heroSince END' : '';
    const heroArgs = table === 'user_stats' ? [patch.markHero ? 1 : 0, patch.markHero ? 1 : 0, Date.now()] : [];

    this.db
      .prepare(
        `UPDATE ${table} SET
           nickname = ?,
           ${diamondCol} = ${diamondCol} + ?,
           ${commentCol} = ${commentCol} + ?,
           ${likeCol} = ${likeCol} + ?
           ${heroSet}
         WHERE userId = ?`,
      )
      .run(
        patch.nickname,
        patch.diamondValueDelta ?? 0,
        patch.commentDelta ?? 0,
        patch.likeDelta ?? 0,
        ...heroArgs,
        patch.userId,
      );
  }

  getTopGifters(limit: number): LeaderboardEntry[] {
    return this.db
      .prepare(
        `SELECT userId, nickname, totalDiamondValue AS value FROM user_stats
         WHERE totalDiamondValue > 0 ORDER BY totalDiamondValue DESC LIMIT ?`,
      )
      .all(limit) as unknown as LeaderboardEntry[];
  }

  getTopChatters(limit: number): LeaderboardEntry[] {
    return this.db
      .prepare(
        `SELECT userId, nickname, totalComments AS value FROM user_stats
         WHERE totalComments > 0 ORDER BY totalComments DESC LIMIT ?`,
      )
      .all(limit) as unknown as LeaderboardEntry[];
  }

  getTodayTopGifters(limit: number): LeaderboardEntry[] {
    return this.db
      .prepare(
        `SELECT userId, nickname, diamondValue AS value FROM daily_stats
         WHERE diamondValue > 0 ORDER BY diamondValue DESC LIMIT ?`,
      )
      .all(limit) as unknown as LeaderboardEntry[];
  }

  getTodayTopChatters(limit: number): LeaderboardEntry[] {
    return this.db
      .prepare(
        `SELECT userId, nickname, comments AS value FROM daily_stats
         WHERE comments > 0 ORDER BY comments DESC LIMIT ?`,
      )
      .all(limit) as unknown as LeaderboardEntry[];
  }

  getRecentHeroes(limit: number): HeroEntry[] {
    return this.db
      .prepare(
        `SELECT userId, nickname, heroSince FROM user_stats
         WHERE isHero = 1 ORDER BY heroSince DESC LIMIT ?`,
      )
      .all(limit) as unknown as HeroEntry[];
  }

  getHeroCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM user_stats WHERE isHero = 1').get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  }

  /** Fecha o dia: arquiva o topo de hoje no Hall da Fama e zera o daily_stats pro próximo dia. */
  archiveDayAndReset(day: number, waveReached: number): void {
    const topGifter = this.getTodayTopGifters(1)[0];
    const topChatter = this.getTodayTopChatters(1)[0];

    this.db
      .prepare(
        `INSERT INTO hall_of_fame
           (day, archivedAt, topGifterNickname, topGifterValue, topChatterNickname, topChatterValue, waveReached)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        day,
        Date.now(),
        topGifter?.nickname ?? null,
        topGifter?.value ?? 0,
        topChatter?.nickname ?? null,
        topChatter?.value ?? 0,
        waveReached,
      );

    this.db.exec('DELETE FROM daily_stats');
  }

  getHallOfFame(limit: number): HallOfFameEntry[] {
    return this.db
      .prepare('SELECT * FROM hall_of_fame ORDER BY day DESC LIMIT ?')
      .all(limit) as unknown as HallOfFameEntry[];
  }

  saveSnapshot(state: unknown): void {
    this.db
      .prepare(
        `INSERT INTO game_snapshot (id, stateJson, updatedAt) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET stateJson = excluded.stateJson, updatedAt = excluded.updatedAt`,
      )
      .run(JSON.stringify(state), Date.now());
  }

  loadSnapshot<T>(): T | null {
    const row = this.db.prepare('SELECT stateJson FROM game_snapshot WHERE id = 1').get() as
      | { stateJson: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.stateJson) as T;
    } catch {
      return null;
    }
  }

  close(): void {
    this.db.close();
  }
}
