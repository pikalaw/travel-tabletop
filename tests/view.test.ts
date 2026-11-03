import { describe, expect, it } from 'vitest';
import { allZones, canSeeFace, findZone, handCount, isBattlefieldZone, isZone, other, visibleTo, zoneKind, zoneOwner } from '../src/engine/view';
import type { CardInstance, GameState, PlayerId, ZoneId } from '../src/types/state';

function card(id: string, owner: PlayerId, extra: Partial<CardInstance> = {}): CardInstance {
  return { id, defId: 'd', name: id, deckId: 'x', owner, isToken: false, tapped: false, face: 'front', faceDown: false, revealed: false, counters: { plus: 0, minus: 0, labeled: {} }, ...extra };
}

/** A state with the given cards placed in zones. */
function stateWith(placed: Partial<Record<ZoneId, CardInstance[]>>): GameState {
  const zones = Object.fromEntries(allZones().map((z) => [z, [] as string[]])) as Record<ZoneId, string[]>;
  const cards: Record<string, CardInstance> = {};
  for (const [z, cs] of Object.entries(placed) as [ZoneId, CardInstance[]][]) for (const c of cs) { zones[z].push(c.id); cards[c.id] = c; }
  const pl = (name: string) => ({ name, counters: [{ key: 'life', value: 20 }], libraryTopFaceUp: false });
  return { schemaVersion: 1, gameId: 'g', mode: 'same-device', seq: 0, turn: 1, activePlayer: 'p1', nextId: 1, players: { p1: pl('Ann'), p2: pl('Bo') }, cards, zones, result: null };
}

describe('zones', () => {
  it('has 15 zones: seven per player and the stack', () => {
    const z = allZones();
    expect(z).toHaveLength(15);
    expect(z.at(-1)).toBe('stack');
    expect(new Set(z).size).toBe(15);
  });
  it('splits zone ids into owner and kind', () => {
    expect(zoneOwner('p2.lands')).toBe('p2');
    expect(zoneOwner('stack')).toBeNull();
    expect(zoneKind('p1.graveyard')).toBe('graveyard');
    expect(zoneKind('stack')).toBe('stack');
    expect(other('p1')).toBe('p2');
  });
  it('recognises zones and battlefield zones', () => {
    expect(isZone('p1.hand')).toBe(true);
    expect(isZone('p3.hand')).toBe(false);
    expect(isZone(42)).toBe(false);
    expect(isBattlefieldZone('p1.battlefield')).toBe(true);
    expect(isBattlefieldZone('p2.lands')).toBe(true);
    expect(isBattlefieldZone('stack')).toBe(false);
    expect(isBattlefieldZone('p1.exile')).toBe(false);
  });
  it('finds a card and counts a hand', () => {
    const s = stateWith({ 'p1.hand': [card('c1', 'p1'), card('c2', 'p1')], 'p2.exile': [card('c3', 'p2')] });
    expect(findZone(s, 'c3')).toBe('p2.exile');
    expect(findZone(s, 'nope')).toBeNull();
    expect(handCount(s, 'p1')).toBe(2);
    expect(handCount(s, 'p2')).toBe(0);
  });
});

describe('visibility', () => {
  it('hides hands from the opponent and from nobody, unless revealed', () => {
    const s = stateWith({ 'p1.hand': [card('c1', 'p1'), card('c2', 'p1', { revealed: true })] });
    expect(canSeeFace(s, s.cards.c1!, 'p1.hand', 'p1')).toBe(true);
    expect(canSeeFace(s, s.cards.c1!, 'p1.hand', 'p2')).toBe(false);
    expect(canSeeFace(s, s.cards.c1!, 'p1.hand', 'nobody')).toBe(false);
    expect(visibleTo(s, s.cards.c2!, 'p1.hand')).toEqual(['p1', 'p2']);
  });
  it('a hand belongs to the zone, not the card: the owner of the zone sees it', () => {
    const s = stateWith({ 'p2.hand': [card('c1', 'p1')] });
    expect(visibleTo(s, s.cards.c1!, 'p2.hand')).toEqual(['p2']);
  });
  it('a library shows only its top card, only with libraryTopFaceUp', () => {
    const s = stateWith({ 'p1.library': [card('c1', 'p1'), card('c2', 'p1')] });
    expect(visibleTo(s, s.cards.c1!, 'p1.library')).toEqual([]);
    s.players.p1.libraryTopFaceUp = true;
    expect(visibleTo(s, s.cards.c1!, 'p1.library')).toEqual(['p1', 'p2']);
    expect(visibleTo(s, s.cards.c2!, 'p1.library')).toEqual([]);
  });
  it('face-down cards are seen only by their owner, wherever they are', () => {
    const s = stateWith({ 'p1.exile': [card('c1', 'p1', { faceDown: true })], 'p1.battlefield': [card('c2', 'p2', { faceDown: true })] });
    expect(visibleTo(s, s.cards.c1!, 'p1.exile')).toEqual(['p1']);
    expect(visibleTo(s, s.cards.c2!, 'p1.battlefield')).toEqual(['p2']);
    expect(canSeeFace(s, s.cards.c1!, 'p1.exile', 'nobody')).toBe(false);
  });
  it('everything else is public, the stack included', () => {
    const s = stateWith({ stack: [card('c1', 'p2')], 'p1.graveyard': [card('c2', 'p1')] });
    expect(visibleTo(s, s.cards.c1!, 'stack')).toEqual(['p1', 'p2']);
    expect(canSeeFace(s, s.cards.c2!, 'p1.graveyard', 'nobody')).toBe(true);
  });
});
