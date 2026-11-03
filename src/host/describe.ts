// Human-readable one-line descriptions of commands and notices, for the ticker and log.
// Card names appear only when both players could see the card before or after the change.
// Commands reach here only after the engine applied them, so their payloads are valid.

import { zoneKind, zoneOwner, visibleTo } from '../engine/view';
import { assertNever, type Command, type Movement, type Notice, type NoticeKind } from '../types/commands';
import type { Actor, GameState, ZoneId } from '../types/state';

const ZONE_LABEL: Record<string, string> = {
  library: 'library', hand: 'hand', battlefield: 'battlefield', lands: 'lands',
  graveyard: 'graveyard', exile: 'exile', command: 'command zone', stack: 'stack',
};

/** The actor's display name. */
export function who(state: GameState, actor: Actor): string {
  if (actor === 'p1' || actor === 'p2') return state.players[actor].name;
  if (actor === 'table') return 'Table';
  return 'Host';
}

function zoneName(state: GameState, zone: ZoneId | null | undefined, actor: Actor): string {
  if (!zone) return '';
  const kind = ZONE_LABEL[zoneKind(zone)] || zone;
  const owner = zoneOwner(zone);
  if (!owner) return `the ${kind}`;
  if (owner === actor) return `their ${kind}`;
  return `${state.players[owner].name}'s ${kind}`;
}

function cardName(before: GameState, after: GameState | null, id: string, fromZone: ZoneId | null, toZone: ZoneId | null): string {
  const b = before.cards[id];
  const a = after?.cards[id];
  const publicBefore = !!b && !!fromZone && visibleTo(before, b, fromZone).length === 2;
  const publicAfter = !!a && !!toZone && !!after && visibleTo(after, a, toZone).length === 2;
  const c = b || a;
  if (!c) return 'a card';
  return publicBefore || publicAfter ? c.name || 'a card' : (c.isToken ? 'a token' : 'a card');
}

