// Human-readable one-line descriptions of commands and notices, for the ticker and log.
// Card names appear only when both players could see the card before or after the change.

import { zoneKind, zoneOwner, visibleTo } from '../engine/view.js';

const ZONE_LABEL = {
  library: 'library', hand: 'hand', battlefield: 'battlefield', lands: 'lands',
  graveyard: 'graveyard', exile: 'exile', command: 'command zone', stack: 'stack',
};

function who(state, actor) {
  if (actor === 'p1' || actor === 'p2') return state.players[actor].name;
  if (actor === 'table') return 'Table';
  return 'Host';
}

function zoneName(state, zone, actor) {
  if (!zone) return '';
  const kind = ZONE_LABEL[zoneKind(zone)] || zone;
  const owner = zoneOwner(zone);
  if (!owner) return `the ${kind}`;
  if (owner === actor) return `their ${kind}`;
  return `${state.players[owner].name}'s ${kind}`;
}

function cardName(before, after, id, fromZone, toZone) {
  const b = before.cards[id];
  const a = after?.cards?.[id];
  const publicBefore = b && fromZone && visibleTo(before, b, fromZone).length === 2;
  const publicAfter = a && toZone && visibleTo(after, a, toZone).length === 2;
  const c = b || a;
  if (!c) return 'a card';
  return publicBefore || publicAfter ? c.name || 'a card' : (c.isToken ? 'a token' : 'a card');
}

/** @param {any} cmd @param {any} before @param {any} after @param {any[]} moved */
export function describeCommand(cmd, before, after, moved = []) {
  const p = cmd.payload || {};
  const name = who(after || before, cmd.actor);
  const st = after || before;
  switch (cmd.type) {
    case 'startGame': return `New game: ${st.players.p1.name} vs ${st.players.p2.name}`;
    case 'move': {
      const m = moved[0];
      if (!m) return `${name} moved a card`;
      const cn = cardName(before, after, p.cardId, p.from, m.to);
      if (!m.to) return `${name} removed ${cn}`;
      if (p.from === p.to) return `${name} reordered ${zoneName(st, p.to, cmd.actor)}`;
      let where = zoneName(st, m.to, cmd.actor);
      if (zoneKind(m.to) === 'library') where = `${m.toIndex === 0 ? 'the top' : 'the bottom'} of ${where}`;
      return `${name}: ${cn} → ${where}`;
    }
    case 'attach': {
      const hostId = st.cards[p.cardId]?.attachedTo || p.toCardId;
      return `${name} attached ${cardName(before, after, p.cardId, p.from, p.toZone)} to ${cardName(before, after, hostId, p.toZone, p.toZone)}`;
    }
    case 'attack': return st.cards[p.cardId]?.attacking
      ? `${name}: ${cardName(before, after, p.cardId, p.from, p.from)} attacks (⚔${st.cards[p.cardId].attacking})`
      : `${name}: ${cardName(before, after, p.cardId, p.from, p.from)} no longer attacks`;
    case 'block': {
      const blocks = (st.cards[p.cardId]?.blocking || []).includes(p.attackerId);
      const an = cardName(before, after, p.attackerId, p.attackerZone, p.attackerZone);
      const num = (after || before).cards[p.attackerId]?.attacking;
      return `${name}: ${cardName(before, after, p.cardId, p.from, p.from)} ${blocks ? 'blocks' : 'stops blocking'} ${an}${num ? ` (⚔${num})` : ''}`;
    }
    case 'endCombat': return `${name} ended combat`;
    case 'detach': return `${name} detached ${cardName(before, after, p.cardId, p.from, p.from)}`;
    case 'tap': {
      const c = st.cards[p.cardId];
      return `${name} ${c?.tapped ? 'tapped' : 'untapped'} ${cardName(before, after, p.cardId, p.from, p.from)}`;
    }
    case 'untapAll': return `${name} untapped all`;
    case 'flip': return `${name} flipped ${cardName(before, after, p.cardId, p.from, p.from)}`;
    case 'setFaceDown': return `${name} turned a card face ${st.cards[p.cardId]?.faceDown ? 'down' : 'up'}`;
    case 'reveal': return st.cards[p.cardId]?.revealed
      ? `${name} revealed ${cardName(before, after, p.cardId, p.from, p.from)}`
      : `${name} hid a revealed card`;
    case 'addCounter':
    case 'removeCounter': {
      const label = p.kind === 'plus' ? '+1/+1' : p.kind === 'minus' ? '−1/−1' : p.label;
      const verb = cmd.type === 'addCounter' ? 'added' : 'removed';
      return `${name} ${verb} a ${label} counter ${cmd.type === 'addCounter' ? 'on' : 'from'} ${cardName(before, after, p.cardId, p.from, p.from)}`;
    }
    case 'createToken': return `${name} created ${p.name || 'a token'}`;
    case 'removeToken': return `${name} removed ${before.cards[p.cardId]?.name || 'a token'}`;
    case 'draw': return `${name} drew ${moved.length} card${moved.length === 1 ? '' : 's'}`;
    case 'mill': return `${name} milled ${moved.length} card${moved.length === 1 ? '' : 's'}`;
    case 'shuffle': return `${name} shuffled ${zoneName(st, p.zone, cmd.actor)}`;
    case 'setLibraryTopFaceUp': return `${name} turned ${zoneName(st, `${p.player}.library`, cmd.actor)} top card ${p.value ? 'face up' : 'face down'}`;
    case 'setPlayerCounter': {
      const prev = before.players[p.player].counters.find((x) => x.key === p.key)?.value;
      return `${name}: ${st.players[p.player].name} ${p.key} ${prev} → ${p.value}`;
    }
    case 'addPlayerCounter': return `${name} added counter "${p.key}" for ${st.players[p.player].name}`;
    case 'removePlayerCounter': return `${name} removed counter "${p.key}" for ${st.players[p.player].name}`;
    case 'passTurn': return `Turn ${st.turn}: ${st.players[st.activePlayer].name}`;
    case 'concede': return `${st.players[p.player].name} conceded`;
    case 'endGame': return `Game ended`;
    default: return `${name}: ${cmd.type}`;
  }
}

/** @param {any} n notice @param {any} state */
export function describeNotice(n, state) {
  const name = who(state, n.actor);
  const p = n.payload || {};
  switch (n.kind) {
    case 'peek': return `${name} is looking at the top ${p.n} of ${zoneName(state, p.zone, n.actor)}`;
    case 'revealTop': return `${name} revealed the top ${p.n} of ${zoneName(state, p.zone, n.actor)}`;
    case 'searchOpen': return `${name} is searching ${zoneName(state, p.zone, n.actor)}`;
    case 'searchClose': return `${name} finished searching ${zoneName(state, p.zone, n.actor)}`;
    case 'inspect': return `${name} is looking at ${zoneName(state, p.zone, n.actor)}`;
    case 'point': return `${name} is pointing`;
    case 'showCard': return `${name} revealed ${state.cards[p.cardId]?.name || 'a card'}`;
    case 'coinFlip': return `${name} flipped a coin: ${p.result}`;
    case 'rollDie': return `${name} rolled a d${p.sides}: ${p.result}`;
    case 'randomPick': return `${name} picked at random from ${zoneName(state, p.zone, n.actor)}`;
    default: return n.text || `${name}: ${n.kind}`;
  }
}

/** Notices that should alert the other player (library honesty, randomness). */
export const ALERT_NOTICES = new Set(['peek', 'revealTop', 'searchOpen', 'searchClose', 'inspect', 'coinFlip', 'rollDie', 'randomPick']);
