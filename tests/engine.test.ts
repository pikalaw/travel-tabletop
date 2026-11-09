// Ported from v1's tests/engine.test.js (tag v1). The host-level cases (notices, undo
// exactness, replay, the snapshot cap) live in host.test.ts.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { apply, emptyState, checkInvariants } from '../src/engine/engine';
import { canSeeFace, visibleTo, allZones } from '../src/engine/view';
import type { Actor, GameState } from '../src/types/state';
import type { Command } from '../src/types/commands';
import { Table, seeded, started } from './support';
import { cmdArb, concretize } from './steps';

describe('engine basics', () => {
  it('starts a game: shuffles, deals 7, sets life', () => {
    const h = started();
    const s = h.state;
    expect(s.zones['p1.hand']).toHaveLength(7);
    expect(s.zones['p1.library']).toHaveLength(33);
    expect(s.zones['p2.hand']).toHaveLength(7);
    expect(s.players.p1.counters[0]).toEqual({ key: 'life', value: 20 });
    expect(checkInvariants(s)).toBeNull();
  });

  it('moves a card and rejects a stale move', () => {
    const h = started();
    const id = h.state.zones['p1.hand'][0];
    expect(h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: id, from: 'p1.hand', to: 'p1.battlefield' } }).ok).toBe(true);
    const stale = h.dispatch({ type: 'move', actor: 'p2', payload: { cardId: id, from: 'p1.hand', to: 'p1.graveyard' } });
    expect(stale).toMatchObject({ ok: false, error: 'stale' });
    expect(h.state.zones['p1.battlefield']).toEqual([id]);
  });

  it('taps, and resets tapped/counters when leaving the battlefield', () => {
    const h = started();
    const id = h.state.zones['p1.hand'][0];
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: id, from: 'p1.hand', to: 'p1.battlefield' } });
    h.dispatch({ type: 'tap', actor: 'p1', payload: { cardId: id, from: 'p1.battlefield' } });
    h.dispatch({ type: 'addCounter', actor: 'p1', payload: { cardId: id, kind: 'plus' } });
    expect(h.state.cards[id].tapped).toBe(true);
    expect(h.state.cards[id].counters.plus).toBe(1);
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: id, from: 'p1.battlefield', to: 'p1.graveyard', toIndex: 0 } });
    expect(h.state.cards[id].tapped).toBe(false);
    expect(h.state.cards[id].counters.plus).toBe(0);
  });

  it('tokens disappear when they leave the battlefield', () => {
    const h = started();
    h.dispatch({ type: 'createToken', actor: 'p1', payload: { defId: 'tok', name: 'Soldier', to: 'p1.battlefield' } });
    const tid = h.state.zones['p1.battlefield'][0];
    expect(h.state.cards[tid].isToken).toBe(true);
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: tid, from: 'p1.battlefield', to: 'p1.graveyard' } });
    expect(h.state.cards[tid]).toBeUndefined();
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('an ability goes on top of the stack with its source picture, and is deleted when it leaves', () => {
    const h = started();
    const [src, spell] = h.state.zones['p1.hand'];
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: src, from: 'p1.hand', to: 'p1.battlefield' } });
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: spell, from: 'p1.hand', to: 'stack', toIndex: 0 } });
    expect(h.dispatch({ type: 'putAbility', actor: 'p1', payload: { cardId: src, from: 'p1.battlefield', text: '  {T}: Add {G}. ' } }).ok).toBe(true);
    const [aid, below] = h.state.zones.stack;
    expect(below).toBe(spell);
    expect(aid).toMatch(/^a\d+$/);
    const item = h.state.cards[aid];
    expect(item).toMatchObject({ defId: h.state.cards[src].defId, name: h.state.cards[src].name, owner: 'p1', isToken: false, faceDown: false, ability: { text: '{T}: Add {G}.', sourceId: src } });
    // the source gets the changed mark, as for any change to a card in play
    expect(h.state.cards[src].changed).toEqual({ by: 'p1', turn: 1 });
    // reordering on the stack keeps it; it cannot be attached; moving it off deletes it, source unmoved
    expect(h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: aid, from: 'stack', to: 'stack', toIndex: 1 } }).ok).toBe(true);
    expect(h.dispatch({ type: 'attach', actor: 'p1', payload: { cardId: aid, from: 'stack', toCardId: src, toZone: 'p1.battlefield' } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: aid, from: 'stack', to: 'p1.graveyard' } }).ok).toBe(true);
    expect(h.state.cards[aid]).toBeUndefined();
    expect(h.state.zones.stack).toEqual([spell]);
    expect(h.state.zones['p1.battlefield']).toEqual([src]);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('an ability of a face-down card is face down too; empty or oversized text is refused', () => {
    const h = started();
    const src = h.state.zones['p1.hand'][0];
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: src, from: 'p1.hand', to: 'p1.battlefield' } });
    h.dispatch({ type: 'setFaceDown', actor: 'p1', payload: { cardId: src, from: 'p1.battlefield', value: true } });
    h.dispatch({ type: 'putAbility', actor: 'p1', payload: { cardId: src, from: 'p1.battlefield', text: 'Morph {2}{G}' } });
    const item = h.state.cards[h.state.zones.stack[0]];
    expect(item.faceDown).toBe(true);
    expect(canSeeFace(h.state, item, 'stack', 'p1')).toBe(true);
    expect(canSeeFace(h.state, item, 'stack', 'p2')).toBe(false);
    expect(h.dispatch({ type: 'putAbility', actor: 'p1', payload: { cardId: src, from: 'p1.battlefield', text: '   ' } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(h.dispatch({ type: 'putAbility', actor: 'p1', payload: { cardId: src, from: 'p1.battlefield', text: 'x'.repeat(2001) } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(h.dispatch({ type: 'putAbility', actor: 'p1', payload: { cardId: src, from: 'p1.hand', text: 'x' } })).toMatchObject({ ok: false, error: 'stale' });
  });

  it('labeled counters add and remove', () => {
    const h = started();
    const id = h.state.zones['p1.hand'][0];
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: id, from: 'p1.hand', to: 'p1.battlefield' } });
    h.dispatch({ type: 'addCounter', actor: 'p1', payload: { cardId: id, kind: 'label', label: 'loyalty', n: 3 } });
    expect(h.state.cards[id].counters.labeled.loyalty).toBe(3);
    h.dispatch({ type: 'removeCounter', actor: 'p1', payload: { cardId: id, kind: 'label', label: 'loyalty', n: 3 } });
    expect(h.state.cards[id].counters.labeled.loyalty).toBeUndefined();
    expect(h.dispatch({ type: 'removeCounter', actor: 'p1', payload: { cardId: id, kind: 'plus' } }).ok).toBe(false);
  });

  it('player counters: life is fixed, others add and remove', () => {
    const h = started();
    h.dispatch({ type: 'setPlayerCounter', actor: 'p2', payload: { player: 'p1', key: 'life', value: 17 } });
    expect(h.state.players.p1.counters[0].value).toBe(17);
    expect(h.dispatch({ type: 'removePlayerCounter', actor: 'p1', payload: { player: 'p1', key: 'life' } }).ok).toBe(false);
    h.dispatch({ type: 'addPlayerCounter', actor: 'p1', payload: { player: 'p1', key: 'poison' } });
    h.dispatch({ type: 'setPlayerCounter', actor: 'p1', payload: { player: 'p1', key: 'poison', value: 2 } });
    expect(h.state.players.p1.counters[1]).toEqual({ key: 'poison', value: 2 });
    h.dispatch({ type: 'removePlayerCounter', actor: 'p1', payload: { player: 'p1', key: 'poison' } });
    expect(h.state.players.p1.counters).toHaveLength(1);
  });

  it('pass turn untaps the next player and increments the turn', () => {
    const h = started();
    const id = h.state.zones['p2.hand'][0];
    h.dispatch({ type: 'move', actor: 'p2', payload: { cardId: id, from: 'p2.hand', to: 'p2.lands' } });
    h.dispatch({ type: 'tap', actor: 'p2', payload: { cardId: id, from: 'p2.lands' } });
    h.dispatch({ type: 'passTurn', actor: 'p1', payload: { to: 'p2' } });
    expect(h.state.turn).toBe(2);
    expect(h.state.activePlayer).toBe('p2');
    expect(h.state.cards[id].tapped).toBe(false);
  });

});

