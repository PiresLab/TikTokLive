import { EventEmitter } from 'node:events';
import type { NarrativeEvent } from '../gameEngine/GameEngine.js';
import type { GameEvent } from '../types/GameEvent.js';

export type LogKind = 'event' | 'narrative' | 'system';

export interface LogEntry {
  id: number;
  ts: number;
  kind: LogKind;
  text: string;
  test: boolean;
  /** Só pra kind='event': like/comment/gift/follow/share (o painel usa pra filtrar likes). */
  eventType?: string;
}

const MAX_ENTRIES = 200;

export function describeEvent(event: GameEvent): string {
  const who = event.user.nickname;
  switch (event.type) {
    case 'like':
      return `${who} curtiu ×${event.likeCount ?? 1}`;
    case 'comment':
      return `${who}: ${event.comment ?? ''}`;
    case 'gift':
      return `${who} enviou ${event.giftName ?? 'presente'} (${event.totalDiamondValue ?? 0}💎)`;
    case 'follow':
      return `${who} seguiu`;
    case 'share':
      return `${who} compartilhou`;
    default:
      return `${who}: ${event.type}`;
  }
}

export function describeNarrative(n: NarrativeEvent): string {
  switch (n.kind) {
    case 'waveCleared':
      return n.by ? `Onda ${n.wave} derrotada (golpe final: ${n.by.nickname})` : `Onda ${n.wave} derrotada`;
    case 'bossSpawned':
      return `Chefão ${n.name} apareceu (${n.hp} HP)`;
    case 'bossDefeated':
      return n.by ? `Chefão ${n.name} derrotado (golpe final: ${n.by.nickname})` : `Chefão ${n.name} derrotado`;
    case 'kingdomFall':
      return 'O Reino caiu';
    case 'newSeason':
      return `Dia ${n.day} do Cerco começou`;
    case 'goalCompleted':
      return `Meta cumprida: ${n.title} (${n.rewardText})`;
  }
}

/** Buffer circular dos últimos eventos/narrativas/avisos — alimenta o feed do painel admin. */
export class EventLog extends EventEmitter {
  private entries: LogEntry[] = [];
  private nextId = 1;

  add(kind: LogKind, text: string, test = false, eventType?: string): LogEntry {
    const entry: LogEntry = { id: this.nextId, ts: Date.now(), kind, text, test, eventType };
    this.nextId += 1;
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.emit('entry', entry);
    return entry;
  }

  event(event: GameEvent): LogEntry {
    return this.add('event', describeEvent(event), Boolean(event.isTest), event.type);
  }

  narrative(n: NarrativeEvent): LogEntry {
    return this.add('narrative', describeNarrative(n));
  }

  system(text: string): LogEntry {
    return this.add('system', text);
  }

  recent(limit = MAX_ENTRIES): LogEntry[] {
    return this.entries.slice(-limit);
  }
}
