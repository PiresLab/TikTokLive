export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export interface WorldClock {
  /** 0..1 dentro da season: 0 = nascer do sol; 0,5 = pôr do sol; volta a 0 no dia seguinte do cerco. */
  timeOfDay: number;
  /** Altura do sol, -1 (meia-noite) .. 1 (meio-dia). */
  sunHeight: number;
  phase: DayPhase;
}

/**
 * O dia do jogo é a season: o cerco começa ao amanhecer e a noite cai no meio
 * do dia do cerco. Numa season de 24h isso acompanha o relógio de quem assiste.
 */
export function worldClock(now: number, seasonStartedAt: number, seasonDurationMs: number): WorldClock {
  const raw = (now - seasonStartedAt) / Math.max(1, seasonDurationMs);
  const timeOfDay = ((raw % 1) + 1) % 1;
  const sunHeight = Math.sin(2 * Math.PI * timeOfDay);
  const rising = timeOfDay < 0.25 || timeOfDay >= 0.75;

  let phase: DayPhase;
  if (sunHeight >= 0.2) phase = 'day';
  else if (sunHeight <= -0.2) phase = 'night';
  else phase = rising ? 'dawn' : 'dusk';
  return { timeOfDay, sunHeight, phase };
}
