import type {
  User,
  WebcastChatMessage,
  WebcastGiftMessage,
  WebcastLikeMessage,
  WebcastSocialMessage,
} from 'tiktok-live-connector';
import type { GameEvent, GameEventUser } from '../types/GameEvent.js';

function toUser(user: User | undefined): GameEventUser {
  return {
    userId: user?.id ?? 'unknown',
    username: user?.displayId ?? 'unknown',
    nickname: user?.nickname || user?.displayId || 'unknown',
  };
}

export function normalizeChat(msg: WebcastChatMessage): GameEvent {
  return {
    type: 'comment',
    user: toUser(msg.user),
    timestamp: Date.now(),
    comment: msg.content,
  };
}

export function normalizeLike(msg: WebcastLikeMessage): GameEvent {
  return {
    type: 'like',
    user: toUser(msg.user),
    timestamp: Date.now(),
    likeCount: msg.count,
    totalLikes: Number(msg.total ?? msg.count),
  };
}

export function normalizeGift(msg: WebcastGiftMessage): GameEvent | null {
  // repeatEnd === 1 marca o fim do combo (quando repeatável); gifts não-repetíveis
  // disparam uma única vez com repeatEnd já em 1. Ignoramos ticks intermediários
  // do combo (repeatEnd === 0) pra não acionar efeito de jogo a cada frame de combo.
  if (msg.repeatEnd !== 1) return null;

  const diamondUnit = msg.gift?.diamondCount ?? 0;
  const repeatCount = msg.repeatCount || 1;

  return {
    type: 'gift',
    user: toUser(msg.user),
    timestamp: Date.now(),
    giftId: msg.giftId,
    giftName: msg.gift?.name,
    diamondValue: diamondUnit,
    repeatCount,
    comboEnded: true,
    totalDiamondValue: diamondUnit * repeatCount,
  };
}

export function normalizeFollow(msg: WebcastSocialMessage): GameEvent {
  return {
    type: 'follow',
    user: toUser(msg.user),
    timestamp: Date.now(),
    followerCount: msg.followCount ? Number(msg.followCount) : undefined,
  };
}

export function normalizeShare(msg: WebcastSocialMessage): GameEvent {
  return {
    type: 'share',
    user: toUser(msg.user),
    timestamp: Date.now(),
    shareCount: msg.shareCount,
  };
}
