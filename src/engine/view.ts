// Visibility rules and zone helpers. Pure functions shared by the engine, host, log and UI.

import type { CardInstance, GameState, PlayerId, Viewer, ZoneId, ZoneKind } from '../types/state';

export const PLAYERS: readonly PlayerId[] = ['p1', 'p2'];
export const ZONE_KINDS: readonly ZoneKind[] = ['library', 'hand', 'battlefield', 'lands', 'graveyard', 'exile', 'command'];

const ZONES: readonly ZoneId[] = [...PLAYERS.flatMap((p) => ZONE_KINDS.map((k) => `${p}.${k}` as const)), 'stack'];
const ZONE_SET: ReadonlySet<string> = new Set(ZONES);

/** All 15 zones: each player's seven, then the shared stack. */
export function allZones(): ZoneId[] {
  return [...ZONES];
}

export const other = (p: PlayerId): PlayerId => (p === 'p1' ? 'p2' : 'p1');

export function isPlayer(x: unknown): x is PlayerId {
  return x === 'p1' || x === 'p2';
}

/** The player whose side a zone is on, or null for the stack. */
export function zoneOwner(zone: string): PlayerId | null {
  if (zone === 'stack') return null;
  const p = zone.split('.')[0];
  return isPlayer(p) ? p : null;
}

export function zoneKind(zone: string): ZoneKind | 'stack' {
  return zone === 'stack' ? 'stack' : (zone.split('.')[1] as ZoneKind);
}

export function isZone(zone: unknown): zone is ZoneId {
  return typeof zone === 'string' && ZONE_SET.has(zone);
}

/** A signed number as printed on cards: "+2", "−1" (a real minus sign), "+0". */
export const signed = (n: number): string => (n < 0 ? `−${-n}` : `+${n}`);

/** A power/toughness change, "+2/−1". */
export const ptText = (pt: { power: number; toughness: number }): string => `${signed(pt.power)}/${signed(pt.toughness)}`;

/** Zones where cards are "on the battlefield" (tokens survive only here). */
export function isBattlefieldZone(zone: string): boolean {
  const k = zoneKind(zone);
  return k === 'battlefield' || k === 'lands';
}

export function findZone(state: GameState, cardId: string): ZoneId | null {
  for (const z of ZONES) if (state.zones[z].includes(cardId)) return z;
  return null;
}

/** Can `viewer` see the face of `card` while it sits in `zone`? */
export function canSeeFace(state: GameState, card: CardInstance, zone: ZoneId, viewer: Viewer): boolean {
  const kind = zoneKind(zone);
  const owner = zoneOwner(zone);
  if (kind === 'library') {
    // Only the top card, and only when that library plays with its top card face up.
    const top = state.zones[zone][0] === card.id;
    return top && !!owner && state.players[owner].libraryTopFaceUp;
  }
  if (kind === 'hand') return card.revealed || (viewer !== 'nobody' && viewer === owner);
  if (card.faceDown) return viewer !== 'nobody' && viewer === card.owner;
  return true;
}

/** Players who can see the face of a card in a zone. */
export function visibleTo(state: GameState, card: CardInstance, zone: ZoneId): PlayerId[] {
  return PLAYERS.filter((p) => canSeeFace(state, card, zone, p));
}

export function handCount(state: GameState, p: PlayerId): number {
  return state.zones[`${p}.hand`].length;
}

/**
 * What makes two cards in play look the same, for heaps; null for a card that never joins one: an
 * attached card or one carrying attachments, a card with a combat mark (each attacker and blocker
 * must be its own card), and a face-down card (a heap of them would tell the other player they
 * are the same card). The changed-card border counts, so a heap never hides a change.
 */
export function heapKey(state: GameState, card: CardInstance, hosts: ReadonlySet<string>): string | null {
  if (card.attachedTo || hosts.has(card.id) || card.attacking || card.blocking || card.faceDown || card.ability) return null;
  const labeled = Object.entries(card.counters.labeled).filter(([, n]) => n).sort(([a], [b]) => (a < b ? -1 : 1));
  const ch = card.changed;
  const border = ch ? `${ch.entered ? 'entered' : 'changed'}${ch.turn < state.turn ? ' old' : ''}` : '';
  return JSON.stringify([
    card.defId, card.name, card.isToken, card.owner, card.tapped, card.face,
    card.counters.plus, card.counters.minus, labeled, card.turnPT ?? null, card.expires ?? null, border,
  ]);
}

/** Heaps of a battlefield or lands row (see the PRD's Heaps). Drawn by the UI only: no state of their own. */
export interface Heaps {
  /** The row's ids as drawn: each heap by its first card, at that card's place. */
  shown: string[];
  /** For each heap of two or more, its first card's id → every card in it, in row order. */
  members: Map<string, string[]>;
}

/** Group a battlefield or lands row's identical cards into heaps, in row order. */
export function heaps(state: GameState, ids: readonly string[]): Heaps {
  const hosts = new Set<string>();
  for (const id of ids) { const h = state.cards[id]?.attachedTo; if (h) hosts.add(h); }
  const shown: string[] = [];
  const byKey = new Map<string, string[]>();
  for (const id of ids) {
    const c = state.cards[id];
    const key = c ? heapKey(state, c, hosts) : null;
    const heap = key === null ? undefined : byKey.get(key);
    if (heap) { heap.push(id); continue; }
    if (key !== null) byKey.set(key, [id]);
    shown.push(id);
  }
  const members = new Map<string, string[]>();
  for (const m of byKey.values()) if (m.length > 1) members.set(m[0]!, m);
  return { shown, members };
}
