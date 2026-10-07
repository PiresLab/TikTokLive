export type GoalKind = 'like' | 'comment' | 'follow' | 'share';

export type GoalReward =
  | { type: 'heal'; amount: number }
  | { type: 'damage'; pctOfMonster: number };

/** O que o client desenha: meta atual do público. */
export interface GoalInfo {
  kind: GoalKind;
  title: string;
  rewardText: string;
  progress: number;
  target: number;
}

export interface GoalCompletion {
  kind: GoalKind;
  title: string;
  rewardText: string;
  reward: GoalReward;
}

interface GoalDef {
  kind: GoalKind;
  baseTarget: number;
  title: (target: number) => string;
  reward: GoalReward;
  rewardText: string;
}

const DEFS: Record<GoalKind, GoalDef> = {
  like: {
    kind: 'like',
    baseTarget: 300,
    title: (t) => `🎯 Curtam! ${t} curtidas`,
    reward: { type: 'damage', pctOfMonster: 0.25 },
    rewardText: 'Prêmio: golpe de 25% no monstro',
  },
  comment: {
    kind: 'comment',
    baseTarget: 30,
    title: (t) => `🎯 Comentem! ${t} comentários`,
    reward: { type: 'heal', amount: 150 },
    rewardText: 'Prêmio: cura +150 no Reino',
  },
  follow: {
    kind: 'follow',
    baseTarget: 5,
    title: (t) => `🎯 Sigam! ${t} novos heróis`,
    reward: { type: 'heal', amount: 120 },
    rewardText: 'Prêmio: cura +120 no Reino',
  },
  share: {
    kind: 'share',
    baseTarget: 3,
    title: (t) => `🎯 Compartilhem! ${t} vezes`,
    reward: { type: 'damage', pctOfMonster: 0.4 },
    rewardText: 'Prêmio: golpe de 40% no monstro',
  },
};

const ORDER: GoalKind[] = ['like', 'comment', 'follow', 'like', 'comment', 'share'];

/** Meta batida rápido demais = público maior que o previsto: a próxima do mesmo tipo fica mais difícil. */
const FAST_MS = 90_000;
/** Meta que arrasta = público menor: facilita a próxima, e alivia a atual se ela encalhar. */
const SLOW_MS = 600_000;
const UP = 1.5;
const DOWN = 0.7;
const MAX_MULTIPLIER = 20;

/**
 * Meta coletiva rotativa ("faltam X comentários pra curar o Reino"). O alvo se
 * adapta ao tamanho do público: live com 20 pessoas e live com 2000 recebem
 * metas de dificuldade parecida.
 */
export class GoalTracker {
  private index = 0;
  private progress = 0;
  private target: number;
  private startedAt: number;
  private readonly multiplier: Record<GoalKind, number> = { like: 1, comment: 1, follow: 1, share: 1 };

  constructor(now: number = Date.now()) {
    this.startedAt = now;
    this.target = this.targetFor(ORDER[0]);
  }

  private get def(): GoalDef {
    return DEFS[ORDER[this.index]];
  }

  private targetFor(kind: GoalKind): number {
    return Math.max(1, Math.round(DEFS[kind].baseTarget * this.multiplier[kind]));
  }

  current(): GoalInfo {
    const def = this.def;
    return {
      kind: def.kind,
      title: def.title(this.target),
      rewardText: def.rewardText,
      progress: Math.min(this.progress, this.target),
      target: this.target,
    };
  }

  /** Soma progresso se o evento é do tipo da meta atual. Devolve a meta concluída (e já avança pra próxima). */
  add(kind: GoalKind, amount: number, now: number = Date.now()): GoalCompletion | null {
    const def = this.def;
    if (kind !== def.kind || amount <= 0) return null;

    this.progress += amount;
    if (this.progress < this.target) return null;

    const done: GoalCompletion = { kind: def.kind, title: def.title(this.target), rewardText: def.rewardText, reward: def.reward };
    const elapsed = now - this.startedAt;
    if (elapsed < FAST_MS) {
      this.multiplier[kind] = Math.min(MAX_MULTIPLIER, this.multiplier[kind] * UP);
    } else if (elapsed > SLOW_MS) {
      this.multiplier[kind] = Math.max(1, this.multiplier[kind] * DOWN);
    }

    this.index = (this.index + 1) % ORDER.length;
    this.progress = 0;
    this.startedAt = now;
    this.target = this.targetFor(ORDER[this.index]);
    return done;
  }

  /** Meta encalhada há muito tempo: baixa o alvo (nunca abaixo do que já foi feito nem do base). */
  tick(now: number = Date.now()): void {
    if (now - this.startedAt < SLOW_MS) return;
    const floor = Math.max(DEFS[this.def.kind].baseTarget, Math.ceil(this.progress) + 1);
    const eased = Math.max(floor, Math.round(this.target * DOWN));
    this.target = Math.min(this.target, eased);
    this.startedAt = now;
  }
}