describe('visibility', () => {
  it('hides hands from the opponent and from nobody', () => {
    const h = started();
    const s = h.state;
    const id = s.zones['p1.hand'][0];
    expect(canSeeFace(s, s.cards[id], 'p1.hand', 'p1')).toBe(true);
    expect(canSeeFace(s, s.cards[id], 'p1.hand', 'p2')).toBe(false);
    expect(canSeeFace(s, s.cards[id], 'p1.hand', 'nobody')).toBe(false);
  });
  it('library top face-up shows only the top card', () => {
    const h = started();
    h.dispatch({ type: 'setLibraryTopFaceUp', actor: 'p1', payload: { player: 'p1', value: true } });
    const s = h.state;
    const [top, second] = s.zones['p1.library'];
    expect(visibleTo(s, s.cards[top], 'p1.library')).toEqual(['p1', 'p2']);
    expect(visibleTo(s, s.cards[second], 'p1.library')).toEqual([]);
  });
  it('face-down cards on the battlefield are seen only by the owner', () => {
    const h = started();
    const id = h.state.zones['p1.hand'][0];
    h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: id, from: 'p1.hand', to: 'p1.exile' } });
    h.dispatch({ type: 'setFaceDown', actor: 'p1', payload: { cardId: id, from: 'p1.exile', value: true } });
    expect(visibleTo(h.state, h.state.cards[id], 'p1.exile')).toEqual(['p1']);
  });
});