export function describeCommand(cmd: Command, before: GameState, after: GameState | null, moved: readonly Movement[] = []): string {
  const st = after || before;
  const name = who(st, cmd.actor);
  const cn = (id: string, from: ZoneId | null, to: ZoneId | null) => cardName(before, after, id, from, to);
  switch (cmd.type) {
    case 'startGame': return `New game: ${st.players.p1.name} vs ${st.players.p2.name}`;
    case 'move': {
      const p = cmd.payload;
      const m = moved[0];
      if (!m) return `${name} moved a card`;
      const card = cn(p.cardId, p.from, m.to);
      if (!m.to) return `${name} removed ${card}`;
      if (p.from === p.to) return `${name} reordered ${zoneName(st, p.to, cmd.actor)}`;
      let where = zoneName(st, m.to, cmd.actor);
      if (zoneKind(m.to) === 'library') where = `${m.toIndex === 0 ? 'the top' : 'the bottom'} of ${where}`;
      return `${name}: ${card} → ${where}`;
    }
    case 'attach': {
      const p = cmd.payload;
      const hostId = st.cards[p.cardId]?.attachedTo || p.toCardId;
      return `${name} attached ${cn(p.cardId, p.from, p.toZone)} to ${cn(hostId, p.toZone, p.toZone)}`;
    }
    case 'attack': {
      const p = cmd.payload;
      const n = st.cards[p.cardId]?.attacking;
      return n
        ? `${name}: ${cn(p.cardId, p.from, p.from)} attacks (⚔${n})`
        : `${name}: ${cn(p.cardId, p.from, p.from)} no longer attacks`;
    }
    case 'block': {
      const p = cmd.payload;
      const blocks = (st.cards[p.cardId]?.blocking || []).includes(p.attackerId);
      const an = cn(p.attackerId, p.attackerZone, p.attackerZone);
      const num = st.cards[p.attackerId]?.attacking;
      return `${name}: ${cn(p.cardId, p.from, p.from)} ${blocks ? 'blocks' : 'stops blocking'} ${an}${num ? ` (⚔${num})` : ''}`;
    }
    case 'endCombat': return `${name} ended combat`;
    case 'detach': return `${name} detached ${cn(cmd.payload.cardId, cmd.payload.from, cmd.payload.from)}`;
    case 'detachAll': return `${name} detached ${moved.length} card${moved.length === 1 ? '' : 's'} from ${cn(cmd.payload.cardId, cmd.payload.from, cmd.payload.from)}`;
    case 'tap': {
      const p = cmd.payload;
      return `${name} ${st.cards[p.cardId]?.tapped ? 'tapped' : 'untapped'} ${cn(p.cardId, p.from, p.from)}`;
    }
    case 'untapAll': return `${name} untapped all`;
    case 'flip': return `${name} flipped ${cn(cmd.payload.cardId, cmd.payload.from, cmd.payload.from)}`;
    case 'setFaceDown': return `${name} turned a card face ${st.cards[cmd.payload.cardId]?.faceDown ? 'down' : 'up'}`;
    case 'reveal': {
      const p = cmd.payload;
      return st.cards[p.cardId]?.revealed ? `${name} revealed ${cn(p.cardId, p.from, p.from)}` : `${name} hid a revealed card`;
    }
    case 'addCounter':
    case 'removeCounter': {
      const p = cmd.payload;
      const label = p.kind === 'plus' ? '+1/+1' : p.kind === 'minus' ? '−1/−1' : p.label;
      const add = cmd.type === 'addCounter';
      const from = p.from ?? null;
      return `${name} ${add ? 'added' : 'removed'} a ${label} counter ${add ? 'on' : 'from'} ${cn(p.cardId, from, from)}`;
    }
    case 'createToken': return `${name} created ${cmd.payload.name || 'a token'}`;
    case 'removeToken': return `${name} removed ${before.cards[cmd.payload.cardId]?.name || 'a token'}`;
    case 'draw': return `${name} drew ${moved.length} card${moved.length === 1 ? '' : 's'}`;
    case 'mill': return `${name} milled ${moved.length} card${moved.length === 1 ? '' : 's'}`;
    case 'shuffle': return `${name} shuffled ${zoneName(st, cmd.payload.zone, cmd.actor)}`;
    case 'setLibraryTopFaceUp': {
      const p = cmd.payload;
      return `${name} turned ${zoneName(st, `${p.player}.library`, cmd.actor)} top card ${p.value ? 'face up' : 'face down'}`;
    }
    case 'setPlayerCounter': {
      const p = cmd.payload;
      const prev = before.players[p.player].counters.find((x) => x.key === p.key)?.value;
      return `${name}: ${st.players[p.player].name} ${p.key} ${prev} → ${p.value}`;
    }
    case 'addPlayerCounter': return `${name} added counter "${cmd.payload.key}" for ${st.players[cmd.payload.player].name}`;
    case 'removePlayerCounter': return `${name} removed counter "${cmd.payload.key}" for ${st.players[cmd.payload.player].name}`;
    case 'passTurn': return `Turn ${st.turn}: ${st.players[st.activePlayer].name}`;
    case 'concede': return `${st.players[cmd.payload.player].name} conceded`;
    case 'endGame': return 'Game ended';
    default: return assertNever(cmd);
  }
}

export function describeNotice(n: Notice, state: GameState): string {
  const name = who(state, n.actor);
  const zn = (z: ZoneId) => zoneName(state, z, n.actor);
  switch (n.kind) {
    case 'peek': return `${name} is looking at the top ${n.payload.n} of ${zn(n.payload.zone)}`;
    case 'revealTop': return `${name} revealed the top ${n.payload.n} of ${zn(n.payload.zone)}`;
    case 'searchOpen': return `${name} is searching ${zn(n.payload.zone)}`;
    case 'searchClose': return `${name} finished searching ${zn(n.payload.zone)}`;
    case 'inspect': return `${name} is looking at ${zn(n.payload.zone)}`;
    case 'point': return `${name} is pointing`;
    case 'showCard': return `${name} revealed ${state.cards[n.payload.cardId]?.name || 'a card'}`;
    case 'coinFlip': return `${name} flipped a coin: ${n.payload.result}`;
    case 'rollDie': return `${name} rolled a d${n.payload.sides}: ${n.payload.result}`;
    case 'randomPick': return `${name} picked at random from ${zn(n.payload.zone)}`;
    case 'info': return n.text || `${name}: ${n.kind}`;
    default: return assertNever(n);
  }
}

/** Notices that should alert the other player (library honesty, randomness). */
export const ALERT_NOTICES: ReadonlySet<NoticeKind> = new Set<NoticeKind>(['peek', 'revealTop', 'searchOpen', 'searchClose', 'inspect', 'coinFlip', 'rollDie', 'randomPick']);
