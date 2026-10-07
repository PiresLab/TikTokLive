import { EventEmitter } from 'node:events';
import type { GameEvent } from '../types/GameEvent.js';
import {
  DEFAULT_BALANCE,
  mergeBalance,
  validateBalance,
  type BalanceConfig,
  type BalanceValidation,
} from './balance.js';

export interface EraInfo {
  tier: number;
  name: string;
}

export interface GameState {
  wave: number;
  isBoss: boolean;
  monsterName: string;
  monsterHp: number;
  monsterMaxHp: number;
  kingdomHp: number;
  kingdomMaxHp: number;
  totalLikes: number;
  totalComments: number;
  totalGifts: number;
  totalDiamondValue: number;
  totalFollows: number;
  totalShares: number;
  seasonDay: number;
  seasonStartedAt: number;
}

/** GameState + campos derivados/de runtime (não persistidos, recalculados a cada leitura). */
export type GameStateView = GameState & { era: EraInfo; paused: boolean };

export type NarrativeEvent =
  | { kind: 'waveCleared'; wave: number }
  | { kind: 'bossSpawned'; name: string; hp: number }
  | { kind: 'bossDefeated'; name: string }
  | { kind: 'kingdomFall' }
  | { kind: 'newSeason'; day: number; flavorText: string };

export interface SeasonEndedInfo {
  day: number;
  waveReached: number;
}

const TICK_MS = 1_000;

// Crescimento de HP por onda (balance.monsterHpGrowth): 18%/onda composto
// (valor original) dobrava o HP a cada ~4 ondas — em 24h simuladas
// (npm run balance) virava parede intransponível por volta da onda 30
// (chefão de ~109k HP), travando a live 6h seguidas. Exponencial SEMPRE
// acaba ultrapassando dano que cresce ~linear com tempo/engajamento; 5%/onda
// dobra a cada ~14 ondas — ainda escala, mas sem criar parede num dia de
// stream. Ver npm run balance pra reproduzir/validar.

const MONSTER_NAMES = ['Goblin', 'Lobo Sombrio', 'Orc Batedor', 'Troll da Ponte', 'Espectro'];
const BOSS_NAMES = ['Dragão Ancião', 'Titã de Pedra', 'Senhor das Sombras', 'Golem de Gelo'];

export const DEFAULT_SEASON_DURATION_MS = 24 * 60 * 60 * 1000;

const FLAVOR_TEXTS = [
  'as muralhas resistem, mas o inimigo não descansa.',
  'o exército cresce com cada herói que chega.',
  'rumores de uma criatura maior se espalham pelas terras vizinhas.',
  'o povo do Reino canta em agradecimento aos seus defensores.',
  'as forjas trabalham a noite toda pra sustentar o cerco.',
  'ventos frios anunciam que o pior ainda está por vir.',
  'uma nova aliança se forma entre os sobreviventes da última onda.',
  'o brilho das Galáxias enviadas ainda ilumina o céu do Reino.',
];

/** Tiers de progressão vitalícia — soma ponderada de todo o engajamento já recebido. */
const ERA_TIERS: EraInfo[] = [
  { tier: 0, name: 'Acampamento' },
  { tier: 1, name: 'Vila' },
  { tier: 2, name: 'Vila Fortificada' },
  { tier: 3, name: 'Cidade' },
  { tier: 4, name: 'Capital do Reino' },
];
const ERA_THRESHOLDS = [0, 500, 5_000, 25_000, 100_000];

type MonsterFields = Pick<GameState, 'isBoss' | 'monsterName' | 'monsterHp' | 'monsterMaxHp'>;

function monsterHpForWave(wave: number, isBoss: boolean, b: BalanceConfig): number {
  const base = Math.round(b.monsterBaseHp * b.monsterHpGrowth ** (wave - 1));
  return isBoss ? Math.round(base * b.bossHpMultiplier) : base;
}

function nameForWave(wave: number, isBoss: boolean): string {
  const list = isBoss ? BOSS_NAMES : MONSTER_NAMES;
  return list[(wave - 1) % list.length];
}

function monsterFor(wave: number, isBoss: boolean, b: BalanceConfig): MonsterFields {
  const hp = monsterHpForWave(wave, isBoss, b);
  return { isBoss, monsterName: nameForWave(wave, isBoss), monsterHp: hp, monsterMaxHp: hp };
}

function freshMonster(wave: number, b: BalanceConfig): MonsterFields {
  return monsterFor(wave, wave % b.bossEveryWaves === 0, b);
}

function lifetimeScore(state: GameState): number {
  return (
    state.totalDiamondValue +
    state.totalLikes * 0.1 +
    state.totalComments * 2 +
    state.totalFollows * 10 +
    state.totalShares * 15
  );
}

