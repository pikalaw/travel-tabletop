// The game engine: a pure function apply(state, command) -> { state, moved } | { error }.
// No I/O, no clock, no randomness of its own: random numbers arrive in command.random,
// filled in by the host. This makes undo, replay and testing straightforward.

import { PLAYERS, ZONE_KINDS, isZone, isBattlefieldZone, zoneOwner, zoneKind, other } from './view.js';

/** @typedef {import('../types').GameState} GameState */
/** @typedef {import('../types').Command} Command */
/** @typedef {import('../types').CardInstance} CardInstance */
/** @typedef {import('../types').PlayerId} PlayerId */
/** @typedef {import('../types').ZoneId} ZoneId */
/** @typedef {{ id: string, from: ZoneId | null, to: ZoneId | null, toIndex?: number }} Movement */
/** @typedef {{ state: GameState, moved: Movement[] } | { error: string, detail?: string }} ApplyResult */

export const SCHEMA_VERSION = 1;

/** Commands that change state. Everything else is a notice handled by the host. */
export const STATE_COMMANDS = new Set([
  'startGame', 'move', 'tap', 'untapAll', 'flip', 'setFaceDown', 'reveal',
  'addCounter', 'removeCounter', 'createToken', 'removeToken', 'draw', 'mill',
  'shuffle', 'setLibraryTopFaceUp', 'setPlayerCounter', 'addPlayerCounter',
  'removePlayerCounter', 'passTurn', 'concede', 'endGame', 'attach', 'detach',
]);

/** An empty state with no cards, used before startGame. @returns {GameState} */
export function emptyState(gameId = '', mode = /** @type {'same-device'} */ ('same-device')) {
  /** @type {any} */
  const zones = {};
  for (const p of PLAYERS) for (const k of ZONE_KINDS) zones[`${p}.${k}`] = [];
  zones.stack = [];
  return {
    schemaVersion: SCHEMA_VERSION,
    gameId,
    mode,
    seq: 0,
    turn: 0,
    activePlayer: 'p1',
    nextId: 1,
    players: {
      p1: { name: 'Player 1', counters: [{ key: 'life', value: 20 }], libraryTopFaceUp: false },
      p2: { name: 'Player 2', counters: [{ key: 'life', value: 20 }], libraryTopFaceUp: false },
    },
    cards: {},
    zones,
    result: null,
  };
}

/** How many random numbers the host must supply for a command. @param {GameState} state @param {Command} cmd */
export function randomNeeded(state, cmd) {
  const p = cmd.payload || {};
  if (cmd.type === 'startGame') {
    return (p.players?.p1?.cards?.length || 0) + (p.players?.p2?.cards?.length || 0);
  }
  if (cmd.type === 'shuffle') return state.zones[p.zone]?.length || 0;
  return 0;
}

