let lastTouchAt = Date.now();
const startedAt = Date.now();

/** Chamado a cada tick do motor — se parar de ser chamado, o processo travou. */
export function touch(): void {
  lastTouchAt = Date.now();
}

export function getHealth() {
  const now = Date.now();
  return {
    ok: now - lastTouchAt < 10_000,
    lastEventAgoMs: now - lastTouchAt,
    uptimeSec: Math.round((now - startedAt) / 1000),
  };
}
