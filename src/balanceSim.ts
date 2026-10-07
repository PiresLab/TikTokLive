import { GameEngine } from './gameEngine/GameEngine.js';
import type { GameEvent } from './types/GameEvent.js';

/**
 * Simulação offline de economia — roda um dia (24h) de engajamento "médio"
 * através do GameEngine (sem rede/DB/timers reais, via simulateTicks) e
 * imprime onda/HP/Era por hora. Serve pra achar desbalanceamento (onda
 * emperrando, Reino caindo toda hora, Era nunca subindo) antes de descobrir
 * isso ao vivo. Não é teste automatizado (tem aleatoriedade) — é ferramenta
 * de diagnóstico pra rodar manualmente: npm run balance
 */

// Taxas assumidas pra uma live pequena/média (ajustar aqui se o público real for diferente)
const LIKES_PER_MIN = 80;
const COMMENTS_PER_MIN = 6;
const GIFTS_PER_MIN = 1.5;
const FOLLOWS_PER_MIN = 1;
const SHARES_PER_MIN = 0.2;

const GIFT_TIERS: Array<{ name: string; diamondValue: number; weight: number }> = [
  { name: 'Rosa', diamondValue: 1, weight: 0.6 },
  { name: 'Perfume', diamondValue: 20, weight: 0.25 },
  { name: 'GG', diamondValue: 100, weight: 0.1 },
  { name: 'Leão', diamondValue: 5000, weight: 0.04 },
  { name: 'Galáxia', diamondValue: 20000, weight: 0.01 },
];

function pickGiftTier() {
  const roll = Math.random();
  let acc = 0;
  for (const tier of GIFT_TIERS) {
    acc += tier.weight;
    if (roll <= acc) return tier;
  }
  return GIFT_TIERS[0];
}

function poisson(rate: number): number {
  // aproximação simples (rate pequeno): soma de Bernoulli por "sub-minuto"
  let count = 0;
  const steps = 20;
  const p = rate / steps;
  for (let i = 0; i < steps; i += 1) if (Math.random() < p) count += 1;
  return count;
}

function user(i: number) {
  const id = `viewer${i}`;
  return { userId: id, username: id, nickname: id };
}

function simulateMinute(engine: GameEngine): void {
  const likeEvents = Math.max(1, Math.round(LIKES_PER_MIN / 4));
  for (let i = 0; i < 4; i += 1) {
    engine.handleEvent({
      type: 'like',
      user: user(i),
      timestamp: Date.now(),
      likeCount: likeEvents,
    } satisfies GameEvent);
  }

  const comments = poisson(COMMENTS_PER_MIN);
  for (let i = 0; i < comments; i += 1) {
    engine.handleEvent({ type: 'comment', user: user(i), timestamp: Date.now(), comment: 'oi' });
  }

  const gifts = poisson(GIFTS_PER_MIN);
  for (let i = 0; i < gifts; i += 1) {
    const tier = pickGiftTier();
    engine.handleEvent({
      type: 'gift',
      user: user(i),
      timestamp: Date.now(),
      giftName: tier.name,
      totalDiamondValue: tier.diamondValue,
      repeatCount: 1,
      comboEnded: true,
    });
  }

  const follows = poisson(FOLLOWS_PER_MIN);
  for (let i = 0; i < follows; i += 1) {
    engine.handleEvent({ type: 'follow', user: user(1000 + i), timestamp: Date.now() });
  }

  const shares = poisson(SHARES_PER_MIN);
  for (let i = 0; i < shares; i += 1) {
    engine.handleEvent({ type: 'share', user: user(i), timestamp: Date.now() });
  }

  engine.simulateTicks(60);
}

function run(): void {
  const engine = new GameEngine();
  let kingdomFalls = 0;
  engine.on('narrative', (e) => {
    if (e.kind === 'kingdomFall') kingdomFalls += 1;
  });

  console.log('hora | onda | chefão | monstroHP/Max | reinoHP | era            | quedasReino');
  console.log('-----|------|--------|---------------|---------|----------------|------------');

  let lastWave = 1;
  const waveAtHour: number[] = [];

  for (let hour = 1; hour <= 24; hour += 1) {
    for (let min = 0; min < 60; min += 1) simulateMinute(engine);

    const s = engine.getState();
    waveAtHour.push(s.wave);
    const waveGain = s.wave - lastWave;
    lastWave = s.wave;

    console.log(
      `${String(hour).padStart(4)} | ${String(s.wave).padStart(4)} | ${s.isBoss ? '  sim ' : '  não '} | ` +
        `${String(Math.round(s.monsterHp)).padStart(6)}/${String(s.monsterMaxHp).padEnd(6)} | ` +
        `${String(Math.round(s.kingdomHp)).padStart(4)}/${s.kingdomMaxHp} | ${s.era.name.padEnd(14)} | ${kingdomFalls}` +
        (waveGain === 0 ? '   <<< onda travou nessa hora' : ''),
    );
  }

  const lastSixHoursGain = waveAtHour[23] - waveAtHour[17];
  console.log('\n--- resumo ---');
  console.log(`Onda final: ${lastWave}`);
  console.log(`Ondas ganhas nas últimas 6h simuladas: ${lastSixHoursGain}`);
  console.log(`Quedas do Reino no dia: ${kingdomFalls}`);
  if (lastSixHoursGain <= 1) {
    console.log('⚠ ALERTA: progresso quase zerou no fim do dia — crescimento do HP tá rápido demais.');
  } else {
    console.log('OK: progresso seguiu razoável até o fim do dia simulado.');
  }
}

run();