/** Fisher-Yates using supplied randoms in [0, 1). Mutates arr. */
function shuffleInPlace(arr, take) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(take() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function randomSource(random) {
  let i = 0;
  return () => {
    if (!random || i >= random.length) throw new Error('not enough randomness supplied');
    const r = random[i++];
    return Math.min(Math.max(r, 0), 0.9999999999);
  };
}

/** @returns {CardInstance} */
function newCard(id, defId, name, deckId, owner, isToken) {
  return {
    id, defId, name, deckId, owner, isToken,
    tapped: false, face: 'front', faceDown: false, revealed: false,
    counters: { plus: 0, minus: 0, labeled: {} },
  };
}

const fail = (error, detail) => ({ error, detail });

/** Reset what a card loses when it changes zone (the same rules for every kind of move). */
function changeZone(c, from, to) {
  if (from === to) return;
  const leavingField = isBattlefieldZone(from) && !isBattlefieldZone(to);
  const enteringField = !isBattlefieldZone(from) && isBattlefieldZone(to);
  if (leavingField || enteringField || !isBattlefieldZone(to)) c.tapped = false;
  if (leavingField) { c.counters = { plus: 0, minus: 0, labeled: {} }; c.face = 'front'; }
  c.faceDown = false;
  c.revealed = false;
}

/** Cards in `zone` attached to `hostId`, in zone order. */
function attachmentsOf(state, zone, hostId) {
  return state.zones[zone].filter((id) => state.cards[id]?.attachedTo === hostId);
}

/**
 * Keep attachments consistent after any command: an attachment must sit on the battlefield in
 * the same zone as its host, hosts are never attached themselves (one level), and each host's
 * attachments come immediately before it in the zone (they are drawn tucked to its left).
 * @param {GameState} state
 */
export function fixAttachments(state) {
  const zoneOf = new Map();
  for (const [z, ids] of Object.entries(state.zones)) for (const id of ids) zoneOf.set(id, z);
  const cards = Object.values(state.cards);
  for (const c of cards) {
    if (!c.attachedTo) continue;
    const z = zoneOf.get(c.id);
    let host = state.cards[c.attachedTo];
    for (let guard = 0; host?.attachedTo && guard < 10; guard++) host = state.cards[host.attachedTo];
    if (!host || host.id === c.id || host.attachedTo || zoneOf.get(host.id) !== z || !isBattlefieldZone(z)) delete c.attachedTo;
    else c.attachedTo = host.id;
  }
  // A card that is a host cannot itself stay attached (breaks any A<->B loop left above).
  for (const c of cards) if (c.attachedTo && cards.some((d) => d.attachedTo === c.id)) delete c.attachedTo;
  for (const [z, ids] of Object.entries(state.zones)) {
    if (!isBattlefieldZone(z) || !ids.some((id) => state.cards[id].attachedTo)) continue;
    const groups = new Map();
    for (const id of ids) {
      const a = state.cards[id].attachedTo;
      if (a) { if (!groups.has(a)) groups.set(a, []); groups.get(a).push(id); }
    }
    const out = [];
    for (const id of ids) if (!state.cards[id].attachedTo) out.push(...(groups.get(id) || []), id);
    state.zones[z] = out;
  }
}

/**
 * Apply one command. Never mutates the input state.
 * @param {GameState} input @param {Command} cmd @returns {ApplyResult}
 */
export function apply(input, cmd) {
  if (!STATE_COMMANDS.has(cmd.type)) return fail('invalid', `unknown command ${cmd.type}`);
  if (input.result && cmd.type !== 'startGame') return fail('invalid', 'game is over');
  const state = structuredClone(input);
  const p = cmd.payload || {};
  /** @type {Movement[]} */
  const moved = [];

  // Shared precondition: the card is where the sender saw it.
  const need = () => {
    if (!isZone(p.from)) return fail('invalid', `bad zone ${p.from}`);
    if (!state.zones[p.from].includes(p.cardId)) return fail('stale', `${p.cardId} not in ${p.from}`);
    return null;
  };
  const card = () => state.cards[p.cardId];
  const playerOk = (pl) => pl === 'p1' || pl === 'p2';

  switch (cmd.type) {
    case 'startGame': {
      const fresh = emptyState(p.gameId || state.gameId, p.mode || state.mode);
      const take = randomSource(cmd.random);
      const life = Number.isFinite(p.startingLife) ? p.startingLife : 20;
      for (const pl of PLAYERS) {
        const spec = p.players?.[pl];
        if (!spec) return fail('invalid', `missing ${pl}`);
        fresh.players[pl] = { name: spec.name || pl, counters: [{ key: 'life', value: life }], libraryTopFaceUp: false };
        const ids = [];
        for (const c of spec.cards || []) {
          const id = `c${fresh.nextId++}`;
          fresh.cards[id] = newCard(id, c.defId, c.name || '', c.deckId || null, pl, false);
          ids.push(id);
        }
        shuffleInPlace(ids, take);
        const deal = Math.min(Number.isFinite(p.deal) ? p.deal : 7, ids.length);
        fresh.zones[`${pl}.hand`] = ids.slice(0, deal);
        fresh.zones[`${pl}.library`] = ids.slice(deal);
        if (spec.commanders) {
          for (const c of spec.commanders) {
            const id = `c${fresh.nextId++}`;
            fresh.cards[id] = newCard(id, c.defId, c.name || '', c.deckId || null, pl, false);
            fresh.zones[`${pl}.command`].push(id);
          }
        }
      }
      fresh.turn = 1;
      fresh.activePlayer = p.first === 'p2' ? 'p2' : 'p1';
      fresh.seq = state.seq + 1;
      return { state: fresh, moved };
    }

    case 'move': {
      const bad = need(); if (bad) return bad;
      if (!isZone(p.to)) return fail('invalid', `bad zone ${p.to}`);
      const c = card();
      const src = state.zones[p.from];
      // A host moving to a battlefield zone takes its attachments along; moving an attached card detaches it.
      const carry = c.attachedTo || !isBattlefieldZone(p.to) ? [] : attachmentsOf(state, p.from, c.id);
      delete c.attachedTo;
      for (const id of [...carry, c.id]) src.splice(src.indexOf(id), 1);
      if (c.isToken && !isBattlefieldZone(p.to) && p.to !== 'stack') {
        delete state.cards[c.id];
        moved.push({ id: c.id, from: p.from, to: null });
        break;
      }
      for (const id of [...carry, c.id]) changeZone(state.cards[id], p.from, p.to);
      const dst = state.zones[p.to];
      const idx = Number.isInteger(p.toIndex) ? Math.max(0, Math.min(p.toIndex, dst.length)) : dst.length;
      dst.splice(idx, 0, ...carry, c.id);
      moved.push({ id: c.id, from: p.from, to: p.to, toIndex: idx + carry.length });
      for (const [i, id] of carry.entries()) moved.push({ id, from: p.from, to: p.to, toIndex: idx + i });
      break;
    }

    case 'attach': {
      const bad = need(); if (bad) return bad;
      if (!isBattlefieldZone(p.toZone)) return fail('invalid', 'cards can only be attached to a card on the battlefield');
      if (!state.zones[p.toZone].includes(p.toCardId)) return fail('stale', `${p.toCardId} not in ${p.toZone}`);
      let host = state.cards[p.toCardId];
      if (host.attachedTo) host = state.cards[host.attachedTo]; // one level: attach to the card at the bottom
      const c = card();
      if (host.id === c.id) return fail('invalid', 'a card cannot be attached to itself');
      // A card that carries attachments brings them onto the new host too.
      const own = c.attachedTo ? [] : attachmentsOf(state, p.from, c.id);
      const group = [...own, c.id];
      const src = state.zones[p.from];
      for (const id of group) src.splice(src.indexOf(id), 1);
      for (const id of group) { changeZone(state.cards[id], p.from, p.toZone); state.cards[id].attachedTo = host.id; }
      const dst = state.zones[p.toZone];
      const idx = dst.indexOf(host.id); // just before the host: closest to it
      dst.splice(idx, 0, ...group);
      moved.push({ id: c.id, from: p.from, to: p.toZone, toIndex: idx + group.length - 1 });
      for (const [i, id] of own.entries()) moved.push({ id, from: p.from, to: p.toZone, toIndex: idx + i });
      break;
    }

    case 'detach': {
      const bad = need(); if (bad) return bad;
      const c = card();
      if (!c.attachedTo) return fail('invalid', 'card is not attached');
      const hostId = c.attachedTo;
      delete c.attachedTo;
      const z = state.zones[p.from];
      z.splice(z.indexOf(c.id), 1);
      z.splice(z.indexOf(hostId) + 1, 0, c.id); // just right of its former host
      break;
    }

    case 'tap': {
      const bad = need(); if (bad) return bad;
      card().tapped = typeof p.value === 'boolean' ? p.value : !card().tapped;
      break;
    }

    case 'untapAll': {
      if (!playerOk(p.player)) return fail('invalid', 'bad player');
      for (const z of [`${p.player}.battlefield`, `${p.player}.lands`]) {
        for (const id of state.zones[z]) state.cards[id].tapped = false;
      }
      break;
    }

    case 'flip': {
      const bad = need(); if (bad) return bad;
      card().face = card().face === 'front' ? 'back' : 'front';
      break;
    }

    case 'setFaceDown': {
      const bad = need(); if (bad) return bad;
      card().faceDown = typeof p.value === 'boolean' ? p.value : !card().faceDown;
      break;
    }

    case 'reveal': {
      const bad = need(); if (bad) return bad;
      card().revealed = typeof p.value === 'boolean' ? p.value : !card().revealed;
      break;
    }

    case 'addCounter':
    case 'removeCounter': {
      if (!state.cards[p.cardId]) return fail('stale', 'no such card');
      if (p.from && !state.zones[p.from]?.includes(p.cardId)) return fail('stale', 'card moved');
      const c = card();
      const n = Number.isInteger(p.n) && p.n > 0 ? p.n : 1;
      const sign = cmd.type === 'addCounter' ? 1 : -1;
      if (p.kind === 'plus' || p.kind === 'minus') {
        const next = c.counters[p.kind] + sign * n;
        if (next < 0) return fail('invalid', 'no counter to remove');
        c.counters[p.kind] = next;
      } else {
        const label = String(p.label || '').trim();
        if (!label) return fail('invalid', 'counter needs a label');
        const next = (c.counters.labeled[label] || 0) + sign * n;
        if (next < 0) return fail('invalid', 'no counter to remove');
        if (next === 0) delete c.counters.labeled[label];
        else c.counters.labeled[label] = next;
      }
      break;
    }

    case 'createToken': {
      if (!isZone(p.to)) return fail('invalid', 'bad zone');
      const owner = playerOk(p.owner) ? p.owner : (zoneOwner(p.to) || 'p1');
      const id = `t${state.nextId++}`;
      state.cards[id] = newCard(id, p.defId, p.name || 'Token', null, owner, true);
      const dst = state.zones[p.to];
      const idx = Number.isInteger(p.toIndex) ? Math.max(0, Math.min(p.toIndex, dst.length)) : dst.length;
      dst.splice(idx, 0, id);
      moved.push({ id, from: null, to: p.to, toIndex: idx });
      break;
    }

    case 'removeToken': {
      const bad = need(); if (bad) return bad;
      if (!card().isToken) return fail('invalid', 'not a token');
      state.zones[p.from].splice(state.zones[p.from].indexOf(p.cardId), 1);
      delete state.cards[p.cardId];
      moved.push({ id: p.cardId, from: p.from, to: null });
      break;
    }

    case 'draw':
    case 'mill': {
      if (!playerOk(p.player)) return fail('invalid', 'bad player');
      const lib = state.zones[`${p.player}.library`];
      const n = Math.min(Number.isInteger(p.n) && p.n > 0 ? p.n : 1, lib.length);
      const to = /** @type {ZoneId} */ (cmd.type === 'draw' ? `${p.player}.hand` : `${p.player}.graveyard`);
      const libZone = /** @type {ZoneId} */ (`${p.player}.library`);
      for (let i = 0; i < n; i++) {
        const id = lib.shift();
        const c = state.cards[id];
        c.faceDown = false; c.revealed = false; c.tapped = false;
        if (cmd.type === 'draw') { state.zones[to].push(id); moved.push({ id, from: libZone, to, toIndex: state.zones[to].length - 1 }); }
        else { state.zones[to].unshift(id); moved.push({ id, from: libZone, to, toIndex: 0 }); }
      }
      break;
    }

    case 'shuffle': {
      if (!isZone(p.zone)) return fail('invalid', 'bad zone');
      const take = randomSource(cmd.random);
      shuffleInPlace(state.zones[p.zone], take);
      break;
    }

    case 'setLibraryTopFaceUp': {
      if (!playerOk(p.player)) return fail('invalid', 'bad player');
      state.players[p.player].libraryTopFaceUp = !!p.value;
      break;
    }

    case 'setPlayerCounter': {
      if (!playerOk(p.player)) return fail('invalid', 'bad player');
      const ctr = state.players[p.player].counters.find((x) => x.key === p.key);
      if (!ctr) return fail('invalid', 'no such counter');
      const v = Number(p.value);
      if (!Number.isFinite(v)) return fail('invalid', 'bad value');
      ctr.value = Math.round(v);
      break;
    }

    case 'addPlayerCounter': {
      if (!playerOk(p.player)) return fail('invalid', 'bad player');
      const key = String(p.key || '').trim();
      if (!key) return fail('invalid', 'counter needs a name');
      const list = state.players[p.player].counters;
      if (list.some((x) => x.key.toLowerCase() === key.toLowerCase())) return fail('invalid', 'counter exists');
      list.push({ key, value: Number.isFinite(p.value) ? p.value : 0 });
      break;
    }

    case 'removePlayerCounter': {
      if (!playerOk(p.player)) return fail('invalid', 'bad player');
      if (p.key === 'life') return fail('invalid', 'life cannot be removed');
      const list = state.players[p.player].counters;
      const i = list.findIndex((x) => x.key === p.key);
      if (i < 0) return fail('invalid', 'no such counter');
      list.splice(i, 1);
      break;
    }

    case 'passTurn': {
      const to = playerOk(p.to) ? p.to : other(state.activePlayer);
      state.activePlayer = to;
      state.turn += 1;
      for (const z of [`${to}.battlefield`, `${to}.lands`]) {
        for (const id of state.zones[z]) state.cards[id].tapped = false;
      }
      break;
    }

    case 'concede': {
      if (!playerOk(p.player)) return fail('invalid', 'bad player');
      state.result = { winner: other(p.player), reason: 'concede' };
      break;
    }

    case 'endGame': {
      state.result = { winner: playerOk(p.winner) ? p.winner : null, reason: 'ended' };
      break;
    }

    default:
      return fail('invalid', `unhandled ${cmd.type}`);
  }

  fixAttachments(state);
  state.seq = input.seq + 1;
  return { state, moved };
}

/**
 * Invariant check used by tests: every card in exactly one zone, every zone entry exists.
 * @param {GameState} state @returns {string | null} a description of the first violation
 */
export function checkInvariants(state) {
  const seen = new Map();
  for (const [z, ids] of Object.entries(state.zones)) {
    for (const id of ids) {
      if (!state.cards[id]) return `zone ${z} holds missing card ${id}`;
      if (seen.has(id)) return `card ${id} in both ${seen.get(id)} and ${z}`;
      seen.set(id, z);
    }
  }
  for (const id of Object.keys(state.cards)) {
    if (!seen.has(id)) return `card ${id} is in no zone`;
  }
  for (const c of Object.values(state.cards)) {
    if (!c.attachedTo) continue;
    const z = seen.get(c.id), host = state.cards[c.attachedTo];
    if (!host) return `card ${c.id} attached to missing ${c.attachedTo}`;
    if (seen.get(host.id) !== z) return `card ${c.id} attached across zones`;
    if (!isBattlefieldZone(z)) return `card ${c.id} attached outside the battlefield`;
    if (host.attachedTo) return `card ${c.id} attached to an attached card`;
    const ids = state.zones[z], hi = ids.indexOf(host.id), ci = ids.indexOf(c.id);
    if (ci > hi || ids.slice(ci, hi).some((id) => state.cards[id].attachedTo !== host.id)) return `attachments of ${host.id} not just before it`;
  }
  return null;
}

export { zoneKind };
