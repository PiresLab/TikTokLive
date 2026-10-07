import { validateBalance, type BalanceConfig } from '../gameEngine/balance.js';
import type { TestEventSpec } from '../testing/fakeEvents.js';
import { EVENT_KINDS, type KingdomEventKind } from '../world/events.js';
import { WEATHER_KINDS, type WeatherKind } from '../world/weather.js';

export type AdminCommand =
  | { cmd: 'inject'; event: TestEventSpec }
  | { cmd: 'burst'; ratePerSec: number; seconds: number }
  | { cmd: 'stopBurst' }
  | { cmd: 'spawnBoss' }
  | { cmd: 'setWave'; wave: number }
  | { cmd: 'healKingdom'; amount: number }
  | { cmd: 'damageKingdom'; amount: number }
  | { cmd: 'endSeason' }
  | { cmd: 'addScore'; amount: number }
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'setBalance'; balance: Partial<BalanceConfig> }
  | { cmd: 'resetBalance' }
  | { cmd: 'grantXp'; nickname: string; amount: number }
  | { cmd: 'resetProgress' }
  | { cmd: 'triggerEvent'; event: KingdomEventKind }
  | { cmd: 'setWeather'; weather: WeatherKind };

export type ParseResult = { ok: true; command: AdminCommand } | { ok: false; error: string };

const EVENT_TYPES = ['like', 'comment', 'gift', 'follow', 'share'] as const;

export const LIMITS = {
  nicknameLength: 30,
  commentLength: 200,
  giftNameLength: 40,
  likeCount: 10_000,
  diamondValue: 1_000_000,
  repeatCount: 1_000,
  burstRatePerSec: 200,
  burstSeconds: 600,
  wave: 10_000,
  kingdomAmount: 1_000_000,
  score: 10_000_000,
  xp: 1_000_000,
} as const;

const fail = (error: string): ParseResult => ({ ok: false, error });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberIn(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  options: { integer?: boolean; optional?: boolean } = {},
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const raw = source[key];
  if (raw === undefined) {
    return options.optional ? { ok: true, value: undefined } : { ok: false, error: `${key} é obrigatório` };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, error: `${key} deve ser um número` };
  if (options.integer && !Number.isInteger(raw)) return { ok: false, error: `${key} deve ser inteiro` };
  if (raw < min || raw > max) return { ok: false, error: `${key} fora da faixa (${min} a ${max})` };
  return { ok: true, value: raw };
}

function stringIn(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const raw = source[key];
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string') return { ok: false, error: `${key} deve ser texto` };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };
  if (trimmed.length > maxLength) return { ok: false, error: `${key} passa de ${maxLength} caracteres` };
  return { ok: true, value: trimmed };
}

function parseEventSpec(raw: unknown): { ok: true; spec: TestEventSpec } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'event deve ser um objeto' };
  const type = raw.type;
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `type deve ser um de: ${EVENT_TYPES.join(', ')}` };
  }

  const nickname = stringIn(raw, 'nickname', LIMITS.nicknameLength);
  if (!nickname.ok) return nickname;
  const comment = stringIn(raw, 'comment', LIMITS.commentLength);
  if (!comment.ok) return comment;
  const giftName = stringIn(raw, 'giftName', LIMITS.giftNameLength);
  if (!giftName.ok) return giftName;
  const likeCount = numberIn(raw, 'likeCount', 1, LIMITS.likeCount, { integer: true, optional: true });
  if (!likeCount.ok) return likeCount;
  const diamondValue = numberIn(raw, 'diamondValue', 0, LIMITS.diamondValue, { integer: true, optional: true });
  if (!diamondValue.ok) return diamondValue;
  const repeatCount = numberIn(raw, 'repeatCount', 1, LIMITS.repeatCount, { integer: true, optional: true });
  if (!repeatCount.ok) return repeatCount;

  return {
    ok: true,
    spec: {
      type: type as TestEventSpec['type'],
      nickname: nickname.value,
      comment: comment.value,
      giftName: giftName.value,
      likeCount: likeCount.value,
      diamondValue: diamondValue.value,
      repeatCount: repeatCount.value,
    },
  };
}

/** Valida o JSON vindo do painel antes de qualquer coisa encostar no motor. */
export function parseCommand(input: unknown): ParseResult {
  if (!isRecord(input)) return fail('corpo deve ser um objeto JSON');
  const cmd = input.cmd;
  if (typeof cmd !== 'string') return fail('cmd ausente');

  switch (cmd) {
    case 'inject': {
      const spec = parseEventSpec(input.event);
      return spec.ok ? { ok: true, command: { cmd, event: spec.spec } } : fail(spec.error);
    }
    case 'burst': {
      const rate = numberIn(input, 'ratePerSec', 1, LIMITS.burstRatePerSec);
      if (!rate.ok) return fail(rate.error);
      const seconds = numberIn(input, 'seconds', 1, LIMITS.burstSeconds);
      if (!seconds.ok) return fail(seconds.error);
      return { ok: true, command: { cmd, ratePerSec: rate.value as number, seconds: seconds.value as number } };
    }
    case 'setWave': {
      const wave = numberIn(input, 'wave', 1, LIMITS.wave, { integer: true });
      return wave.ok ? { ok: true, command: { cmd, wave: wave.value as number } } : fail(wave.error);
    }
    case 'healKingdom':
    case 'damageKingdom': {
      const amount = numberIn(input, 'amount', 0, LIMITS.kingdomAmount);
      return amount.ok ? { ok: true, command: { cmd, amount: amount.value as number } } : fail(amount.error);
    }
    case 'addScore': {
      const amount = numberIn(input, 'amount', 1, LIMITS.score, { integer: true });
      return amount.ok ? { ok: true, command: { cmd, amount: amount.value as number } } : fail(amount.error);
    }
    case 'setBalance': {
      const result = validateBalance(input.balance);
      return result.ok ? { ok: true, command: { cmd, balance: result.value } } : fail(result.error);
    }
    case 'grantXp': {
      const nickname = stringIn(input, 'nickname', LIMITS.nicknameLength);
      if (!nickname.ok) return fail(nickname.error);
      if (nickname.value === undefined) return fail('nickname é obrigatório');
      const amount = numberIn(input, 'amount', 1, LIMITS.xp, { integer: true });
      if (!amount.ok) return fail(amount.error);
      return { ok: true, command: { cmd, nickname: nickname.value, amount: amount.value as number } };
    }
    case 'triggerEvent': {
      const event = input.event;
      if (typeof event !== 'string' || !(EVENT_KINDS as readonly string[]).includes(event)) {
        return fail(`event deve ser um de: ${EVENT_KINDS.join(', ')}`);
      }
      return { ok: true, command: { cmd, event: event as KingdomEventKind } };
    }
    case 'setWeather': {
      const weather = input.weather;
      if (typeof weather !== 'string' || !(WEATHER_KINDS as readonly string[]).includes(weather)) {
        return fail(`weather deve ser um de: ${WEATHER_KINDS.join(', ')}`);
      }
      return { ok: true, command: { cmd, weather: weather as WeatherKind } };
    }
    case 'stopBurst':
    case 'resetProgress':
    case 'spawnBoss':
    case 'endSeason':
    case 'pause':
    case 'resume':
    case 'resetBalance':
      return { ok: true, command: { cmd } };
    default:
      return fail(`comando desconhecido: ${cmd}`);
  }
}
