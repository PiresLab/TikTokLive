import type { GameEvent } from '../types/GameEvent.js';

/** Mesmos pesos do `lifetimeScore` do motor: uma economia só, a Era do Reino e o nível das pessoas andam juntos. */
export const XP_WEIGHTS = { like: 0.1, comment: 2, follow: 10, share: 15, diamond: 1 } as const;

export function xpForEvent(event: GameEvent): number {
  switch (event.type) {
    case 'like':
      return (event.likeCount ?? 1) * XP_WEIGHTS.like;
    case 'comment':
      return XP_WEIGHTS.comment;
    case 'gift':
      return (event.totalDiamondValue ?? 0) * XP_WEIGHTS.diamond;
    case 'follow':
      return XP_WEIGHTS.follow;
    case 'share':
      return XP_WEIGHTS.share;
    default:
      return 0;
  }
}
