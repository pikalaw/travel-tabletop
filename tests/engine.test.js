import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { apply, emptyState, checkInvariants } from '../src/engine/engine.js';
import { canSeeFace, visibleTo, allZones } from '../src/engine/view.js';
import { Host, SNAPSHOT_CAP } from '../src/host/host.js';
import { replay } from '../src/host/replay.js';

// Deterministic randomness for tests.
function seeded(seed = 1) {
  let s = seed >>> 0;
  return (n) => Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  });
}

function deck(prefix, n) {
  return Array.from({ length: n }, (_, i) => ({ defId: `${prefix}${i % 5}`, name: `${prefix} card ${i}`, deckId: prefix }));
}

function started(host = new Host({ random: seeded(7) })) {
  const r = host.dispatch({
    type: 'startGame', actor: 'host',
    payload: { gameId: 'g1', mode: 'same-device', startingLife: 20, players: { p1: { name: 'Ann', cards: deck('a', 40) }, p2: { name: 'Bo', cards: deck('b', 40) } } },
  });
  expect(r.ok).toBe(true);
  return host;
}

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

  it('search close shuffles the library', () => {
    const h = started();
    const order = [...h.state.zones['p1.library']];
    h.dispatch({ type: 'searchOpen', actor: 'p1', payload: { zone: 'p1.library' } });
    h.dispatch({ type: 'searchClose', actor: 'p1', payload: { zone: 'p1.library' } });
    expect(h.state.zones['p1.library']).not.toEqual(order);
    expect([...h.state.zones['p1.library']].sort()).toEqual([...order].sort());
  });

  it('randomness notices carry host results', () => {
    const h = started();
    const r = h.dispatch({ type: 'rollDie', actor: 'p1', payload: { sides: 20 } });
    expect(r.notice.payload.result).toBeGreaterThanOrEqual(1);
    expect(r.notice.payload.result).toBeLessThanOrEqual(20);
    const pick = h.dispatch({ type: 'randomPick', actor: 'p1', payload: { zone: 'p1.hand' } });
    expect(h.state.zones['p1.hand']).toContain(pick.notice.payload.cardId);
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
  const mv = (h, id, from, to, toIndex) => h.dispatch({ type: 'move', actor: 'p1', payload: { cardId: id, from, to, toIndex } });
  const att = (h, id, from, toCardId, toZone) => h.dispatch({ type: 'attach', actor: 'p1', payload: { cardId: id, from, toCardId, toZone } });
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
    const t = h.state.zones['p1.battlefield'].at(-1);
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
  const send = (h, type, payload, actor = 'p1') => h.dispatch({ type, actor, payload });
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

  it('only cards in play can attack', () => {
    const h = started();
    const id = h.state.zones['p1.hand'][0];
    expect(send(h, 'attack', { cardId: id, from: 'p1.hand' })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

// ---------- Property tests ----------

const ZONES = allZones();
const cmdArb = fc.oneof(
  fc.record({ type: fc.constant('move'), pick: fc.nat(), to: fc.constantFrom(...ZONES), toIndex: fc.option(fc.nat(10), { nil: undefined }) }),
  fc.record({ type: fc.constant('tap'), pick: fc.nat() }),
  fc.record({ type: fc.constant('flip'), pick: fc.nat() }),
  fc.record({ type: fc.constant('setFaceDown'), pick: fc.nat() }),
  fc.record({ type: fc.constant('reveal'), pick: fc.nat() }),
  fc.record({ type: fc.constant('addCounter'), pick: fc.nat(), kind: fc.constantFrom('plus', 'minus') }),
  fc.record({ type: fc.constant('createToken'), to: fc.constantFrom('p1.battlefield', 'p2.battlefield', 'p1.lands') }),
  fc.record({ type: fc.constant('draw'), player: fc.constantFrom('p1', 'p2'), n: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ type: fc.constant('mill'), player: fc.constantFrom('p1', 'p2'), n: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ type: fc.constant('shuffle'), zone: fc.constantFrom('p1.library', 'p2.library', 'p1.hand') }),
  fc.record({ type: fc.constant('untapAll'), player: fc.constantFrom('p1', 'p2') }),
  fc.record({ type: fc.constant('passTurn') }),
  fc.record({ type: fc.constant('undo') }),
  fc.record({ type: fc.constant('play'), pick: fc.nat(), to: fc.constantFrom('p1.battlefield', 'p2.battlefield', 'p1.lands'), toIndex: fc.option(fc.nat(6), { nil: undefined }) }),
  fc.record({ type: fc.constant('play'), pick: fc.nat(), to: fc.constantFrom('p1.battlefield', 'p2.battlefield', 'p1.lands'), toIndex: fc.option(fc.nat(6), { nil: undefined }) }),
  fc.record({ type: fc.constant('play'), pick: fc.nat(), to: fc.constantFrom('p1.battlefield', 'p2.battlefield', 'p1.lands'), toIndex: fc.option(fc.nat(6), { nil: undefined }) }),
  fc.record({ type: fc.constant('attach'), pick: fc.nat(), target: fc.nat() }),
  fc.record({ type: fc.constant('attach'), pick: fc.nat(), target: fc.nat() }),
  fc.record({ type: fc.constant('detach'), pick: fc.nat() }),
  fc.record({ type: fc.constant('attack'), target: fc.nat() }),
  fc.record({ type: fc.constant('attack'), target: fc.nat() }),
  fc.record({ type: fc.constant('block'), target: fc.nat(), pick: fc.nat() }),
  fc.record({ type: fc.constant('block'), target: fc.nat(), pick: fc.nat() }),
  fc.record({ type: fc.constant('endCombat') }),
);

/** Turn an abstract step into a concrete command against the current state. */
function concretize(state, step) {
  const ids = Object.keys(state.cards).sort();
  const id = ids.length ? ids[step.pick % ids.length] : 'none';
  const from = ZONES.find((z) => state.zones[z].includes(id)) || 'p1.hand';
  switch (step.type) {
    case 'move': return { type: 'move', actor: 'p1', payload: { cardId: id, from, to: step.to, toIndex: step.toIndex } };
    case 'tap': case 'flip': case 'setFaceDown': case 'reveal':
      return { type: step.type, actor: 'p2', payload: { cardId: id, from } };
    case 'addCounter': return { type: 'addCounter', actor: 'p1', payload: { cardId: id, from, kind: step.kind } };
    case 'createToken': return { type: 'createToken', actor: 'p1', payload: { defId: 'tok', name: 'T', to: step.to } };
    case 'draw': case 'mill': return { type: step.type, actor: step.player, payload: { player: step.player, n: step.n } };
    case 'shuffle': return { type: 'shuffle', actor: 'p1', payload: { zone: step.zone } };
    case 'untapAll': return { type: 'untapAll', actor: step.player, payload: { player: step.player } };
    case 'passTurn': return { type: 'passTurn', actor: 'p1', payload: {} };
    case 'undo': return { type: 'undo', actor: 'table', payload: {} };
    case 'play': return { type: 'move', actor: 'p1', payload: { cardId: id, from, to: step.to, toIndex: step.toIndex } };
    case 'attach': {
      const field = ['p1.battlefield', 'p2.battlefield', 'p1.lands'].flatMap((z) => state.zones[z].map((c) => [c, z]));
      const [t, tz] = field.length ? field[step.target % field.length] : ['none', 'p1.battlefield'];
      return { type: 'attach', actor: 'p1', payload: { cardId: id, from, toCardId: t, toZone: tz } };
    }
    case 'attack': case 'block': {
      const field = ['p1.battlefield', 'p2.battlefield', 'p1.lands'].flatMap((z) => state.zones[z].map((c) => [c, z]));
      if (!field.length) return { type: 'endCombat', actor: 'p1', payload: {} };
      const [c, z] = field[step.target % field.length];
      if (step.type === 'attack') return { type: 'attack', actor: 'p1', payload: { cardId: c, from: z } };
      const atk = field.filter(([x]) => state.cards[x].attacking);
      const [a, az] = atk.length ? atk[step.pick % atk.length] : field[step.pick % field.length];
      return { type: 'block', actor: 'p2', payload: { cardId: c, from: z, attackerId: a, attackerZone: az } };
    }
    case 'endCombat': return { type: 'endCombat', actor: 'p1', payload: {} };
    case 'detach': {
      const att = Object.values(state.cards).filter((c) => c.attachedTo).map((c) => c.id).sort();
      const a = att.length ? att[step.pick % att.length] : id;
      return { type: 'detach', actor: 'p1', payload: { cardId: a, from: ZONES.find((z) => state.zones[z].includes(a)) || from } };
    }
  }
}

describe('properties', () => {
  it('card conservation holds after any command sequence', () => {
    let attachedSeen = 0, blocksSeen = 0;
    fc.assert(fc.property(fc.array(cmdArb, { maxLength: 60 }), fc.integer({ min: 1, max: 1e6 }), (steps, seed) => {
      const h = started(new Host({ random: seeded(seed) }));
      for (const step of steps) {
        const r = h.dispatch(concretize(h.state, step));
        if (r.ok && step.type === 'attach') attachedSeen++;
        if (r.ok && step.type === 'block') blocksSeen++;
        const bad = checkInvariants(h.state);
        if (bad) throw new Error(bad);
      }
    }), { numRuns: 150 });
    expect(attachedSeen).toBeGreaterThan(10); // the generator really exercises attachments
    expect(blocksSeen).toBeGreaterThan(10);   // …and blocks
  });

  it('undo restores the prior state exactly', () => {
    fc.assert(fc.property(fc.array(cmdArb, { maxLength: 40 }), fc.integer({ min: 1, max: 1e6 }), (steps, seed) => {
      const h = started(new Host({ random: seeded(seed) }));
      for (const step of steps) {
        if (step.type === 'undo') continue;
        const before = structuredClone(h.state);
        const r = h.dispatch(concretize(h.state, step));
        if (r.ok && r.version) {
          h.dispatch({ type: 'undo', actor: 'table', payload: {} });
          expect(h.state).toEqual(before);
          h.dispatch(concretize(h.state, step)); // re-apply to keep moving
        }
      }
    }), { numRuns: 100 });
  });

  it('replaying the log reproduces the final state', () => {
    fc.assert(fc.property(fc.array(cmdArb, { maxLength: 60 }), fc.integer({ min: 1, max: 1e6 }), (steps, seed) => {
      const log = [];
      const h = new Host({ random: seeded(seed), persist: { commit: async (c) => { log.push(...c.log); } } });
      // Capture entries synchronously instead of waiting for the async save chain.
      const orig = h.save.bind(h);
      h.save = (c) => { log.push(...(c.log || [])); };
      started(h);
      for (const step of steps) h.dispatch(concretize(h.state, step));
      expect(replay(log)).toEqual(h.state);
      void orig;
    }), { numRuns: 100 });
  });

  it('a non-owner never sees hand faces unless revealed', () => {
    fc.assert(fc.property(fc.array(cmdArb, { maxLength: 40 }), fc.integer({ min: 1, max: 1e6 }), (steps, seed) => {
      const h = started(new Host({ random: seeded(seed) }));
      for (const step of steps) h.dispatch(concretize(h.state, step));
      const s = h.state;
      for (const pl of ['p1', 'p2']) {
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

  it('snapshot stack is capped', () => {
    const h = started();
    for (let i = 0; i < SNAPSHOT_CAP + 30; i++) h.dispatch({ type: 'untapAll', actor: 'p1', payload: { player: 'p1' } });
    expect(h.snapshots.length).toBe(SNAPSHOT_CAP);
  });
});

it('apply does not mutate its input', () => {
  const s = emptyState('g');
  const copy = structuredClone(s);
  apply(s, { type: 'createToken', actor: 'p1', payload: { defId: 'x', to: 'p1.battlefield' } });
  expect(s).toEqual(copy);
});
