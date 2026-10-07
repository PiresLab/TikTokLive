export type WeatherKind = 'clear' | 'rain' | 'storm' | 'snow' | 'fog';
export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'rain', 'storm', 'snow', 'fog'];

export interface WeatherState {
  kind: WeatherKind;
  since: number;
  until: number;
}

type Rng = () => number;

/** Pra onde o clima vai depois de cada tipo (pesos). Tempestade só vem depois de chuva. */
const TRANSITIONS: Record<WeatherKind, Array<[WeatherKind, number]>> = {
  clear: [['rain', 0.38], ['fog', 0.27], ['snow', 0.2], ['clear', 0.15]],
  rain: [['storm', 0.3], ['clear', 0.5], ['rain', 0.1], ['fog', 0.1]],
  storm: [['rain', 0.6], ['clear', 0.4]],
  snow: [['clear', 0.6], ['fog', 0.2], ['snow', 0.2]],
  fog: [['clear', 0.6], ['rain', 0.25], ['fog', 0.15]],
};

export const WEATHER_MIN_MS = 3 * 60_000;
export const WEATHER_MAX_MS = 8 * 60_000;

function pick<T>(options: Array<[T, number]>, rng: Rng): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1][0];
}

/** Máquina de clima: dura de 3 a 8 minutos e sorteia o próximo conforme TRANSITIONS. Relógio e sorteio injetáveis. */
export class WeatherMachine {
  private current: WeatherState;

  constructor(
    private readonly rng: Rng = Math.random,
    now: number = Date.now(),
    private readonly minMs: number = WEATHER_MIN_MS,
    private readonly maxMs: number = WEATHER_MAX_MS,
  ) {
    this.current = { kind: 'clear', since: now, until: now + this.duration() };
  }

  private duration(): number {
    return this.minMs + this.rng() * (this.maxMs - this.minMs);
  }

  state(): WeatherState {
    return { ...this.current };
  }

  /** Avança o relógio. Devolve o novo clima se ele mudou agora. */
  tick(now: number): WeatherState | null {
    if (now < this.current.until) return null;
    const kind = pick(TRANSITIONS[this.current.kind], this.rng);
    this.current = { kind, since: now, until: now + this.duration() };
    return this.state();
  }

  /** Admin: força um clima (por padrão, pela duração normal). */
  force(kind: WeatherKind, now: number, durationMs?: number): WeatherState {
    this.current = { kind, since: now, until: now + (durationMs ?? this.duration()) };
    return this.state();
  }
}
