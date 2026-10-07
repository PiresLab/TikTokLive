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
  /** Nível de progressão do usuário (preenchido pelo app, não pelo banco). */
  level?: number;
}

/** Linha de user_stats com tudo que a progressão precisa. */
export interface UserProgress {
  userId: string;
  nickname: string;
  totalDiamondValue: number;
  totalComments: number;
  totalLikes: number;
  totalFollows: number;
  totalShares: number;
  xp: number;
  daysActive: number;
  lastSeenDate: string | null;
  isHero: number;
  heroSince: number | null;
}

export interface MissionRow {
  missionId: string;
  progress: number;
  done: number;
}

export interface ProgressPatch {
  followDelta?: number;
  shareDelta?: number;
  xpDelta?: number;
  /** Data de hoje (AAAA-MM-DD): conta 1 dia ativo quando muda. */
  date?: string;
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
const PROGRESS_COLUMNS =
  'userId, nickname, totalDiamondValue, totalComments, totalLikes, totalFollows, totalShares, xp, daysActive, lastSeenDate, isHero, heroSince';

export class Database {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    // WAL + synchronous NORMAL é o par recomendado: um corte de energia pode perder os últimos instantes, nunca corrompe o banco,
    // e evita um fsync por instrução (os totais de ranking/progressão são gravados a cada evento).
    this.db.exec('PRAGMA synchronous = NORMAL');
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

      CREATE TABLE IF NOT EXISTS user_missions (
        userId TEXT NOT NULL,
        day INTEGER NOT NULL,
        missionId TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (userId, day, missionId)
      );

