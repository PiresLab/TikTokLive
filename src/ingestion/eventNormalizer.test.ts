import { describe, expect, it } from 'vitest';
import {
  normalizeChat,
  normalizeFollow,
  normalizeGift,
  normalizeLike,
  normalizeShare,
} from './eventNormalizer.js';

function fakeUser(overrides: Partial<{ id: string; nickname: string; displayId: string }> = {}) {
  return { id: 'uid1', nickname: 'Fulano', displayId: 'fulano.tk', ...overrides } as any;
}

describe('eventNormalizer', () => {
  it('normalizeChat maps content and user', () => {
    const event = normalizeChat({ user: fakeUser(), content: 'oi reino' } as any);
    expect(event.type).toBe('comment');
    expect(event.comment).toBe('oi reino');
    expect(event.user).toEqual({ userId: 'uid1', username: 'fulano.tk', nickname: 'Fulano' });
  });

  it('normalizeLike carries count and total', () => {
    const event = normalizeLike({ user: fakeUser(), count: 5, total: '120' } as any);
    expect(event.type).toBe('like');
    expect(event.likeCount).toBe(5);
    expect(event.totalLikes).toBe(120);
  });

  it('normalizeGift ignores combo ticks (repeatEnd !== 1)', () => {
    const event = normalizeGift({
      user: fakeUser(),
      giftId: '1',
      gift: { name: 'Rosa', diamondCount: 1 },
      repeatCount: 3,
      repeatEnd: 0,
    } as any);
    expect(event).toBeNull();
  });

  it('normalizeGift computes totalDiamondValue on combo end', () => {
    const event = normalizeGift({
      user: fakeUser(),
      giftId: '5655',
      gift: { name: 'Leão', diamondCount: 5000 },
      repeatCount: 2,
      repeatEnd: 1,
    } as any);
    expect(event).not.toBeNull();
    expect(event?.giftName).toBe('Leão');
    expect(event?.diamondValue).toBe(5000);
    expect(event?.repeatCount).toBe(2);
    expect(event?.totalDiamondValue).toBe(10000);
  });

  it('normalizeFollow and normalizeShare map user and counters', () => {
    const follow = normalizeFollow({ user: fakeUser(), followCount: '42' } as any);
    expect(follow.type).toBe('follow');
    expect(follow.followerCount).toBe(42);

    const share = normalizeShare({ user: fakeUser(), shareCount: 3 } as any);
    expect(share.type).toBe('share');
    expect(share.shareCount).toBe(3);
  });
});
