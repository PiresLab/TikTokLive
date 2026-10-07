const BASE_XP = 40;
const EXPONENT = 1.6;
export const MAX_LEVEL = 99;

/** Títulos por faixa de nível; `titleIndex` (0..5) é o que o client usa pra escolher cor/moldura. */
export const TITLES = [
  { minLevel: 1, name: 'Recruta' },
  { minLevel: 5, name: 'Soldado' },
  { minLevel: 10, name: 'Cavaleiro' },
  { minLevel: 18, name: 'Capitão' },
  { minLevel: 28, name: 'Campeão' },
  { minLevel: 40, name: 'Lenda' },
] as const;

/** XP total necessário pra ENTRAR no nível `level` (nível 1 = 0). Cresce de forma suave: nível 10 ≈ 1.3k, 40 ≈ 14k. */
export function xpToReach(level: number): number {
  return level <= 1 ? 0 : Math.round(BASE_XP * (level - 1) ** EXPONENT);
}

export interface LevelInfo {
  level: number;
  title: string;
  titleIndex: number;
  xp: number;
  /** XP acumulado dentro do nível atual. */
  xpIntoLevel: number;
  /** XP que o nível atual exige pra virar o próximo (0 no nível máximo). */
  xpForNext: number;
  /** 0..1 até o próximo nível. */
  progress: number;
}

export function levelForXp(xp: number): LevelInfo {
  let level = 1;
  while (level < MAX_LEVEL && xpToReach(level + 1) <= xp) level += 1;

  let titleIndex = 0;
  for (let i = 0; i < TITLES.length; i += 1) if (level >= TITLES[i].minLevel) titleIndex = i;

  const floor = xpToReach(level);
  const span = level >= MAX_LEVEL ? 0 : xpToReach(level + 1) - floor;
  const xpIntoLevel = xp - floor;
  return {
    level,
    title: TITLES[titleIndex].name,
    titleIndex,
    xp,
    xpIntoLevel,
    xpForNext: span,
    progress: span > 0 ? Math.min(1, xpIntoLevel / span) : 1,
  };
}
