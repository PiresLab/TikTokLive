import { EventEmitter } from 'node:events';
import type { Database, UserProgress } from '../persistence/db.js';
import type { GameEvent } from '../types/GameEvent.js';
import { ACHIEVEMENTS, achievementById } from './achievements.js';
import { CLASS_NAMES, classFor, type HeroClass } from './classes.js';
import { levelForXp } from './levels.js';
import { missionsFor, type MissionKind } from './missions.js';
import { xpForEvent } from './xp.js';

export interface ProgressUser {
  userId: string;
  nickname: string;
}

/** O que o client mostra como toast/efeito. */
export type ProgressMessage =
  | { kind: 'levelUp'; user: ProgressUser; level: number; title: string; titleIndex: number; classKey: HeroClass }
  | { kind: 'mission'; user: ProgressUser; title: string; xp: number }
  | { kind: 'achievement'; user: ProgressUser; id: string; title: string; icon: string };

export interface ProfileCard {
  userId: string;
  nickname: string;
  level: number;
  title: string;
  titleIndex: number;
  classKey: HeroClass;
  className: string;
  xp: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
  missions: Array<{ title: string; progress: number; target: number; done: boolean }>;
  achievements: Array<{ id: string; title: string; icon: string }>;
  achievementTotal: number;
}

export interface ProgressionOptions {
  /** Dia atual do cerco (as missões renovam a cada novo dia). */
  getDay: () => number;
  /** Data de hoje AAAA-MM-DD (dias ativos). Injetável pra teste. */
  today?: () => string;
}

const EVENT_TO_MISSION: Partial<Record<GameEvent['type'], MissionKind>> = {
  like: 'like',
  comment: 'comment',
  gift: 'gift',
  share: 'share',
};

function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Nível, título, classe, missões diárias e conquistas por pessoa. Consome o
 * mesmo GameEvent do jogo; eventos de teste do painel admin são ignorados (mesma
 * regra dos totais vitalícios). Emite 'progress' (ProgressMessage).
 * Precisa rodar DEPOIS de `db.recordActivity` (que mantém curtidas/comentários/diamantes).
 */
export class ProgressionService extends EventEmitter {
  private readonly levels = new Map<string, number>();
  private lastPrunedDay = -1;
  private readonly today: () => string;

  constructor(
    private readonly db: Database,
    private readonly options: ProgressionOptions,
  ) {
    super();
    this.today = options.today ?? localDate;
  }

  /** Nível da pessoa (cache; cai no banco na primeira consulta). */
  levelOf(userId: string): number {
    const cached = this.levels.get(userId);
    if (cached !== undefined) return cached;
    const level = levelForXp(this.db.getProgress(userId)?.xp ?? 0).level;
    this.levels.set(userId, level);
    return level;
  }

  handleEvent(event: GameEvent): void {
    if (event.isTest) return;
    const { userId, nickname } = event.user;
    const day = this.options.getDay();
    if (day !== this.lastPrunedDay) {
      this.db.pruneMissions(day);
      this.lastPrunedDay = day;
    }

    const xpBefore = this.db.getProgress(userId)?.xp ?? 0;
    this.db.addProgress(userId, nickname, {
      followDelta: event.type === 'follow' ? 1 : 0,
      shareDelta: event.type === 'share' ? 1 : 0,
      xpDelta: xpForEvent(event),
      date: this.today(),
    });

    const user: ProgressUser = { userId, nickname };
    this.advanceMissions(event, user, day);
    this.finish(user, xpBefore);
  }

  /** Quem deu o golpe final num chefão ganha a conquista Mata-Chefões. */
  handleBossDefeated(by: ProgressUser | undefined): void {
    if (!by || by.userId === undefined) return;
    if (!this.db.getProgress(by.userId)) return;
    this.unlock(by, 'boss_slayer');
  }