describe('attachments', () => {
  const mv = (h: Table, id: string, from: string, to: string, toIndex?: number) => h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: id, from, to, toIndex } });
  const att = (h: Table, id: string, from: string, toCardId: string, toZone: string) => h.dispatch({ type: 'attach', actor: 'p1', payload: { cardId: id, from, toCardId, toZone } });
  function setup() {
    const h = started();
    const [a, b, c, d] = h.state.zones['p1.hand'];
    for (const id of [a, b, c]) mv(h, id, 'p1.hand', 'p1.battlefield');
    return { h, a, b, c, d };
  }

  it('attaches from hand onto a creature, tucked just before it', () => {
    const { h, a, b, c, d } = setup();
    expect(att(h, d, 'p1.hand', b, 'p1.battlefield').ok).toBe(true);
    expect(h.state.zones['p1.battlefield']).toEqual([a, d, b, c]);
    expect(h.state.cards[d].attachedTo).toBe(b);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('a new attachment goes farthest from the host, at the left end of its group', () => {
    const { h, a, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    expect(att(h, c, 'p1.battlefield', b, 'p1.battlefield').ok).toBe(true);
    expect(h.state.zones['p1.battlefield']).toEqual([a, c, d, b]);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('make lead: swaps with the old lead, the group attaches to it, combat marks move, tapped and counters stay', () => {
    const { h, a, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    att(h, c, 'p1.battlefield', b, 'p1.battlefield'); // [a, c, d, b]
    const x = h.state.zones['p2.hand'][0];
    h.dispatch({ type: 'move', actor: 'p2', payload: { cardId: x, from: 'p2.hand', to: 'p2.battlefield' } });
    h.dispatch({ type: 'tap', actor: 'p1', payload: { cardId: b, from: 'p1.battlefield' } });
    h.dispatch({ type: 'addCounter', actor: 'p1', payload: { cardId: b, from: 'p1.battlefield', kind: 'plus' } });
    expect(h.dispatch({ type: 'attack', actor: 'p1', payload: { cardId: b, from: 'p1.battlefield' } }).ok).toBe(true);
    expect(h.dispatch({ type: 'block', actor: 'p2', payload: { cardId: x, from: 'p2.battlefield', attackerId: b, attackerZone: 'p1.battlefield' } }).ok).toBe(true);
    const before = h.state;

    expect(h.dispatch({ type: 'setLead', actor: 'p1', payload: { cardId: c, from: 'p1.battlefield' } }).ok).toBe(true);
    const s = h.state;
    expect(s.zones['p1.battlefield']).toEqual([a, b, d, c]);
    expect(s.cards[c].attachedTo).toBeUndefined();
    expect([b, d].map((id) => s.cards[id].attachedTo)).toEqual([c, c]);
    expect(s.cards[c].attacking).toBe(before.cards[b].attacking);
    expect(s.cards[b].attacking).toBeUndefined();
    expect(s.cards[x].blocking).toEqual([c]);
    expect([s.cards[b].tapped, s.cards[c].tapped]).toEqual([true, false]);
    expect([s.cards[b].counters.plus, s.cards[c].counters.plus]).toEqual([1, 0]);
    expect(checkInvariants(s)).toBeNull();

    // the lead itself has nothing to promote; one undo puts everything back
    expect(h.dispatch({ type: 'setLead', actor: 'p1', payload: { cardId: c, from: 'p1.battlefield' } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(h.dispatch({ type: 'undo', actor: 'p1', payload: {} }).ok).toBe(true);
    expect(h.state.zones['p1.battlefield']).toEqual(before.zones['p1.battlefield']);
    expect(h.state.cards[b].attacking).toBe(before.cards[b].attacking);
    expect(h.state.cards[x].blocking).toEqual([b]);
  });

  it('make lead moves a blocking group\'s blocks to the new lead', () => {
    const { h, b, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    const x = h.state.zones['p2.hand'][0];
    h.dispatch({ type: 'move', actor: 'p2', payload: { cardId: x, from: 'p2.hand', to: 'p2.battlefield' } });
    h.dispatch({ type: 'passTurn', actor: 'p1', payload: { to: 'p2' } });
    h.dispatch({ type: 'attack', actor: 'p2', payload: { cardId: x, from: 'p2.battlefield' } });
    expect(h.dispatch({ type: 'block', actor: 'p1', payload: { cardId: b, from: 'p1.battlefield', attackerId: x, attackerZone: 'p2.battlefield' } }).ok).toBe(true);
    expect(h.dispatch({ type: 'setLead', actor: 'p1', payload: { cardId: d, from: 'p1.battlefield' } }).ok).toBe(true);
    expect(h.state.cards[d].blocking).toEqual([x]);
    expect(h.state.cards[b].blocking).toBeUndefined();
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('moves into the host zone, even the opponent battlefield', () => {
    const h = started();
    const mine = h.state.zones['p1.hand'][0], theirs = h.state.zones['p2.hand'][0];
    h.dispatch({ type: 'move', actor: 'p2', payload: { cardId: theirs, from: 'p2.hand', to: 'p2.battlefield' } });
    expect(att(h, mine, 'p1.hand', theirs, 'p2.battlefield').ok).toBe(true);
    expect(h.state.zones['p2.battlefield']).toEqual([mine, theirs]);
    expect(h.state.cards[mine].owner).toBe('p1');
  });

  it('attaching to an attached card goes onto its host (one level)', () => {
    const { h, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    expect(att(h, c, 'p1.battlefield', d, 'p1.battlefield').ok).toBe(true);
    expect(h.state.cards[c].attachedTo).toBe(b);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('a host attached elsewhere brings its attachments; self-attach is refused', () => {
    const { h, a, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    expect(att(h, b, 'p1.battlefield', d, 'p1.battlefield')).toMatchObject({ ok: false, error: 'invalid' });
    expect(att(h, b, 'p1.battlefield', c, 'p1.battlefield').ok).toBe(true);
    expect(h.state.cards[b].attachedTo).toBe(c);
    expect(h.state.cards[d].attachedTo).toBe(c);
    expect(h.state.zones['p1.battlefield']).toEqual([a, d, b, c]);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('moving the host carries its attachments; tapping taps only the host', () => {
    const { h, a, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    h.dispatch({ type: 'tap', actor: 'p1', payload: { cardId: b, from: 'p1.battlefield' } });
    expect(h.state.cards[b].tapped).toBe(true);
    expect(h.state.cards[d].tapped).toBe(false);
    mv(h, b, 'p1.battlefield', 'p1.battlefield', 2); // index counted without the group: after c
    expect(h.state.zones['p1.battlefield']).toEqual([a, c, d, b]);
    mv(h, b, 'p1.battlefield', 'p2.battlefield');
    expect(h.state.zones['p2.battlefield']).toEqual([d, b]);
    expect(h.state.cards[d].attachedTo).toBe(b);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('leaving play detaches; attachments stay where they were', () => {
    const { h, a, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    mv(h, b, 'p1.battlefield', 'p1.graveyard', 0);
    expect(h.state.zones['p1.battlefield']).toEqual([a, d, c]);
    expect(h.state.cards[d].attachedTo).toBeUndefined();
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('a removed token host frees its attachments', () => {
    const { h, d } = setup();
    h.dispatch({ type: 'createToken', actor: 'p1', payload: { defId: 'tok', name: 'T', to: 'p1.battlefield' } });
    const t = h.state.zones['p1.battlefield'].at(-1)!;
    att(h, d, 'p1.hand', t, 'p1.battlefield');
    h.dispatch({ type: 'removeToken', actor: 'p1', payload: { cardId: t, from: 'p1.battlefield' } });
    expect(h.state.cards[d].attachedTo).toBeUndefined();
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('dragging an attachment away detaches it; detach puts it right of the host', () => {
    const { h, a, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    mv(h, d, 'p1.battlefield', 'p1.battlefield', 0);
    expect(h.state.cards[d].attachedTo).toBeUndefined();
    expect(h.state.zones['p1.battlefield']).toEqual([d, a, b, c]);
    att(h, d, 'p1.battlefield', b, 'p1.battlefield');
    expect(h.dispatch({ type: 'detach', actor: 'p1', payload: { cardId: d, from: 'p1.battlefield' } }).ok).toBe(true);
    expect(h.state.zones['p1.battlefield']).toEqual([a, b, d, c]);
    expect(h.dispatch({ type: 'detach', actor: 'p1', payload: { cardId: d, from: 'p1.battlefield' } })).toMatchObject({ ok: false });
  });

  it('detach all frees every attached card in one step, nearest first to the right of the host', () => {
    const { h, a, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    att(h, a, 'p1.battlefield', b, 'p1.battlefield');
    expect(h.state.zones['p1.battlefield']).toEqual([a, d, b, c]);
    const before = h.state;
    expect(h.dispatch({ type: 'detachAll', actor: 'p1', payload: { cardId: b, from: 'p1.battlefield' } }).ok).toBe(true);
    expect(h.state.zones['p1.battlefield']).toEqual([b, d, a, c]);
    expect([a, d].map((id) => h.state.cards[id].attachedTo)).toEqual([undefined, undefined]);
    expect(checkInvariants(h.state)).toBeNull();
    // the same as detaching each in turn, nearest the host last
    let s = before;
    for (const id of [a, d]) s = (apply(s, { type: 'detach', actor: 'p1', payload: { cardId: id, from: 'p1.battlefield' } }) as { state: GameState }).state;
    expect(s.zones['p1.battlefield']).toEqual(h.state.zones['p1.battlefield']);
    expect(h.dispatch({ type: 'detachAll', actor: 'p1', payload: { cardId: b, from: 'p1.battlefield' } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(h.dispatch({ type: 'detachAll', actor: 'p1', payload: { cardId: b, from: 'p1.hand' } })).toMatchObject({ ok: false, error: 'stale' });
  });

  it('a card dropped into the middle of a group lands before the group', () => {
    const { h, a, b, c, d } = setup();
    att(h, d, 'p1.hand', b, 'p1.battlefield');
    mv(h, c, 'p1.battlefield', 'p1.battlefield', 2); // [a, d, | c, b] -> c before d
    expect(h.state.zones['p1.battlefield']).toEqual([a, c, d, b]);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('cannot attach to a card outside the battlefield', () => {
    const h = started();
    const [x, y] = h.state.zones['p1.hand'];
    expect(att(h, x, 'p1.hand', y, 'p1.hand')).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('combat marks', () => {
  const send = (h: Table, type: string, payload: object, actor: Actor = 'p1') => h.dispatch({ type, actor, payload });
  function setup() {
    const h = started();
    const [a1, a2] = h.state.zones['p1.hand'];
    const [b1, b2] = h.state.zones['p2.hand'];
    for (const id of [a1, a2]) send(h, 'move', { cardId: id, from: 'p1.hand', to: 'p1.battlefield' });
    for (const id of [b1, b2]) send(h, 'move', { cardId: id, from: 'p2.hand', to: 'p2.battlefield' }, 'p2');
    return { h, a1, a2, b1, b2 };
  }

  it('numbers attackers in order and keeps numbers when one stops', () => {
    const { h, a1, a2 } = setup();
    send(h, 'attack', { cardId: a1, from: 'p1.battlefield' });
    send(h, 'attack', { cardId: a2, from: 'p1.battlefield' });
    expect([h.state.cards[a1].attacking, h.state.cards[a2].attacking]).toEqual([1, 2]);
    send(h, 'attack', { cardId: a1, from: 'p1.battlefield' }); // toggles off
    expect(h.state.cards[a1].attacking).toBeUndefined();
    expect(h.state.cards[a2].attacking).toBe(2);
  });

  it('blocks need an attacker; several blockers on one, one blocker on several, toggling', () => {
    const { h, a1, a2, b1, b2 } = setup();
    expect(send(h, 'block', { cardId: b1, from: 'p2.battlefield', attackerId: a1, attackerZone: 'p1.battlefield' }, 'p2')).toMatchObject({ ok: false, error: 'invalid' });
    send(h, 'attack', { cardId: a1, from: 'p1.battlefield' });
    send(h, 'attack', { cardId: a2, from: 'p1.battlefield' });
    send(h, 'block', { cardId: b1, from: 'p2.battlefield', attackerId: a1, attackerZone: 'p1.battlefield' }, 'p2');
    send(h, 'block', { cardId: b2, from: 'p2.battlefield', attackerId: a1, attackerZone: 'p1.battlefield' }, 'p2');
    send(h, 'block', { cardId: b2, from: 'p2.battlefield', attackerId: a2, attackerZone: 'p1.battlefield' }, 'p2');
    expect(h.state.cards[b1].blocking).toEqual([a1]);
    expect(h.state.cards[b2].blocking).toEqual([a1, a2]);
    send(h, 'block', { cardId: b2, from: 'p2.battlefield', attackerId: a1, attackerZone: 'p1.battlefield' }, 'p2');
    expect(h.state.cards[b2].blocking).toEqual([a2]);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('an attacker that stops attacking or leaves play frees its blockers', () => {
    const { h, a1, a2, b1 } = setup();
    send(h, 'attack', { cardId: a1, from: 'p1.battlefield' });
    send(h, 'attack', { cardId: a2, from: 'p1.battlefield' });
    send(h, 'block', { cardId: b1, from: 'p2.battlefield', attackerId: a1, attackerZone: 'p1.battlefield' }, 'p2');
    send(h, 'block', { cardId: b1, from: 'p2.battlefield', attackerId: a2, attackerZone: 'p1.battlefield' }, 'p2');
    send(h, 'move', { cardId: a1, from: 'p1.battlefield', to: 'p1.graveyard' });
    expect(h.state.cards[a1].attacking).toBeUndefined();
    expect(h.state.cards[b1].blocking).toEqual([a2]);
    send(h, 'attack', { cardId: a2, from: 'p1.battlefield', value: false });
    expect(h.state.cards[b1].blocking).toBeUndefined();
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('end combat and pass turn clear every mark; moving within play keeps them', () => {
    const { h, a1, b1 } = setup();
    send(h, 'attack', { cardId: a1, from: 'p1.battlefield' });
    send(h, 'block', { cardId: b1, from: 'p2.battlefield', attackerId: a1, attackerZone: 'p1.battlefield' }, 'p2');
    send(h, 'move', { cardId: b1, from: 'p2.battlefield', to: 'p2.battlefield', toIndex: 0 });
    expect(h.state.cards[b1].blocking).toEqual([a1]);
    send(h, 'endCombat', {});
    expect(h.state.cards[a1].attacking).toBeUndefined();
    expect(h.state.cards[b1].blocking).toBeUndefined();
    send(h, 'attack', { cardId: a1, from: 'p1.battlefield' });
    expect(h.state.cards[a1].attacking).toBe(1); // numbering restarts after combat
    send(h, 'passTurn', {});
    expect(h.state.cards[a1].attacking).toBeUndefined();
  });

  it('only the active player attacks and only the other player blocks', () => {
    const { h, a1, a2, b1 } = setup(); // p1 is active
    expect(send(h, 'attack', { cardId: b1, from: 'p2.battlefield' }, 'p2')).toMatchObject({ ok: false, error: 'invalid' });
    send(h, 'attack', { cardId: a1, from: 'p1.battlefield' });
    expect(send(h, 'block', { cardId: a2, from: 'p1.battlefield', attackerId: a1, attackerZone: 'p1.battlefield' })).toMatchObject({ ok: false, error: 'invalid' });
    // a creature that changes sides (control) is removed from combat, freeing its blockers
    send(h, 'attack', { cardId: a2, from: 'p1.battlefield' });
    send(h, 'block', { cardId: b1, from: 'p2.battlefield', attackerId: a1, attackerZone: 'p1.battlefield' }, 'p2');
    send(h, 'move', { cardId: a1, from: 'p1.battlefield', to: 'p2.battlefield' });
    expect(h.state.cards[a1].attacking).toBeUndefined();
    expect(h.state.cards[b1].blocking).toBeUndefined();
    expect(h.state.cards[a2].attacking).toBe(2);
    send(h, 'block', { cardId: b1, from: 'p2.battlefield', attackerId: a2, attackerZone: 'p1.battlefield' }, 'p2');
    send(h, 'move', { cardId: b1, from: 'p2.battlefield', to: 'p1.battlefield' });
    expect(h.state.cards[b1].blocking).toBeUndefined();
    // moving within the same side keeps the mark
    send(h, 'move', { cardId: a2, from: 'p1.battlefield', to: 'p1.lands' });
    expect(h.state.cards[a2].attacking).toBe(2);
    expect(checkInvariants(h.state)).toBeNull();
  });

  it('only cards in play can attack', () => {
    const h = started();
    const id = h.state.zones['p1.hand'][0];
    expect(send(h, 'attack', { cardId: id, from: 'p1.hand' })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

// ---------- Changed marks ----------

describe('changed marks', () => {
  const send = (h: Table, type: string, payload: Record<string, unknown>, actor = 'p1') => h.dispatch({ type, actor, payload } as never);
  function setup() {
    const h = started(); // p1 active, turn 1
    const [a1, a2, a3] = h.state.zones['p1.hand'];
    const [b1, b2] = h.state.zones['p2.hand'];
    for (const id of [a1, a2]) send(h, 'move', { cardId: id, from: 'p1.hand', to: 'p1.battlefield' });
    for (const id of [b1, b2]) send(h, 'move', { cardId: id, from: 'p2.hand', to: 'p2.battlefield' }, 'p2');
    return { h, a1, a2, a3, b1, b2 };
  }
  const by = (h: Table, id: string) => h.state.cards[id].changed;

  it('marks cards put into play or changed in play, for whoever sent the command', () => {
    const { h, a1, b1, a3 } = setup();
    expect(by(h, a1)).toEqual({ by: 'p1', turn: 1 });
    expect(by(h, b1)).toEqual({ by: 'p2', turn: 1 });
    expect(by(h, a3)).toBeUndefined(); // still in hand
    send(h, 'tap', { cardId: b1, from: 'p2.battlefield' }); // p1 taps p2's card
    expect(by(h, b1)).toEqual({ by: 'p1', turn: 1 });
    // a blinded table acts for the active player
    send(h, 'addCounter', { cardId: a1, from: 'p1.battlefield', kind: 'plus' }, 'table');
    expect(by(h, a1)).toEqual({ by: 'p1', turn: 1 });
  });

  it('routine changes mark nothing: untap all, the untap at a turn pass, ending combat, reordering', () => {
    const { h, a2, b1 } = setup();
    send(h, 'tap', { cardId: b1, from: 'p2.battlefield' }, 'p2');
    send(h, 'passTurn', { to: 'p2' }); // turn 2: p2's cards untap, which marks nothing
    expect(h.state.cards[b1].tapped).toBe(false);
    expect(by(h, b1)).toEqual({ by: 'p2', turn: 1 });
    send(h, 'tap', { cardId: a2, from: 'p1.battlefield' }); // the defender's tap: marked
    send(h, 'untapAll', { player: 'p1' });
    expect(by(h, a2)).toEqual({ by: 'p1', turn: 2 });
    send(h, 'attack', { cardId: b1, from: 'p2.battlefield' }, 'p2'); // the active player's first marking move
    send(h, 'endCombat', {}, 'p2');
    send(h, 'move', { cardId: a2, from: 'p1.battlefield', to: 'p1.battlefield', toIndex: 0 }, 'p2');
    expect(by(h, a2)).toEqual({ by: 'p1', turn: 2 });
    expect(by(h, b1)).toEqual({ by: 'p2', turn: 2 });
  });

  it("the active player's first marking move clears earlier turns' marks; a pass drops marks two turns old", () => {
    const { h, a1, a2, b1, b2 } = setup();
    send(h, 'passTurn', { to: 'p2' }); // turn 2, p2 active
    // the defender acts first in the new turn: its mark belongs to this turn and stays
    send(h, 'tap', { cardId: a2, from: 'p1.battlefield' });
    expect(by(h, a2)).toEqual({ by: 'p1', turn: 2 });
    expect(by(h, a1)).toEqual({ by: 'p1', turn: 1 }); // turn 1 marks still shown
    // drawing marks nothing, so it clears nothing
    send(h, 'draw', { player: 'p2', n: 1 }, 'p2');
    expect(by(h, a1)).toBeDefined();
    // the active player's first marking move clears turn 1's marks only
    send(h, 'tap', { cardId: b1, from: 'p2.battlefield' }, 'p2');
    expect([by(h, a1), by(h, b2)]).toEqual([undefined, undefined]);
    expect(by(h, a2)).toEqual({ by: 'p1', turn: 2 });
    expect(by(h, b1)).toEqual({ by: 'p2', turn: 2 });
    // p1 passes on turn 3 without a marking move: at the next pass, turn-2 marks are two turns old
    send(h, 'passTurn', { to: 'p1' }, 'p2'); // turn 3
    expect(by(h, b1)).toEqual({ by: 'p2', turn: 2 });
    send(h, 'passTurn', { to: 'p2' }); // turn 4
    expect([by(h, a2), by(h, b1)]).toEqual([undefined, undefined]);
  });

  it('a card leaving play loses its mark, and undo brings marks back', () => {
    const { h, a1, b1 } = setup();
    send(h, 'move', { cardId: a1, from: 'p1.battlefield', to: 'p1.graveyard' });
    expect(by(h, a1)).toBeUndefined();
    send(h, 'passTurn', { to: 'p2' });
    send(h, 'tap', { cardId: b1, from: 'p2.battlefield' }, 'p2'); // clears turn 1's marks
    expect(h.dispatch({ type: 'undo', actor: 'p2', payload: {} }).ok).toBe(true);
    expect(by(h, b1)).toEqual({ by: 'p2', turn: 1 });
    expect(checkInvariants(h.state)).toBeNull();
  });
});

// ---------- Property tests ----------

const ZONES = allZones();

describe('properties', () => {
  it('card conservation holds after any command sequence', () => {
    let attachedSeen = 0, blocksSeen = 0, leadsSeen = 0, abilitiesSeen = 0, abilitiesGone = 0;
    fc.assert(fc.property(fc.array(cmdArb, { maxLength: 60 }), fc.integer({ min: 1, max: 1e6 }), (steps, seed) => {
      const h = started(new Table(seeded(seed)));
      const cmdIds: string[] = [];
      for (const step of steps) {
        const cmd = concretize(h.state, step);
        cmdIds.push(String(cmd.payload?.cardId ?? ''));
        const r = h.dispatch(cmd);
        if (r.ok && step.type === 'attach') attachedSeen++;
        if (r.ok && step.type === 'block') blocksSeen++;
        if (r.ok && step.type === 'setLead') leadsSeen++;
        if (r.ok && step.type === 'putAbility') abilitiesSeen++;
        if (r.ok && step.type === 'resolve' && /^a/.test(cmdIds.at(-1) || '') && !h.state.cards[cmdIds.at(-1)!]) abilitiesGone++;
        const bad = checkInvariants(h.state);
        if (bad) throw new Error(bad);
      }
    }), { numRuns: 400 });
    // The generator really exercises attachments, blocks and lead changes. The bars sit well
    // below the usual counts (measured over 10 runs of 400: attaches 28–53, blocks 79–95,
    // lead changes 3–15; abilities put on the stack 109–133, deleted on leaving it 8–19), so a
    // random run doesn't flake.
    expect(attachedSeen).toBeGreaterThan(10);
    expect(blocksSeen).toBeGreaterThan(10);
    expect(leadsSeen).toBeGreaterThan(0);
    expect(abilitiesSeen).toBeGreaterThan(10);
    expect(abilitiesGone).toBeGreaterThan(0);
  });

  it('a non-owner never sees hand faces unless revealed', () => {
    fc.assert(fc.property(fc.array(cmdArb, { maxLength: 40 }), fc.integer({ min: 1, max: 1e6 }), (steps, seed) => {
      const h = started(new Table(seeded(seed)));
      for (const step of steps) h.dispatch(concretize(h.state, step));
      const s = h.state;
      for (const pl of ['p1', 'p2'] as const) {
        const opp = pl === 'p1' ? 'p2' : 'p1';
        for (const id of s.zones[`${pl}.hand`]) {
          const seen = canSeeFace(s, s.cards[id], `${pl}.hand`, opp);
          expect(seen).toBe(s.cards[id].revealed);
        }
        for (const id of s.zones[`${pl}.library`].slice(1)) {
          expect(visibleTo(s, s.cards[id], `${pl}.library`)).toEqual([]);
        }
      }
    }), { numRuns: 100 });
  });

});

it('apply does not mutate its input', () => {
  const s = emptyState('g');
  const copy = structuredClone(s);
  apply(s, { type: 'createToken', actor: 'p1', payload: { defId: 'x', to: 'p1.battlefield' } } as Command); // no name: defaults to Token
  expect(s).toEqual(copy);
});

// ---------- v2: a guest's payload is untrusted ----------

describe('untrusted payloads', () => {
  it('missing or wrong-typed fields return invalid or stale, never throw', () => {
    const h = started();
    for (const [type, payload] of [
      ['attach', { cardId: h.state.zones['p1.hand'][0], from: 'p1.hand' }],
      ['block', { cardId: 'c1', from: 'p1.hand' }],
      ['addCounter', { cardId: h.state.zones['p1.hand'][0], from: 'nowhere', kind: 'plus' }],
      ['move', { cardId: 5, from: 'p1.hand', to: 'p1.graveyard' }],
      ['shuffle', { zone: { evil: true } }],
    ] as const) {
      const r = h.dispatch({ type, actor: 'p2', payload });
      expect(r.ok, type).toBe(false);
    }
  });

  it('a shuffle without its random numbers is invalid', () => {
    const s = started().state;
    expect(apply(s, { type: 'shuffle', actor: 'p1', payload: { zone: 'p1.library' } })).toMatchObject({ error: 'invalid' });
  });

  it('any payload at all leaves a valid state or an error', () => {
    const anyPayload = fc.dictionary(fc.constantFrom('cardId', 'from', 'to', 'toZone', 'toCardId', 'attackerId', 'attackerZone', 'player', 'kind', 'label', 'n', 'value', 'zone', 'key', 'toIndex', 'defId', 'name', 'owner', 'winner'),
      fc.oneof(fc.constantFrom<unknown>(...ZONES, 'p1', 'p2', 'c1', 'c3', 'plus', 'label', null, undefined, true, -1, 2.5, 1e9), fc.anything()));
    fc.assert(fc.property(fc.constantFrom(...[...new Set(['move', 'tap', 'attach', 'detach', 'attack', 'block', 'addCounter', 'removeCounter', 'createToken', 'removeToken', 'draw', 'mill', 'setPlayerCounter', 'addPlayerCounter', 'removePlayerCounter', 'passTurn', 'concede', 'endGame', 'untapAll', 'flip', 'setFaceDown', 'reveal', 'setLibraryTopFaceUp', 'endCombat'])]), anyPayload, (type, payload) => {
      const h = started();
      h.dispatch({ type, actor: 'p2', payload });
      expect(checkInvariants(h.state)).toBeNull();
    }), { numRuns: 400 });
  });
});
