import { describe, expect, it } from 'vitest';
import { buildTestEvent, randomFakeEvent } from '../testing/fakeEvents.js';
import { parseCommand } from './commands.js';
import { EventLog, describeEvent, describeNarrative } from './eventLog.js';

describe('parseCommand', () => {
  it('parses simple no-arg commands', () => {
    for (const cmd of ['spawnBoss', 'endSeason', 'pause', 'resume', 'stopBurst', 'resetBalance']) {
      expect(parseCommand({ cmd })).toEqual({ ok: true, command: { cmd } });
    }
  });

  it('rejects non-objects, missing and unknown cmd', () => {
    expect(parseCommand(null).ok).toBe(false);
    expect(parseCommand('x').ok).toBe(false);
    expect(parseCommand([]).ok).toBe(false);
    expect(parseCommand({}).ok).toBe(false);
    expect(parseCommand({ cmd: 'formatC' }).ok).toBe(false);
  });

  it('inject: validates type, trims text and enforces limits', () => {
    const ok = parseCommand({
      cmd: 'inject',
      event: { type: 'gift', nickname: '  maria  ', giftName: 'Leão', diamondValue: 5000 },
    });
    expect(ok).toMatchObject({ ok: true, command: { cmd: 'inject', event: { type: 'gift', nickname: 'maria', diamondValue: 5000 } } });

    expect(parseCommand({ cmd: 'inject', event: { type: 'boom' } }).ok).toBe(false);
    expect(parseCommand({ cmd: 'inject', event: { type: 'like', likeCount: 1_000_000 } }).ok).toBe(false);
    expect(parseCommand({ cmd: 'inject', event: { type: 'gift', diamondValue: -1 } }).ok).toBe(false);
    expect(parseCommand({ cmd: 'inject', event: { type: 'comment', comment: 'x'.repeat(500) } }).ok).toBe(false);
    expect(parseCommand({ cmd: 'inject', event: { type: 'like', nickname: 5 } }).ok).toBe(false);
    expect(parseCommand({ cmd: 'inject' }).ok).toBe(false);
  });

  it('burst: requires rate and seconds inside the limits', () => {
    expect(parseCommand({ cmd: 'burst', ratePerSec: 20, seconds: 30 })).toEqual({
      ok: true,
      command: { cmd: 'burst', ratePerSec: 20, seconds: 30 },
    });
    expect(parseCommand({ cmd: 'burst', ratePerSec: 0, seconds: 30 }).ok).toBe(false);
    expect(parseCommand({ cmd: 'burst', ratePerSec: 9999, seconds: 30 }).ok).toBe(false);
    expect(parseCommand({ cmd: 'burst', ratePerSec: 10, seconds: 99999 }).ok).toBe(false);
    expect(parseCommand({ cmd: 'burst', ratePerSec: 10 }).ok).toBe(false);
  });

  it('setWave / amounts: numeric, finite and bounded', () => {
    expect(parseCommand({ cmd: 'setWave', wave: 12 }).ok).toBe(true);
    expect(parseCommand({ cmd: 'setWave', wave: 0 }).ok).toBe(false);
    expect(parseCommand({ cmd: 'setWave', wave: 1.5 }).ok).toBe(false);
    expect(parseCommand({ cmd: 'setWave', wave: '5' }).ok).toBe(false);
    expect(parseCommand({ cmd: 'healKingdom', amount: 100 }).ok).toBe(true);
    expect(parseCommand({ cmd: 'damageKingdom', amount: Number.NaN }).ok).toBe(false);
    expect(parseCommand({ cmd: 'addScore', amount: 0 }).ok).toBe(false);
  });

  it('setBalance: delegates to balance validation', () => {
    expect(parseCommand({ cmd: 'setBalance', balance: { dmgPerLike: 1 } }).ok).toBe(true);
    expect(parseCommand({ cmd: 'setBalance', balance: { monsterHpGrowth: 5 } }).ok).toBe(false);
    expect(parseCommand({ cmd: 'setBalance', balance: { hack: 1 } }).ok).toBe(false);
    expect(parseCommand({ cmd: 'setBalance' }).ok).toBe(false);
  });
});

describe('fakeEvents', () => {
  it('buildTestEvent always flags isTest and fills defaults', () => {
    const gift = buildTestEvent({ type: 'gift', giftName: 'Leão', diamondValue: 5000, repeatCount: 2 });
    expect(gift.isTest).toBe(true);
    expect(gift.totalDiamondValue).toBe(10_000);
    expect(buildTestEvent({ type: 'like' }).likeCount).toBe(1);
    expect(buildTestEvent({ type: 'follow', nickname: 'ana' }).user.nickname).toBe('ana');
    expect(buildTestEvent({ type: 'comment' }).comment).toBeTruthy();
  });

  it('randomFakeEvent honours the isTest flag', () => {
    expect(randomFakeEvent(true).isTest).toBe(true);
    expect(randomFakeEvent().isTest).toBe(false);
  });
});

describe('EventLog', () => {
  it('keeps at most 200 entries (ring buffer) with increasing ids', () => {
    const log = new EventLog();
    for (let i = 0; i < 250; i += 1) log.system(`msg ${i}`);
    const all = log.recent();
    expect(all).toHaveLength(200);
    expect(all[0].text).toBe('msg 50');
    expect(all[199].text).toBe('msg 249');
    expect(all[199].id).toBeGreaterThan(all[0].id);
  });

  it('flags test events and emits entries', () => {
    const log = new EventLog();
    const seen: string[] = [];
    log.on('entry', (e) => seen.push(e.text));
    const entry = log.event(buildTestEvent({ type: 'follow', nickname: 'bia' }));
    expect(entry.test).toBe(true);
    expect(seen).toEqual(['bia seguiu']);
  });

  it('describes events and narratives in pt-BR', () => {
    expect(describeEvent(buildTestEvent({ type: 'like', nickname: 'x', likeCount: 5 }))).toBe('x curtiu ×5');
    expect(describeNarrative({ kind: 'waveCleared', wave: 3 })).toBe('Onda 3 derrotada');
    expect(describeNarrative({ kind: 'kingdomFall' })).toBe('O Reino caiu');
  });
});