  /** Admin: soma XP a quem já existe pelo apelido. Devolve texto pro log. */
  grantXp(nickname: string, amount: number): string {
    const found = this.db.findProgressByNickname(nickname);
    if (!found) throw new Error(`ninguém com o apelido "${nickname}" no banco ainda`);
    const before = found.xp;
    this.db.addProgress(found.userId, found.nickname, { xpDelta: amount });
    this.finish({ userId: found.userId, nickname: found.nickname }, before);
    return `+${amount} XP para ${found.nickname}`;
  }

  resetAll(): void {
    this.db.resetProgress();
    this.levels.clear();
  }

  getProfile(userId: string): ProfileCard | null {
    const progress = this.db.getProgress(userId);
    if (!progress) return null;
    const info = levelForXp(progress.xp);
    const classKey = classFor(progress);
    const day = this.options.getDay();
    const stored = new Map(this.db.getMissions(userId, day).map((m) => [m.missionId, m]));
    const owned = new Set(this.db.getAchievements(userId));

    return {
      userId,
      nickname: progress.nickname,
      level: info.level,
      title: info.title,
      titleIndex: info.titleIndex,
      classKey,
      className: CLASS_NAMES[classKey],
      xp: Math.floor(progress.xp),
      xpIntoLevel: Math.floor(info.xpIntoLevel),
      xpForNext: info.xpForNext,
      progress: info.progress,
      missions: missionsFor(userId, day).map((def) => {
        const row = stored.get(def.id);
        return { title: def.title, progress: row?.progress ?? 0, target: def.target, done: Boolean(row?.done) };
      }),
      achievements: ACHIEVEMENTS.filter((a) => owned.has(a.id)).map((a) => ({ id: a.id, title: a.title, icon: a.icon })),
      achievementTotal: ACHIEVEMENTS.length,
    };
  }

  /** Dados que o client usa pra desenhar o herói (classe/nível) dado o que veio do banco. */
  describe(progress: UserProgress): { level: number; title: string; titleIndex: number; classKey: HeroClass } {
    const info = levelForXp(progress.xp);
    return { level: info.level, title: info.title, titleIndex: info.titleIndex, classKey: classFor(progress) };
  }

  // ---- internos ----

  private advanceMissions(event: GameEvent, user: ProgressUser, day: number): void {
    const kind = EVENT_TO_MISSION[event.type];
    if (!kind) return;
    const amount = event.type === 'like' ? (event.likeCount ?? 1) : 1;
    const stored = new Map(this.db.getMissions(user.userId, day).map((m) => [m.missionId, m]));

    for (const def of missionsFor(user.userId, day)) {
      if (def.kind !== kind) continue;
      const row = stored.get(def.id);
      if (row?.done) continue;
      const progress = Math.min(def.target, (row?.progress ?? 0) + amount);
      const done = progress >= def.target;
      this.db.saveMission(user.userId, day, def.id, progress, done);
      if (done) {
        this.db.addProgress(user.userId, user.nickname, { xpDelta: def.xp });
        this.emit('progress', { kind: 'mission', user, title: def.title, xp: def.xp } satisfies ProgressMessage);
      }
    }
  }

  /** Fecha o processamento de uma pessoa: nível e conquistas com o estado já atualizado. */
  private finish(user: ProgressUser, xpBefore: number): void {
    const progress = this.db.getProgress(user.userId);
    if (!progress) return;
    const before = levelForXp(xpBefore).level;
    const after = levelForXp(progress.xp);
    this.levels.set(user.userId, after.level);

    if (after.level > before) {
      this.emit('progress', {
        kind: 'levelUp',
        user,
        level: after.level,
        title: after.title,
        titleIndex: after.titleIndex,
        classKey: classFor(progress),
      } satisfies ProgressMessage);
    }

    const owned = new Set(this.db.getAchievements(user.userId));
    for (const def of ACHIEVEMENTS) {
      if (!owned.has(def.id) && def.earned(progress, after.level)) this.unlock(user, def.id);
    }
  }

  private unlock(user: ProgressUser, id: string): void {
    const def = achievementById(id);
    if (!def || !this.db.unlockAchievement(user.userId, id)) return;
    this.emit('progress', { kind: 'achievement', user, id, title: def.title, icon: def.icon } satisfies ProgressMessage);
  }
}
