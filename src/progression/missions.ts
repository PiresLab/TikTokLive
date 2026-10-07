export type MissionKind = 'like' | 'comment' | 'gift' | 'share';

export interface MissionDef {
  id: string;
  kind: MissionKind;
  target: number;
  /** XP bônus ao cumprir. */
  xp: number;
  title: string;
}

/** Follow fica de fora de propósito: só dá pra seguir uma vez, a missão seria impossível pra quem já segue. */
const TEMPLATES: Record<MissionKind, MissionDef[]> = {
  like: [
    { id: 'like50', kind: 'like', target: 50, xp: 20, title: 'Curta 50 vezes' },
    { id: 'like200', kind: 'like', target: 200, xp: 45, title: 'Curta 200 vezes' },
  ],
  comment: [
    { id: 'comment3', kind: 'comment', target: 3, xp: 20, title: 'Comente 3 vezes' },
    { id: 'comment10', kind: 'comment', target: 10, xp: 45, title: 'Comente 10 vezes' },
  ],
  gift: [{ id: 'gift1', kind: 'gift', target: 1, xp: 50, title: 'Envie 1 presente' }],
  share: [{ id: 'share1', kind: 'share', target: 1, xp: 40, title: 'Compartilhe a live' }],
};

const KINDS: MissionKind[] = ['like', 'comment', 'gift', 'share'];
export const MISSIONS_PER_DAY = 3;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 3 missões por pessoa por dia do cerco, sorteadas de forma determinística
 * (mesma pessoa + mesmo dia = mesmas missões, sem precisar guardar o sorteio).
 */
export function missionsFor(userId: string, day: number): MissionDef[] {
  const seed = hash(`${userId}:${day}`);
  const skipped = KINDS[seed % KINDS.length];
  return KINDS.filter((kind) => kind !== skipped).map((kind, i) => {
    const options = TEMPLATES[kind];
    return options[(seed >>> (3 + i)) % options.length];
  });
}
