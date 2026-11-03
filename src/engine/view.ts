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