function eraForState(state: GameState): EraInfo {
  const score = lifetimeScore(state);
  let current = ERA_TIERS[0];
  for (let i = 0; i < ERA_THRESHOLDS.length; i += 1) {
    if (score >= ERA_THRESHOLDS[i]) current = ERA_TIERS[i];
  }
  return current;
}

function flavorTextForDay(day: number): string {
  return FLAVOR_TEXTS[(day - 1) % FLAVOR_TEXTS.length];
}

function initialState(b: BalanceConfig): GameState {
  const wave = 1;
  return {
    wave,
    kingdomHp: b.kingdomMaxHp,
    kingdomMaxHp: b.kingdomMaxHp,
    totalLikes: 0,
    totalComments: 0,
    totalGifts: 0,
    totalDiamondValue: 0,
    totalFollows: 0,
    totalShares: 0,
    seasonDay: 1,
    seasonStartedAt: Date.now(),
    ...freshMonster(wave, b),
  };
}

export interface GameEngineOptions {
  seasonDurationMs?: number;
  balance?: Partial<BalanceConfig>;
}

/**
 * Motor: ciclo de ondas + chefão + season diária + Era do Reino por cima do
 * estado base. Todo evento de viewer causa dano no monstro atual; follow cura
 * o Reino; cerco (decaimento passivo) obriga engajamento contínuo. Se o Reino
 * cai (HP=0) ou o dia vira (season), a onda reseta — mas os totais vitalícios
 * (e portanto a Era) nunca são zerados. Constantes de balanceamento vêm de
 * BalanceConfig e podem ser ajustadas em runtime (painel admin).
 */
export class GameEngine extends EventEmitter {
  private state: GameState;
  private balance: BalanceConfig;
  private paused = false;
  private readonly seasonDurationMs: number;
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  constructor(initial?: Partial<GameState>, options: GameEngineOptions = {}) {
    super();
    this.balance = mergeBalance(DEFAULT_BALANCE, options.balance ?? {});
    // merge (não substituição direta) pra snapshots antigos sem os campos
    // novos (season) ainda carregarem com defaults válidos.
    this.state = { ...initialState(this.balance), ...initial };
    this.state.kingdomMaxHp = this.balance.kingdomMaxHp;
    this.state.kingdomHp = Math.min(this.state.kingdomHp, this.state.kingdomMaxHp);
    this.seasonDurationMs = options.seasonDurationMs ?? DEFAULT_SEASON_DURATION_MS;
  }

  start(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  /** Avança N ticks sincronamente, sem timer real — só pra simulação/balanceamento. */
  simulateTicks(count: number): void {
    for (let i = 0; i < count; i += 1) this.tick();
  }

  getState(): GameStateView {
    return { ...this.state, era: eraForState(this.state), paused: this.paused };
  }

  getBalance(): BalanceConfig {
    return { ...this.balance };
  }

  /** Aplica patch de balanceamento (validado). O monstro atual não muda; vale a partir da próxima onda. */
  setBalance(patch: unknown): BalanceValidation {
    const result = validateBalance(patch);
    if (!result.ok) return result;

    this.balance = mergeBalance(this.balance, result.value);
    this.state.kingdomMaxHp = this.balance.kingdomMaxHp;
    this.state.kingdomHp = Math.min(this.state.kingdomHp, this.state.kingdomMaxHp);
    this.emit('balanceChanged', this.getBalance());
    this.emit('state', this.getState());
    return result;
  }

  resetBalance(): void {
    this.setBalance({ ...DEFAULT_BALANCE });
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pausado: nenhum dano/cura/decaimento/season e totais congelados; os `fx`
   * continuam sendo emitidos pros viewers verem a reação visual.
   */
  setPaused(value: boolean): void {
    this.paused = value;
    this.emit('state', this.getState());
  }

  handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'like':
      case 'comment':
      case 'gift':
      case 'follow':
      case 'share':
        break;
      default:
        return;
    }

    this.emit('fx', event);

    if (this.paused) {
      this.emit('state', this.getState());
      return;
    }

    let damage = 0;
    // evento de teste (painel admin) afeta o jogo, mas não os totais vitalícios
    // — senão teste suja a Era do Reino.
    const countsTowardTotals = !event.isTest;

    switch (event.type) {
      case 'like':
        if (countsTowardTotals) this.state.totalLikes += event.likeCount ?? 1;
        damage = (event.likeCount ?? 1) * this.balance.dmgPerLike;
        break;
      case 'comment':
        if (countsTowardTotals) this.state.totalComments += 1;
        damage = this.balance.dmgPerComment;
        break;
      case 'gift':
        if (countsTowardTotals) {
          this.state.totalGifts += 1;
          this.state.totalDiamondValue += event.totalDiamondValue ?? 0;
        }
        damage = (event.totalDiamondValue ?? 0) * this.balance.dmgPerDiamond;
        break;
      case 'follow':
        if (countsTowardTotals) this.state.totalFollows += 1;
        this.healKingdom(this.balance.kingdomHealPerFollow);
        break;
      case 'share':
        if (countsTowardTotals) this.state.totalShares += 1;
        damage = this.balance.dmgShareRally;
        break;
      default:
        break;
    }

    if (damage > 0) this.applyDamage(damage);
    this.emit('state', this.getState());
  }

