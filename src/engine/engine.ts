// The game engine: a pure function apply(state, command) -> { state, moved } | { error }.
// No I/O, no clock, no randomness of its own: random numbers arrive in command.random,
// filled in by the host. This makes undo, replay and testing straightforward.
//
// Payloads are typed, but a guest's commands arrive over the network, so every field is still
// checked at run time and bad input returns `invalid` rather than throwing.

import { PLAYERS, ZONE_KINDS, isZone, isBattlefieldZone, isPlayer, zoneOwner, other } from './view';
import { STATE_COMMAND_TYPES, assertNever, type ApplyResult, type Command, type Movement, type PlayerSetup } from '../types/commands';
import type { CardInstance, GameMode, GameState, PlayerId, ZoneId } from '../types/state';

export const SCHEMA_VERSION = 1;

/** Commands that change state. Everything else is a notice or undo, handled by the host. */
export const STATE_COMMANDS: ReadonlySet<string> = new Set(STATE_COMMAND_TYPES);

/** An empty state with no cards, used before startGame. */
export function emptyState(gameId = '', mode: GameMode = 'same-device'): GameState {
  const zones = {} as Record<ZoneId, string[]>;
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

/** How many random numbers the host must supply for a command. */
export function randomNeeded(state: GameState, cmd: Command): number {
  if (cmd.type === 'startGame') {
    // Read defensively: the payload is checked by apply, not before.
    const ps = (cmd.payload as { players?: Partial<Record<PlayerId, { cards?: unknown[] }>> } | undefined)?.players;
    return (ps?.p1?.cards?.length || 0) + (ps?.p2?.cards?.length || 0);
  }
  if (cmd.type === 'shuffle') {
    const z: unknown = (cmd.payload as { zone?: unknown } | undefined)?.zone;
    return isZone(z) ? state.zones[z].length : 0;
  }
  return 0;
}

/** Fisher–Yates using supplied randoms in [0, 1). Mutates arr. */
function shuffleInPlace(arr: string[], take: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(take() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

class NotEnoughRandomness extends Error {}

function randomSource(random: readonly number[] | undefined): () => number {
  let i = 0;
  return () => {
    if (!random || i >= random.length) throw new NotEnoughRandomness('not enough randomness supplied');
    const r = random[i++]!;
    return Math.min(Math.max(r, 0), 0.9999999999);
  };
}

function newCard(id: string, defId: string, name: string, deckId: string | null, owner: PlayerId, isToken: boolean): CardInstance {
  return {
    id, defId, name, deckId, owner, isToken,
    tapped: false, face: 'front', faceDown: false, revealed: false,
    counters: { plus: 0, minus: 0, labeled: {} },
  };
}

const fail = (error: 'stale' | 'invalid', detail?: string): ApplyResult => (detail === undefined ? { error } : { error, detail });

const isInt = (x: unknown): x is number => Number.isInteger(x);
const isFiniteNum = (x: unknown): x is number => Number.isFinite(x);

/** Reset what a card loses when it changes zone (the same rules for every kind of move). */
function changeZone(c: CardInstance, from: ZoneId, to: ZoneId): void {
  if (from === to) return;
  const leavingField = isBattlefieldZone(from) && !isBattlefieldZone(to);
  const enteringField = !isBattlefieldZone(from) && isBattlefieldZone(to);
  if (leavingField || enteringField || !isBattlefieldZone(to)) c.tapped = false;
  if (leavingField) { c.counters = { plus: 0, minus: 0, labeled: {} }; c.face = 'front'; }
  c.faceDown = false;
  c.revealed = false;
}

/** Cards in `zone` attached to `hostId`, in zone order. */
function attachmentsOf(state: GameState, zone: ZoneId, hostId: string): string[] {
  return state.zones[zone].filter((id) => state.cards[id]?.attachedTo === hostId);
}

/** Remove every combat mark. */
function clearCombat(state: GameState): void {
  for (const c of Object.values(state.cards)) { delete c.attacking; delete c.blocking; }
}

const zoneEntries = (state: GameState) => Object.entries(state.zones) as [ZoneId, string[]][];

/**
 * Keep combat marks consistent after any command: only cards on a battlefield or lands zone carry
 * them, and a blocker only names attackers that are still attacking.
 */
export function fixCombat(state: GameState): void {
  // A creature that leaves the battlefield, or changes sides (control), is removed from combat
  // (rule 506.4): attackers stay only on the active player's side, blockers only on the other side.
  const zoneOf = new Map<string, ZoneId>();
  for (const [z, ids] of zoneEntries(state)) if (isBattlefieldZone(z)) ids.forEach((id) => zoneOf.set(id, z));
  for (const c of Object.values(state.cards)) {
    const z = zoneOf.get(c.id);
    const attackerSide = !!z && zoneOwner(z) === state.activePlayer;
    if (!z || !attackerSide) delete c.attacking;
    if (!z || attackerSide) delete c.blocking;
  }
  for (const c of Object.values(state.cards)) {
    if (!c.blocking) continue;
    c.blocking = c.blocking.filter((id) => state.cards[id]?.attacking);
    if (!c.blocking.length) delete c.blocking;
  }
}

/**
 * Keep attachments consistent after any command: an attachment must sit on the battlefield in
 * the same zone as its host, hosts are never attached themselves (one level), and each host's
 * attachments come immediately before it in the zone (they are drawn tucked to its left).
 */
export function fixAttachments(state: GameState): void {
  const zoneOf = new Map<string, ZoneId>();
  for (const [z, ids] of zoneEntries(state)) for (const id of ids) zoneOf.set(id, z);
  const cards = Object.values(state.cards);
  for (const c of cards) {
    if (!c.attachedTo) continue;
    const z = zoneOf.get(c.id);
    let host = state.cards[c.attachedTo];
    for (let guard = 0; host?.attachedTo && guard < 10; guard++) host = state.cards[host.attachedTo];
    if (!host || !z || host.id === c.id || host.attachedTo || zoneOf.get(host.id) !== z || !isBattlefieldZone(z)) delete c.attachedTo;
    else c.attachedTo = host.id;
  }
  // A card that is a host cannot itself stay attached (breaks any A<->B loop left above).
  for (const c of cards) if (c.attachedTo && cards.some((d) => d.attachedTo === c.id)) delete c.attachedTo;
  for (const [z, ids] of zoneEntries(state)) {
    if (!isBattlefieldZone(z) || !ids.some((id) => state.cards[id]!.attachedTo)) continue;
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const a = state.cards[id]!.attachedTo;
      if (a) { const g = groups.get(a); if (g) g.push(id); else groups.set(a, [id]); }
    }
    const out: string[] = [];
    for (const id of ids) if (!state.cards[id]!.attachedTo) out.push(...(groups.get(id) || []), id);
    state.zones[z] = out;
  }
}

/** Apply one command. Never mutates the input state. */
export function apply(input: GameState, cmd: Command): ApplyResult {
  if (!STATE_COMMANDS.has(cmd.type)) return fail('invalid', `unknown command ${cmd.type}`);
  if (input.result && cmd.type !== 'startGame') return fail('invalid', 'game is over');
  try {
    return run(input, cmd);
  } catch (e) {
    if (e instanceof NotEnoughRandomness) return fail('invalid', e.message);
    throw e;
  }
}

function run(input: GameState, cmd: Command): ApplyResult {
  const state = structuredClone(input);
  const moved: Movement[] = [];
  // Every field below is checked before use: the payload may come from the network.
  const p = (cmd.payload ?? {}) as Record<string, unknown>;

  // Shared precondition: the card is where the sender saw it.
  const need = (cardId: unknown, from: unknown): { id: string; from: ZoneId; card: CardInstance } | ApplyResult => {
    if (!isZone(from)) return fail('invalid', `bad zone ${String(from)}`);
    if (typeof cardId !== 'string' || !state.zones[from].includes(cardId)) return fail('stale', `${String(cardId)} not in ${from}`);
    return { id: cardId, from, card: state.cards[cardId]! };
  };
  const located = (x: ReturnType<typeof need>): x is { id: string; from: ZoneId; card: CardInstance } => 'card' in x;
  const bool = (v: unknown, current: boolean) => (typeof v === 'boolean' ? v : !current);

  switch (cmd.type) {
    case 'startGame': {
      const fresh = emptyState(typeof p.gameId === 'string' && p.gameId ? p.gameId : state.gameId,
        p.mode === 'networked' || p.mode === 'same-device' ? p.mode : state.mode);
      const take = randomSource(cmd.random);
      const life = isFiniteNum(p.startingLife) ? p.startingLife : 20;
      const players = (p.players ?? {}) as Partial<Record<PlayerId, Partial<PlayerSetup>>>;
      for (const pl of PLAYERS) {
        const spec = players[pl];
        if (!spec) return fail('invalid', `missing ${pl}`);
        fresh.players[pl] = { name: spec.name || pl, counters: [{ key: 'life', value: life }], libraryTopFaceUp: false };
        const ids: string[] = [];
        for (const c of spec.cards || []) {
          const id = `c${fresh.nextId++}`;
          fresh.cards[id] = newCard(id, c.defId, c.name || '', c.deckId || null, pl, false);
          ids.push(id);
        }
        shuffleInPlace(ids, take);
        const deal = Math.min(isFiniteNum(p.deal) ? p.deal : 7, ids.length);
        fresh.zones[`${pl}.hand`] = ids.slice(0, deal);
        fresh.zones[`${pl}.library`] = ids.slice(deal);
        for (const c of spec.commanders || []) {
          const id = `c${fresh.nextId++}`;
          fresh.cards[id] = newCard(id, c.defId, c.name || '', c.deckId || null, pl, false);
          fresh.zones[`${pl}.command`].push(id);
        }
      }
      fresh.turn = 1;
      fresh.activePlayer = p.first === 'p2' ? 'p2' : 'p1';
      fresh.seq = state.seq + 1;
      return { state: fresh, moved };
    }

    case 'move': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      if (!isZone(p.to)) return fail('invalid', `bad zone ${String(p.to)}`);
      const { card: c, from } = n;
      const to = p.to;
      const src = state.zones[from];
      // A host moving to a battlefield zone takes its attachments along; moving an attached card detaches it.
      const carry = c.attachedTo || !isBattlefieldZone(to) ? [] : attachmentsOf(state, from, c.id);
      delete c.attachedTo;
      for (const id of [...carry, c.id]) src.splice(src.indexOf(id), 1);
      if (c.isToken && !isBattlefieldZone(to) && to !== 'stack') {
        delete state.cards[c.id];
        moved.push({ id: c.id, from, to: null });
        break;
      }
      for (const id of [...carry, c.id]) changeZone(state.cards[id]!, from, to);
      const dst = state.zones[to];
      const idx = isInt(p.toIndex) ? Math.max(0, Math.min(p.toIndex, dst.length)) : dst.length;
      dst.splice(idx, 0, ...carry, c.id);
      moved.push({ id: c.id, from, to, toIndex: idx + carry.length });
      for (const [i, id] of carry.entries()) moved.push({ id, from, to, toIndex: idx + i });
      break;
    }

    case 'attach': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      if (!isZone(p.toZone) || !isBattlefieldZone(p.toZone)) return fail('invalid', 'cards can only be attached to a card on the battlefield');
      const toZone = p.toZone;
      if (typeof p.toCardId !== 'string' || !state.zones[toZone].includes(p.toCardId)) return fail('stale', `${String(p.toCardId)} not in ${toZone}`);
      let host = state.cards[p.toCardId]!;
      if (host.attachedTo) host = state.cards[host.attachedTo]!; // one level: attach to the card at the bottom
      const { card: c, from } = n;
      if (host.id === c.id) return fail('invalid', 'a card cannot be attached to itself');
      // A card that carries attachments brings them onto the new host too.
      const own = c.attachedTo ? [] : attachmentsOf(state, from, c.id);
      const group = [...own, c.id];
      const src = state.zones[from];
      for (const id of group) src.splice(src.indexOf(id), 1);
      for (const id of group) { changeZone(state.cards[id]!, from, toZone); state.cards[id]!.attachedTo = host.id; }
      const dst = state.zones[toZone];
      const idx = dst.indexOf(host.id); // just before the host: closest to it
      dst.splice(idx, 0, ...group);
      moved.push({ id: c.id, from, to: toZone, toIndex: idx + group.length - 1 });
      for (const [i, id] of own.entries()) moved.push({ id, from, to: toZone, toIndex: idx + i });
      break;
    }

    case 'attack': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      if (!isBattlefieldZone(n.from)) return fail('invalid', 'Only a card on the battlefield can attack.');
      const c = n.card;
      const on = typeof p.value === 'boolean' ? p.value : !c.attacking;
      // Only the active player attacks; a zone's owner is the player controlling the cards in it.
      if (zoneOwner(n.from) !== state.activePlayer && on) return fail('invalid', `Only ${state.players[state.activePlayer].name}’s creatures can attack this turn.`);
      if (on && !c.attacking) {
        // Numbers are given in declaration order and kept, so a blocker's mark never changes under it.
        const used = Object.values(state.cards).map((x) => x.attacking || 0);
        c.attacking = Math.max(0, ...used) + 1;
      } else if (!on) delete c.attacking;
      break;
    }

    case 'block': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      if (!isBattlefieldZone(n.from)) return fail('invalid', 'Only a card on the battlefield can block.');
      if (!isZone(p.attackerZone) || !isBattlefieldZone(p.attackerZone) || typeof p.attackerId !== 'string'
        || !state.zones[p.attackerZone].includes(p.attackerId)) return fail('stale', 'attacker moved');
      const a = state.cards[p.attackerId]!;
      if (!a.attacking) return fail('invalid', 'That card is not attacking.');
      if (a.id === n.id) return fail('invalid', 'A card cannot block itself.');
      const c = n.card;
      const list = c.blocking || [];
      const has = list.includes(a.id);
      const on = typeof p.value === 'boolean' ? p.value : !has;
      // Only the defending player blocks (removing a block is always allowed, to clean up).
      if (on && !has && zoneOwner(n.from) === state.activePlayer) return fail('invalid', `Only ${state.players[other(state.activePlayer)].name}’s creatures can block this turn.`);
      if (on && !has) c.blocking = [...list, a.id];
      if (!on && has) c.blocking = list.filter((id) => id !== a.id);
      if (c.blocking && !c.blocking.length) delete c.blocking;
      break;
    }

    case 'endCombat': {
      clearCombat(state);
      break;
    }

    case 'detach': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      const c = n.card;
      if (!c.attachedTo) return fail('invalid', 'card is not attached');
      const hostId = c.attachedTo;
      delete c.attachedTo;
      const z = state.zones[n.from];
      z.splice(z.indexOf(c.id), 1);
      z.splice(z.indexOf(hostId) + 1, 0, c.id); // just right of its former host
      break;
    }

    case 'detachAll': {
      // The same as detaching each attached card in turn, nearest the host last: they end up
      // just right of the host, the nearest first.
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      const z = state.zones[n.from];
      const own = attachmentsOf(state, n.from, n.id);
      if (!own.length) return fail('invalid', 'nothing is attached to that card');
      for (const id of own) {
        delete state.cards[id]!.attachedTo;
        z.splice(z.indexOf(id), 1);
        z.splice(z.indexOf(n.id) + 1, 0, id);
      }
      for (const [i, id] of [...own].reverse().entries()) moved.push({ id, from: n.from, to: n.from, toIndex: z.indexOf(n.id) + 1 + i });
      break;
    }

    case 'tap': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      n.card.tapped = bool(p.value, n.card.tapped);
      break;
    }

    case 'untapAll': {
      if (!isPlayer(p.player)) return fail('invalid', 'bad player');
      for (const z of [`${p.player}.battlefield`, `${p.player}.lands`] as const) {
        for (const id of state.zones[z]) state.cards[id]!.tapped = false;
      }
      break;
    }

    case 'flip': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      n.card.face = n.card.face === 'front' ? 'back' : 'front';
      break;
    }

    case 'setFaceDown': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      n.card.faceDown = bool(p.value, n.card.faceDown);
      break;
    }

    case 'reveal': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      n.card.revealed = bool(p.value, n.card.revealed);
      break;
    }

    case 'addCounter':
    case 'removeCounter': {
      const c = typeof p.cardId === 'string' ? state.cards[p.cardId] : undefined;
      if (!c) return fail('stale', 'no such card');
      if (p.from && !(isZone(p.from) && state.zones[p.from].includes(c.id))) return fail('stale', 'card moved');
      const n = isInt(p.n) && p.n > 0 ? p.n : 1;
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
      const owner = isPlayer(p.owner) ? p.owner : (zoneOwner(p.to) || 'p1');
      const id = `t${state.nextId++}`;
      state.cards[id] = newCard(id, String(p.defId ?? ''), typeof p.name === 'string' && p.name ? p.name : 'Token', null, owner, true);
      const dst = state.zones[p.to];
      const idx = isInt(p.toIndex) ? Math.max(0, Math.min(p.toIndex, dst.length)) : dst.length;
      dst.splice(idx, 0, id);
      moved.push({ id, from: null, to: p.to, toIndex: idx });
      break;
    }

    case 'removeToken': {
      const n = need(p.cardId, p.from); if (!located(n)) return n;
      if (!n.card.isToken) return fail('invalid', 'not a token');
      state.zones[n.from].splice(state.zones[n.from].indexOf(n.id), 1);
      delete state.cards[n.id];
      moved.push({ id: n.id, from: n.from, to: null });
      break;
    }

    case 'draw':
    case 'mill': {
      if (!isPlayer(p.player)) return fail('invalid', 'bad player');
      const libZone: ZoneId = `${p.player}.library`;
      const lib = state.zones[libZone];
      const n = Math.min(isInt(p.n) && p.n > 0 ? p.n : 1, lib.length);
      const to: ZoneId = cmd.type === 'draw' ? `${p.player}.hand` : `${p.player}.graveyard`;
      for (let i = 0; i < n; i++) {
        const id = lib.shift()!;
        const c = state.cards[id]!;
        c.faceDown = false; c.revealed = false; c.tapped = false;
        if (cmd.type === 'draw') { state.zones[to].push(id); moved.push({ id, from: libZone, to, toIndex: state.zones[to].length - 1 }); }
        else { state.zones[to].unshift(id); moved.push({ id, from: libZone, to, toIndex: 0 }); }
      }
      break;
    }

    case 'shuffle': {
      if (!isZone(p.zone)) return fail('invalid', 'bad zone');
      shuffleInPlace(state.zones[p.zone], randomSource(cmd.random));
      break;
    }

    case 'setLibraryTopFaceUp': {
      if (!isPlayer(p.player)) return fail('invalid', 'bad player');
      state.players[p.player].libraryTopFaceUp = !!p.value;
      break;
    }

    case 'setPlayerCounter': {
      if (!isPlayer(p.player)) return fail('invalid', 'bad player');
      const ctr = state.players[p.player].counters.find((x) => x.key === p.key);
      if (!ctr) return fail('invalid', 'no such counter');
      const v = Number(p.value);
      if (!Number.isFinite(v)) return fail('invalid', 'bad value');
      ctr.value = Math.round(v);
      break;
    }

    case 'addPlayerCounter': {
      if (!isPlayer(p.player)) return fail('invalid', 'bad player');
      const key = String(p.key || '').trim();
      if (!key) return fail('invalid', 'counter needs a name');
      const list = state.players[p.player].counters;
      if (list.some((x) => x.key.toLowerCase() === key.toLowerCase())) return fail('invalid', 'counter exists');
      list.push({ key, value: isFiniteNum(p.value) ? p.value : 0 });
      break;
    }

    case 'removePlayerCounter': {
      if (!isPlayer(p.player)) return fail('invalid', 'bad player');
      if (p.key === 'life') return fail('invalid', 'life cannot be removed');
      const list = state.players[p.player].counters;
      const i = list.findIndex((x) => x.key === p.key);
      if (i < 0) return fail('invalid', 'no such counter');
      list.splice(i, 1);
      break;
    }

    case 'passTurn': {
      const to = isPlayer(p.to) ? p.to : other(state.activePlayer);
      state.activePlayer = to;
      state.turn += 1;
      clearCombat(state);
      for (const z of [`${to}.battlefield`, `${to}.lands`] as const) {
        for (const id of state.zones[z]) state.cards[id]!.tapped = false;
      }
      break;
    }

    case 'concede': {
      if (!isPlayer(p.player)) return fail('invalid', 'bad player');
      state.result = { winner: other(p.player), reason: 'concede' };
      break;
    }

    case 'endGame': {
      state.result = { winner: isPlayer(p.winner) ? p.winner : null, reason: 'ended' };
      break;
    }

    default:
      return assertNever(cmd);
  }

  fixAttachments(state);
  fixCombat(state);
  state.seq = input.seq + 1;
  return { state, moved };
}

