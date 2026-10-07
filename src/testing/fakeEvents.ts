import type { GameEvent } from '../types/GameEvent.js';

export const FAKE_NAMES = ['ana.tk', 'joao_dev', 'carla99', 'pedro.live', 'mari_fan'];

export const FAKE_GIFTS: Array<{ name: string; diamondValue: number }> = [
  { name: 'Rosa', diamondValue: 1 },
  { name: 'Perfume', diamondValue: 20 },
  { name: 'GG', diamondValue: 1 },
  { name: 'Leão', diamondValue: 5000 },
  { name: 'Galáxia', diamondValue: 20000 },
];

export function fakeUser(nickname?: string): GameEvent['user'] {
  const name = nickname ?? FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)];
  return { userId: `fake:${name}`, username: name, nickname: name };
}

/** Evento aleatório com distribuição parecida com live real (mais like/comentário que gift/follow). */
export function randomFakeEvent(isTest = false): GameEvent {
  const roll = Math.random();
  const user = fakeUser();
  const timestamp = Date.now();

  if (roll < 0.4) {
    return { type: 'like', user, timestamp, likeCount: Math.ceil(Math.random() * 20), isTest };
  }
  if (roll < 0.65) {
    // 1 em cada 10 comentários pede o cartão de perfil (!perfil), pra testar o cartão sem estar ao vivo
    return { type: 'comment', user, timestamp, comment: Math.random() < 0.1 ? '!perfil' : 'Vai Reino! 🔥', isTest };
  }
  if (roll < 0.85) {
    const gift = FAKE_GIFTS[Math.floor(Math.random() * FAKE_GIFTS.length)];
    return buildGiftEvent(user, gift.name, gift.diamondValue, 1, isTest);
  }
  if (roll < 0.93) {
    return { type: 'follow', user, timestamp, isTest };
  }
  return { type: 'share', user, timestamp, isTest };
}

function buildGiftEvent(
  user: GameEvent['user'],
  giftName: string,
  diamondValue: number,
  repeatCount: number,
  isTest: boolean,
): GameEvent {
  return {
    type: 'gift',
    user,
    timestamp: Date.now(),
    giftName,
    diamondValue,
    repeatCount,
    totalDiamondValue: diamondValue * repeatCount,
    comboEnded: true,
    isTest,
  };
}

export interface TestEventSpec {
  type: 'like' | 'comment' | 'gift' | 'follow' | 'share';
  nickname?: string;
  likeCount?: number;
  comment?: string;
  giftName?: string;
  diamondValue?: number;
  repeatCount?: number;
}

/** Monta um evento de teste (sempre `isTest: true`) a partir do que o painel admin enviou. */
export function buildTestEvent(spec: TestEventSpec): GameEvent {
  const user = fakeUser(spec.nickname);
  const timestamp = Date.now();

  switch (spec.type) {
    case 'like':
      return { type: 'like', user, timestamp, likeCount: spec.likeCount ?? 1, isTest: true };
    case 'comment':
      return { type: 'comment', user, timestamp, comment: spec.comment ?? 'mensagem de teste', isTest: true };
    case 'gift':
      return buildGiftEvent(user, spec.giftName ?? 'Presente', spec.diamondValue ?? 1, spec.repeatCount ?? 1, true);
    case 'follow':
      return { type: 'follow', user, timestamp, isTest: true };
    case 'share':
      return { type: 'share', user, timestamp, isTest: true };
  }
}