  // ---- ações de administrador (painel admin) ----

  adminSpawnBoss(): void {
    Object.assign(this.state, monsterFor(this.state.wave, true, this.balance));
    this.emit('narrative', {
      kind: 'bossSpawned',
      name: this.state.monsterName,
      hp: this.state.monsterMaxHp,
    } satisfies NarrativeEvent);
    this.emit('state', this.getState());
  }

  adminSetWave(wave: number): void {
    this.state.wave = Math.max(1, Math.floor(wave));
    Object.assign(this.state, freshMonster(this.state.wave, this.balance));
    if (this.state.isBoss) {
      this.emit('narrative', {
        kind: 'bossSpawned',
        name: this.state.monsterName,
        hp: this.state.monsterMaxHp,
      } satisfies NarrativeEvent);
    }
    this.emit('state', this.getState());
  }

  adminHealKingdom(amount: number): void {
    this.healKingdom(Math.max(0, amount));
    this.emit('state', this.getState());
  }

  adminDamageKingdom(amount: number): void {
    this.state.kingdomHp = Math.max(0, this.state.kingdomHp - Math.max(0, amount));
    this.checkKingdomFall();
    this.emit('state', this.getState());
  }

  adminEndSeason(): void {
    this.rolloverSeason();
    this.emit('state', this.getState());
  }

  /** Soma ao score vitalício (via diamantes acumulados) — serve pra pular de Era e testar o visual. */
  adminAddLifetimeScore(amount: number): void {
    this.state.totalDiamondValue += Math.max(0, Math.floor(amount));
    this.emit('state', this.getState());
  }

  // ---- internos ----

  private applyDamage(damage: number): void {
    this.state.monsterHp = Math.max(0, this.state.monsterHp - damage);
    if (this.state.monsterHp === 0) this.advanceWave();
  }

  private advanceWave(): void {
    const wasBoss = this.state.isBoss;
    const bossName = this.state.monsterName;
    this.state.wave += 1;
    Object.assign(this.state, freshMonster(this.state.wave, this.balance));
    this.healKingdom(this.balance.kingdomHealPerWaveCleared);

    if (wasBoss) this.emit('narrative', { kind: 'bossDefeated', name: bossName } satisfies NarrativeEvent);
    this.emit('narrative', { kind: 'waveCleared', wave: this.state.wave - 1 } satisfies NarrativeEvent);
    if (this.state.isBoss) {
      this.emit('narrative', {
        kind: 'bossSpawned',
        name: this.state.monsterName,
        hp: this.state.monsterMaxHp,
      } satisfies NarrativeEvent);
    }
  }

  private healKingdom(amount: number): void {
    this.state.kingdomHp = Math.min(this.state.kingdomMaxHp, this.state.kingdomHp + amount);
  }

  private resetSiege(): void {
    this.state.wave = 1;
    Object.assign(this.state, freshMonster(1, this.balance));
    this.state.kingdomHp = this.state.kingdomMaxHp;
  }

  private checkKingdomFall(): void {
    if (this.state.kingdomHp > 0) return;
    this.resetSiege();
    this.emit('narrative', { kind: 'kingdomFall' } satisfies NarrativeEvent);
  }

  private rolloverSeason(): void {
    const endedInfo: SeasonEndedInfo = { day: this.state.seasonDay, waveReached: this.state.wave };
    this.state.seasonDay += 1;
    this.state.seasonStartedAt = Date.now();
    this.resetSiege();
    this.emit('seasonEnded', endedInfo);
    this.emit('narrative', {
      kind: 'newSeason',
      day: this.state.seasonDay,
      flavorText: flavorTextForDay(this.state.seasonDay),
    } satisfies NarrativeEvent);
  }

  private tick(): void {
    if (this.paused) {
      // sem decaimento/season, mas segue emitindo state (heartbeat do /health)
      this.emit('state', this.getState());
      return;
    }

    if (this.state.kingdomHp > 0) {
      this.state.kingdomHp = Math.max(0, this.state.kingdomHp - this.balance.kingdomDecayPerTick);
    }
    this.checkKingdomFall();

    if (Date.now() - this.state.seasonStartedAt >= this.seasonDurationMs) {
      this.rolloverSeason();
    }

    this.emit('state', this.getState());
  }
}