/**
 * Invariant check used by tests: every card in exactly one zone, every zone entry exists, and
 * the attachment and combat rules hold. Returns a description of the first violation, or null.
 */
export function checkInvariants(state: GameState): string | null {
  const seen = new Map<string, ZoneId>();
  for (const [z, ids] of zoneEntries(state)) {
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
    const z = seen.get(c.id)!, host = state.cards[c.attachedTo];
    if (!host) return `card ${c.id} attached to missing ${c.attachedTo}`;
    if (seen.get(host.id) !== z) return `card ${c.id} attached across zones`;
    if (!isBattlefieldZone(z)) return `card ${c.id} attached outside the battlefield`;
    if (host.attachedTo) return `card ${c.id} attached to an attached card`;
    const ids = state.zones[z], hi = ids.indexOf(host.id), ci = ids.indexOf(c.id);
    if (ci > hi || ids.slice(ci, hi).some((id) => state.cards[id]!.attachedTo !== host.id)) return `attachments of ${host.id} not just before it`;
  }
  for (const c of Object.values(state.cards)) {
    const z = seen.get(c.id)!;
    if ((c.attacking || c.blocking) && !isBattlefieldZone(z)) return `card ${c.id} has combat marks off the battlefield`;
    if (c.attacking && zoneOwner(z) !== state.activePlayer) return `card ${c.id} attacks from the defending side`;
    if (c.blocking && zoneOwner(z) === state.activePlayer) return `card ${c.id} blocks from the attacking side`;
    for (const a of c.blocking || []) if (!state.cards[a]?.attacking) return `card ${c.id} blocks ${a}, which is not attacking`;
  }
  return null;
}
