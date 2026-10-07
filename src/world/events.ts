export type KingdomEventKind = 'bloodMoon' | 'dawnBlessing' | 'horde' | 'eliteBoss';
export const EVENT_KINDS: readonly KingdomEventKind[] = ['bloodMoon', 'dawnBlessing', 'horde', 'eliteBoss'];

/** Afixos de monstro (hoje só o chefão elite "Blindado"). */
export type MonsterAffix = 'armored';

export interface EventDef {
  kind: KingdomEventKind;
  name: string;
  flavor: string;
  /** Eventos com duração (Lua de Sangue, Bênção). Horda e Elite duram até o monstro cair. */
  durationMs?: number;
  weight: number;
}

export const EVENT_DEFS: Record<KingdomEventKind, EventDef> = {
  bloodMoon: {
    kind: 'bloodMoon',
    name: 'Lua de Sangue',
    flavor: 'Dano de curtidas e comentários ×1,5 — mas o Reino sangra o dobro',
    durationMs: 120_000,
    weight: 2,
  },
  dawnBlessing: {
    kind: 'dawnBlessing',
    name: 'Bênção do Amanhecer',
    flavor: 'Todo dano ×1,25 e o Reino se cura aos poucos',
    durationMs: 90_000,
    weight: 2,
  },
  horde: { kind: 'horde', name: 'Horda!', flavor: 'Vários monstros dividem a mesma barra de vida', weight: 3 },
  eliteBoss: {
    kind: 'eliteBoss',
    name: 'Chefão Elite Blindado',
    flavor: 'Curtidas valem metade, comentários valem o dobro',
    weight: 1.5,
  },
};

/** Multiplicadores que o motor aplica enquanto um evento/afixo está valendo. */
export interface Modifiers {
  like: number;
  comment: number;
  gift: number;
  share: number;
  /** Multiplica o decaimento passivo do Reino. */
  decay: number;
  /** Cura passiva do Reino por tick (1s). */
  regen: number;
}

export const NEUTRAL_MODIFIERS: Readonly<Modifiers> = { like: 1, comment: 1, gift: 1, share: 1, decay: 1, regen: 0 };

/** Faixas seguras: nenhum evento (nem erro de configuração) pode travar ou trivializar o jogo. */
export const MODIFIER_RANGES: Record<keyof Modifiers, [number, number]> = {
  like: [0.25, 3],
  comment: [0.25, 3],
  gift: [0.25, 3],
  share: [0.25, 3],
  decay: [0, 3],
  regen: [0, 5],
};

const clamp = (value: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, value));

export function modifiersFor(timed: KingdomEventKind | null, affix: MonsterAffix | undefined): Modifiers {
  const m: Modifiers = { ...NEUTRAL_MODIFIERS };
  if (timed === 'bloodMoon') {
    m.like *= 1.5;
    m.comment *= 1.5;
    m.decay *= 2;
  }
  if (timed === 'dawnBlessing') {
    m.like *= 1.25;
    m.comment *= 1.25;
    m.gift *= 1.25;
    m.share *= 1.25;
    m.regen += 1.5;
  }
  if (affix === 'armored') {
    m.like *= 0.5;
    m.comment *= 2;
  }
  for (const key of Object.keys(m) as Array<keyof Modifiers>) m[key] = clamp(m[key], MODIFIER_RANGES[key]);
  return m;
}
