import { isStreakOver, type GiftData } from 'piratetok-live-js';
import type { GameEvent, GameEventUser } from '../types/GameEvent.js';

/** Campos do payload (toJSON do protobuf: int64 chega como string). */
export interface TikTokUser {
  id?: string | number;
  nickname?: string;
  uniqueId?: string;
}

export interface ChatData {
  user?: TikTokUser;
  content?: string;
}

export interface LikeData {
  user?: TikTokUser;
  count?: number | string;
  total?: number | string;
}

export interface GiftPayload extends GiftData {
  user?: TikTokUser;
  giftId?: number | string;
  gift?: GiftData['gift'] & { name?: string };
}

export interface SocialData {
  user?: TikTokUser;
  followCount?: number | string;
  shareCount?: number | string;
}

function toUser(user: TikTokUser | undefined): GameEventUser {
  const username = user?.uniqueId || 'unknown';
  return {
    userId: user?.id !== undefined ? String(user.id) : 'unknown',
    username,
    nickname: user?.nickname || user?.uniqueId || 'unknown',
  };
}

export function normalizeChat(msg: ChatData): GameEvent {
  return {
    type: 'comment',
    user: toUser(msg.user),
    timestamp: Date.now(),
    comment: msg.content,
  };
}

export function normalizeLike(msg: LikeData): GameEvent {
  const count = Number(msg.count ?? 0);
  return {
    type: 'like',
    user: toUser(msg.user),
    timestamp: Date.now(),
    likeCount: count,
    totalLikes: Number(msg.total ?? count),
  };
}

export function normalizeGift(msg: GiftPayload): GameEvent | null {
  // Gifts "combo" (type 1) mandam totais correntes até repeatEnd === 1; ignoramos
  // os ticks intermediários pra não acionar efeito de jogo a cada frame do combo.
  // Gifts não-combo são sempre finais (isStreakOver cuida disso).
  if (!isStreakOver(msg)) return null;

  const diamondUnit = Number(msg.gift?.diamondCount ?? 0);
  const repeatCount = Number(msg.repeatCount) || 1;

  return {
    type: 'gift',
    user: toUser(msg.user),
    timestamp: Date.now(),
    giftId: msg.giftId !== undefined ? String(msg.giftId) : undefined,
    giftName: msg.gift?.name,
    diamondValue: diamondUnit,
    repeatCount,
    comboEnded: true,
    totalDiamondValue: diamondUnit * repeatCount,
  };
}

export function normalizeFollow(msg: SocialData): GameEvent {
  return {
    type: 'follow',
    user: toUser(msg.user),
    timestamp: Date.now(),
    followerCount: msg.followCount ? Number(msg.followCount) : undefined,
  };
}

export function normalizeShare(msg: SocialData): GameEvent {
  return {
    type: 'share',
    user: toUser(msg.user),
    timestamp: Date.now(),
    shareCount: msg.shareCount !== undefined ? Number(msg.shareCount) : undefined,
  };
}