      CREATE TABLE IF NOT EXISTS user_achievements (
        userId TEXT NOT NULL,
        achievementId TEXT NOT NULL,
        unlockedAt INTEGER NOT NULL,
        PRIMARY KEY (userId, achievementId)
      );
    `);

    // bancos criados antes da progressão: adiciona as colunas novas sem perder nada
    this.ensureColumn('user_stats', 'totalFollows', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('user_stats', 'totalShares', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('user_stats', 'xp', 'REAL NOT NULL DEFAULT 0');
    this.ensureColumn('user_stats', 'daysActive', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('user_stats', 'lastSeenDate', 'TEXT');
  }

  private ensureColumn(table: string, column: string, ddl: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
    if (!columns.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
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

  // ---- progressão (nível, missões, conquistas) ----

  /** Soma XP/follows/shares e conta o dia ativo; cria a linha do usuário se ainda não existir. */
  addProgress(userId: string, nickname: string, patch: ProgressPatch): void {
    const exists = this.db.prepare('SELECT lastSeenDate FROM user_stats WHERE userId = ?').get(userId) as
      | { lastSeenDate: string | null }
      | undefined;
    if (!exists) {
      this.db
        .prepare(
          `INSERT INTO user_stats (userId, nickname, totalDiamondValue, totalComments, totalLikes, isHero, heroSince)
           VALUES (?, ?, 0, 0, 0, 0, NULL)`,
        )
        .run(userId, nickname);
    }
    const newDay = patch.date !== undefined && exists?.lastSeenDate !== patch.date;
    this.db
      .prepare(
        `UPDATE user_stats SET
           nickname = ?,
           totalFollows = totalFollows + ?,
           totalShares = totalShares + ?,
           xp = xp + ?,
           daysActive = daysActive + ?,
           lastSeenDate = COALESCE(?, lastSeenDate)
         WHERE userId = ?`,
      )
      .run(nickname, patch.followDelta ?? 0, patch.shareDelta ?? 0, patch.xpDelta ?? 0, newDay ? 1 : 0, patch.date ?? null, userId);
  }

  getProgress(userId: string): UserProgress | null {
    const row = this.db.prepare(`SELECT ${PROGRESS_COLUMNS} FROM user_stats WHERE userId = ?`).get(userId);
    return (row as unknown as UserProgress | undefined) ?? null;
  }

  findProgressByNickname(nickname: string): UserProgress | null {
    const row = this.db.prepare(`SELECT ${PROGRESS_COLUMNS} FROM user_stats WHERE nickname = ? ORDER BY xp DESC LIMIT 1`).get(nickname);
    return (row as unknown as UserProgress | undefined) ?? null;
  }

  getTopXp(limit: number): UserProgress[] {
    return this.db
      .prepare(`SELECT ${PROGRESS_COLUMNS} FROM user_stats WHERE xp > 0 ORDER BY xp DESC LIMIT ?`)
      .all(limit) as unknown as UserProgress[];
  }

  /** XP de vários usuários de uma vez (pra mostrar nível nos rankings). */
  getXpMap(userIds: string[]): Map<string, number> {
    const map = new Map<string, number>();
    if (userIds.length === 0) return map;
    const marks = userIds.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT userId, xp FROM user_stats WHERE userId IN (${marks})`).all(...userIds) as unknown as Array<{
      userId: string;
      xp: number;
    }>;
    for (const r of rows) map.set(r.userId, r.xp);
    return map;
  }

  /** Heróis na tela: os `topN` de maior XP + os `recentN` mais recentes (sem repetir), mais recentes primeiro. */
  getHeroesForDisplay(topN: number, recentN: number): UserProgress[] {
    const top = this.db
      .prepare(`SELECT ${PROGRESS_COLUMNS} FROM user_stats WHERE isHero = 1 ORDER BY xp DESC, heroSince DESC LIMIT ?`)
      .all(topN) as unknown as UserProgress[];
    const recent = this.db
      .prepare(`SELECT ${PROGRESS_COLUMNS} FROM user_stats WHERE isHero = 1 ORDER BY heroSince DESC LIMIT ?`)
      .all(recentN + topN) as unknown as UserProgress[];
    const picked = new Map(top.map((u) => [u.userId, u]));
    let added = 0;
    for (const u of recent) {
      if (added >= recentN) break;
      if (!picked.has(u.userId)) {
        picked.set(u.userId, u);
        added += 1;
      }
    }
    return [...picked.values()].sort((a, b) => (b.heroSince ?? 0) - (a.heroSince ?? 0));
  }

  getMissions(userId: string, day: number): MissionRow[] {
    return this.db
      .prepare('SELECT missionId, progress, done FROM user_missions WHERE userId = ? AND day = ?')
      .all(userId, day) as unknown as MissionRow[];
  }

  saveMission(userId: string, day: number, missionId: string, progress: number, done: boolean): void {
    this.db
      .prepare(
        `INSERT INTO user_missions (userId, day, missionId, progress, done) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(userId, day, missionId) DO UPDATE SET progress = excluded.progress, done = excluded.done`,
      )
      .run(userId, day, missionId, progress, done ? 1 : 0);
  }

  /** Dias antigos não servem mais: mantém só o dia atual e o anterior. */
  pruneMissions(currentDay: number): void {
    this.db.prepare('DELETE FROM user_missions WHERE day < ?').run(currentDay - 1);
  }

  getAchievements(userId: string): string[] {
    const rows = this.db.prepare('SELECT achievementId FROM user_achievements WHERE userId = ?').all(userId) as unknown as Array<{
      achievementId: string;
    }>;
    return rows.map((r) => r.achievementId);
  }

  /** true se foi desbloqueada agora (false se já tinha). */
  unlockAchievement(userId: string, achievementId: string): boolean {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO user_achievements (userId, achievementId, unlockedAt) VALUES (?, ?, ?)')
      .run(userId, achievementId, Date.now());
    return Number(result.changes) > 0;
  }

  /** Zera XP, missões e conquistas (admin). Não mexe nos totais de curtidas/comentários/gifts nem nos rankings. */
  resetProgress(): void {
    this.db.exec('UPDATE user_stats SET xp = 0, totalFollows = 0, totalShares = 0, daysActive = 0, lastSeenDate = NULL');
    this.db.exec('DELETE FROM user_missions');
    this.db.exec('DELETE FROM user_achievements');
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
