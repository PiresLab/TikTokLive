// Som sintetizado via Web Audio — sem arquivos de áudio (nada pra faltar ou
// precisar baixar numa live 24/7, e nenhum asset de terceiro pra licenciar).
// Só toca pros eventos que importam (gift/follow/share/onda/chefão/reino/
// season); like e comentário ficam mudos de propósito — acontecem o tempo
// todo e tocar som a cada um cansaria quem assiste por horas.
const Sound = (() => {
  let ctx = null;
  let muted = (() => {
    try {
      return localStorage.getItem('reino_muted') === '1';
    } catch {
      return false;
    }
  })();

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Browsers bloqueiam áudio sem gesto do usuário; no OBS isso não costuma
  // se aplicar, mas o primeiro clique (se houver) já destrava de qualquer jeito.
  document.addEventListener('click', () => getCtx(), { once: true });

  // mudo só em runtime (não persiste): usado pelo iframe de preview do painel admin
  let forcedMute = false;

  function tone(freq, start, duration, { type = 'sine', volume = 0.15 } = {}) {
    if (muted || forcedMute) return;
    const c = getCtx();
    const t0 = c.currentTime + start;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function sequence(notes) {
    notes.forEach(([freq, start, duration, opts]) => tone(freq, start, duration, opts));
  }

  return {
    setMuted(value) {
      muted = value;
      try {
        localStorage.setItem('reino_muted', value ? '1' : '0');
      } catch {
        /* localStorage pode falhar (modo privado) — só não persiste, sem travar o jogo */
      }
    },
    isMuted: () => muted,
    forceMute(value) {
      forcedMute = value;
    },
    giftLow: () => tone(880, 0, 0.12, { volume: 0.12 }),
    giftMedium: () => sequence([[660, 0, 0.1], [990, 0.08, 0.15]]),
    giftHigh: () =>
      sequence([
        [523, 0, 0.12],
        [659, 0.1, 0.12],
        [784, 0.2, 0.3, { volume: 0.22 }],
      ]),
    follow: () => sequence([[440, 0, 0.12], [660, 0.1, 0.18]]),
    share: () => tone(300, 0, 0.15, { type: 'triangle', volume: 0.12 }),
    waveCleared: () => sequence([[523, 0, 0.08], [659, 0.06, 0.12]]),
    bossSpawned: () =>
      sequence([
        [140, 0, 0.4, { type: 'sawtooth', volume: 0.15 }],
        [110, 0.3, 0.5, { type: 'sawtooth', volume: 0.15 }],
      ]),
    bossDefeated: () =>
      sequence([
        [523, 0, 0.12],
        [659, 0.1, 0.12],
        [784, 0.2, 0.12],
        [1047, 0.3, 0.4, { volume: 0.22 }],
      ]),
    kingdomFall: () =>
      sequence([
        [220, 0, 0.4, { type: 'sawtooth', volume: 0.18 }],
        [160, 0.3, 0.6, { type: 'sawtooth', volume: 0.18 }],
      ]),
    newSeason: () => sequence([[392, 0, 0.1], [494, 0.1, 0.1], [587, 0.2, 0.3, { volume: 0.2 }]]),
  };
})();
