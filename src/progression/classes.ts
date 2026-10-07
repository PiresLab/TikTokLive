export type HeroClass = 'knight' | 'archer' | 'mage' | 'guardian';

export const CLASS_NAMES: Record<HeroClass, string> = {
  knight: 'Guerreiro',
  archer: 'Arqueiro',
  mage: 'Mago',
  guardian: 'Guardião',
};

export interface ClassInput {
  totalLikes: number;
  totalComments: number;
  totalDiamondValue: number;
  totalFollows: number;
  totalShares: number;
}

/**
 * A classe nasce do que a pessoa mais faz (contribuição ponderada). Só visual e
 * título: não muda dano nenhum, então o balanceamento do motor não é afetado.
 * Quem acabou de seguir (só follow) é Guardião do Reino; muda conforme age.
 */
export function classFor(stats: ClassInput): HeroClass {
  const scores: Array<[HeroClass, number]> = [
    ['knight', stats.totalLikes * 0.1],
    ['archer', stats.totalComments * 2],
    ['mage', stats.totalDiamondValue],
    ['guardian', stats.totalFollows * 5 + stats.totalShares * 15],
  ];
  let best = scores[0];
  for (const entry of scores) if (entry[1] > best[1]) best = entry;
  return best[1] > 0 ? best[0] : 'knight';
}
