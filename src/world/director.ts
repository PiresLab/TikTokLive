import { EVENT_DEFS, EVENT_KINDS, type KingdomEventKind } from './events.js';
import { WeatherMachine, type WeatherKind, type WeatherState } from './weather.js';
import { worldClock, type DayPhase, type WorldClock } from './worldClock.js';

type Rng = () => number;

export const EVENT_INTERVAL_MIN_MS = 8 * 60_000;
export const EVENT_INTERVAL_MAX_MS = 15 * 60_000;

export interface ActiveEvent {
  kind: KingdomEventKind;
  name: string;
  startedAt: number;
  endsAt: number;
  durationMs: number;
}

/** O que o client recebe junto do estado do jogo. */
export interface WorldState extends WorldClock {
  /** Relógio do servidor (ms): o client compara com `event.endsAt` sem depender do relógio da máquina dele. */
  now: number;
  weather: WeatherKind;
  event: ActiveEvent | null;
}

export interface DirectorContext {
  /** Há um monstro "etiquetado" (horda/elite) em campo? Nesse caso não agenda outro. */
  monsterTagged: boolean;
  isBoss: boolean;
  seasonStartedAt: number;
  seasonDurationMs: number;
}

export interface DirectorTick {
  /** Evento que o agendador decidiu iniciar agora (o motor aplica; timed já fica ativo aqui). */
  started?: KingdomEventKind;
  /** Evento com duração que acabou de terminar. */
  ended?: ActiveEvent;
  weatherChanged?: WeatherState;
}

/**
 * Orquestra o "mundo" do jogo: relógio do dia, clima e agendador de eventos do Reino
 * (um a cada 8–15 min, nunca dois ao mesmo tempo). Só estado em memória.
 * Relógio e sorteio são injetáveis, então tudo é testável sem esperar minutos.
 */
export class WorldDirector {
  private readonly weather: WeatherMachine;
  private active: ActiveEvent | null = null;
  private nextEventAt: number;

  constructor(
    private readonly rng: Rng = Math.random,
    now: number = Date.now(),
  ) {
    this.weather = new WeatherMachine(rng, now);
    this.nextEventAt = now + this.interval();
  }

  private interval(): number {
    return EVENT_INTERVAL_MIN_MS + this.rng() * (EVENT_INTERVAL_MAX_MS - EVENT_INTERVAL_MIN_MS);
  }

  activeEvent(): ActiveEvent | null {
    return this.active ? { ...this.active } : null;
  }

  state(now: number, ctx: Pick<DirectorContext, 'seasonStartedAt' | 'seasonDurationMs'>): WorldState {
    return {
      ...worldClock(now, ctx.seasonStartedAt, ctx.seasonDurationMs),
      now,
      weather: this.weather.state().kind,
      event: this.activeEvent(),
    };
  }

  tick(now: number, ctx: DirectorContext): DirectorTick {
    const out: DirectorTick = {};

    const weatherChanged = this.weather.tick(now);
    if (weatherChanged) out.weatherChanged = weatherChanged;

    if (this.active && now >= this.active.endsAt) {
      out.ended = this.active;
      this.active = null;
      this.nextEventAt = now + this.interval();
    }

    if (!this.active && !ctx.monsterTagged && now >= this.nextEventAt) {
      const kind = this.pickEvent(now, ctx);
      if (kind) {
        out.started = kind;
        this.begin(kind, now);
      } else {
        this.nextEventAt = now + 60_000; // nada serve agora (ex.: só chefão em campo): tenta de novo em 1 min
      }
    }
    return out;
  }

  /** Inicia um evento (agendador ou admin). Eventos com duração ficam ativos aqui; os de monstro só zeram o relógio. */
  begin(kind: KingdomEventKind, now: number): void {
    const def = EVENT_DEFS[kind];
    this.nextEventAt = now + this.interval();
    if (def.durationMs) {
      this.active = { kind, name: def.name, startedAt: now, endsAt: now + def.durationMs, durationMs: def.durationMs };
    }
  }

  forceWeather(kind: WeatherKind, now: number): WeatherState {
    return this.weather.force(kind, now);
  }

  private pickEvent(now: number, ctx: DirectorContext): KingdomEventKind | null {
    const phase: DayPhase = worldClock(now, ctx.seasonStartedAt, ctx.seasonDurationMs).phase;
    const options: Array<[KingdomEventKind, number]> = [];
    for (const kind of EVENT_KINDS) {
      // horda só em monstro comum; um chefão em campo não vira horda
      if (kind === 'horde' && ctx.isBoss) continue;
      if (kind === 'eliteBoss' && ctx.isBoss) continue;
      let weight = EVENT_DEFS[kind].weight;
      if (kind === 'bloodMoon') weight *= phase === 'night' ? 3 : phase === 'day' ? 0.3 : 1;
      if (kind === 'dawnBlessing') weight *= phase === 'dawn' ? 3 : phase === 'night' ? 0.3 : 1;
      options.push([kind, weight]);
    }
    if (options.length === 0) return null;
    const total = options.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.rng() * total;
    for (const [kind, weight] of options) {
      roll -= weight;
      if (roll <= 0) return kind;
    }
    return options[options.length - 1][0];
  }
}
