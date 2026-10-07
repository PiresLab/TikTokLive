import { describe, expect, it } from 'vitest';
import { DEFAULT_BALANCE, mergeBalance, validateBalance } from './balance.js';

describe('balance', () => {
  it('accepts a valid partial patch', () => {
    const result = validateBalance({ dmgPerLike: 0.5, bossEveryWaves: 4 });
    expect(result).toEqual({ ok: true, value: { dmgPerLike: 0.5, bossEveryWaves: 4 } });
  });

  it('rejects unknown keys', () => {
    const result = validateBalance({ naoExiste: 1 });
    expect(result.ok).toBe(false);
  });

  it('rejects non-numbers, NaN and Infinity', () => {
    expect(validateBalance({ dmgPerLike: '1' }).ok).toBe(false);
    expect(validateBalance({ dmgPerLike: Number.NaN }).ok).toBe(false);
    expect(validateBalance({ dmgPerLike: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('rejects out-of-range values that would break the game', () => {
    expect(validateBalance({ monsterHpGrowth: 3 }).ok).toBe(false); // 3x/onda = parede imediata
    expect(validateBalance({ bossEveryWaves: 0 }).ok).toBe(false); // módulo por zero
    expect(validateBalance({ kingdomMaxHp: -5 }).ok).toBe(false);
  });

  it('rejects non-integer where an integer is required', () => {
    expect(validateBalance({ bossEveryWaves: 2.5 }).ok).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(validateBalance(null).ok).toBe(false);
    expect(validateBalance([1, 2]).ok).toBe(false);
    expect(validateBalance('x').ok).toBe(false);
  });

  it('mergeBalance overrides only the given keys', () => {
    const merged = mergeBalance(DEFAULT_BALANCE, { dmgPerLike: 9 });
    expect(merged.dmgPerLike).toBe(9);
    expect(merged.dmgPerComment).toBe(DEFAULT_BALANCE.dmgPerComment);
  });
});
