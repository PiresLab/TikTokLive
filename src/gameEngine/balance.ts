export interface BalanceConfig {
  kingdomMaxHp: number;
  kingdomDecayPerTick: number;
  kingdomHealPerFollow: number;
  kingdomHealPerWaveCleared: number;
  dmgPerLike: number;
  dmgPerComment: number;
  dmgPerDiamond: number;
  dmgShareRally: number;
  bossEveryWaves: number;
  monsterBaseHp: number;
  monsterHpGrowth: number;
  bossHpMultiplier: number;
}

// Valores calibrados com `npm run balance` — ver comentário sobre o
// crescimento de HP em GameEngine.ts (18%/onda virava parede em ~onda 30).
export const DEFAULT_BALANCE: BalanceConfig = {
  kingdomMaxHp: 1000,
  kingdomDecayPerTick: 0.35,
  kingdomHealPerFollow: 20,
  kingdomHealPerWaveCleared: 15,
  dmgPerLike: 0.3,
  dmgPerComment: 3,
  dmgPerDiamond: 0.5,
  dmgShareRally: 50,
  bossEveryWaves: 5,
  monsterBaseHp: 150,
  monsterHpGrowth: 1.05,
  bossHpMultiplier: 6,
};

export interface BalanceRange {
  min: number;
  max: number;
  integer?: boolean;
}

/** Faixas seguras — impedem valor que trava o jogo (ex.: crescimento 3x/onda, boss a cada 0 ondas). */
export const BALANCE_RANGES: Record<keyof BalanceConfig, BalanceRange> = {
  kingdomMaxHp: { min: 100, max: 100_000, integer: true },
  kingdomDecayPerTick: { min: 0, max: 50 },
  kingdomHealPerFollow: { min: 0, max: 5_000 },
  kingdomHealPerWaveCleared: { min: 0, max: 5_000 },
  dmgPerLike: { min: 0, max: 1_000 },
  dmgPerComment: { min: 0, max: 10_000 },
  dmgPerDiamond: { min: 0, max: 1_000 },
  dmgShareRally: { min: 0, max: 100_000 },
  bossEveryWaves: { min: 1, max: 100, integer: true },
  monsterBaseHp: { min: 10, max: 1_000_000, integer: true },
  monsterHpGrowth: { min: 1, max: 1.5 },
  bossHpMultiplier: { min: 1, max: 100 },
};

export type BalanceValidation =
  | { ok: true; value: Partial<BalanceConfig> }
  | { ok: false; error: string };

/** Valida um patch parcial vindo de fora (admin/banco). Rejeita chave desconhecida e valor fora da faixa. */
export function validateBalance(input: unknown): BalanceValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'balance deve ser um objeto' };
  }

  const patch: Partial<BalanceConfig> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!(key in BALANCE_RANGES)) return { ok: false, error: `chave desconhecida: ${key}` };
    const range = BALANCE_RANGES[key as keyof BalanceConfig];

    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return { ok: false, error: `${key} deve ser um número` };
    }
    if (range.integer && !Number.isInteger(raw)) return { ok: false, error: `${key} deve ser inteiro` };
    if (raw < range.min || raw > range.max) {
      return { ok: false, error: `${key} fora da faixa (${range.min} a ${range.max})` };
    }
    patch[key as keyof BalanceConfig] = raw;
  }
  return { ok: true, value: patch };
}

export function mergeBalance(base: BalanceConfig, patch: Partial<BalanceConfig>): BalanceConfig {
  return { ...base, ...patch };
}
