// Random command sequences for the property suites (engine and host), from v1's tests.
import fc from 'fast-check';
import { allZones } from '../src/engine/view';
import type { GameState, ZoneId } from '../src/types/state';
import type { TestCommand } from './support';

const ZONES = allZones();
const FIELD: ZoneId[] = ['p1.battlefield', 'p2.battlefield', 'p1.lands'];
export const cmdArb = fc.oneof(
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
  fc.record({ type: fc.constant('detachAll'), pick: fc.nat() }),
  // Make lead succeeds only while a group exists, so it is drawn more often to get exercised.
  fc.record({ type: fc.constant('setLead'), pick: fc.nat() }),
  fc.record({ type: fc.constant('setLead'), pick: fc.nat() }),
  fc.record({ type: fc.constant('setLead'), pick: fc.nat() }),
  fc.record({ type: fc.constant('setLead'), pick: fc.nat() }),
  fc.record({ type: fc.constant('attack'), target: fc.nat() }),
  fc.record({ type: fc.constant('attack'), target: fc.nat() }),
  fc.record({ type: fc.constant('block'), target: fc.nat(), pick: fc.nat() }),
  fc.record({ type: fc.constant('block'), target: fc.nat(), pick: fc.nat() }),
  fc.record({ type: fc.constant('endCombat') }),
  fc.record({ type: fc.constant('putAbility'), pick: fc.nat() }),
  fc.record({ type: fc.constant('putAbility'), pick: fc.nat() }),
  // Resolve: move a card from the stack (an ability item is then deleted).
  fc.record({ type: fc.constant('resolve'), pick: fc.nat(), to: fc.constantFrom(...ZONES) }),
);

/** Turn an abstract step into a concrete command against the current state. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function concretize(state: GameState, step: any): TestCommand {
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
      const field = FIELD.flatMap((z) => state.zones[z].map((c) => [c, z] as const));
      const [t, tz] = field.length ? field[step.target % field.length] : ['none', 'p1.battlefield'];
      return { type: 'attach', actor: 'p1', payload: { cardId: id, from, toCardId: t, toZone: tz } };
    }
    case 'attack': case 'block': {
      const field = FIELD.flatMap((z) => state.zones[z].map((c) => [c, z] as const));
      if (!field.length) return { type: 'endCombat', actor: 'p1', payload: {} };
      const [c, z] = field[step.target % field.length];
      if (step.type === 'attack') return { type: 'attack', actor: 'p1', payload: { cardId: c, from: z } };
      const atk = field.filter(([x]) => state.cards[x].attacking);
      const [a, az] = atk.length ? atk[step.pick % atk.length] : field[step.pick % field.length];
      return { type: 'block', actor: 'p2', payload: { cardId: c, from: z, attackerId: a, attackerZone: az } };
    }
    case 'endCombat': return { type: 'endCombat', actor: 'p1', payload: {} };
    case 'resolve': {
      const st = state.zones.stack;
      const c = st.length ? st[step.pick % st.length] : id;
      return { type: 'move', actor: 'p1', payload: { cardId: c, from: st.length ? 'stack' : from, to: step.to } };
    }
    case 'putAbility': return { type: 'putAbility', actor: 'p1', payload: { cardId: id, from, text: 'Draw a card.' } };
    case 'detachAll': {
      const hosts = [...new Set(Object.values(state.cards).map((c) => c.attachedTo).filter((h): h is string => !!h))].sort();
      const h = hosts.length ? hosts[step.pick % hosts.length] : id;
      return { type: 'detachAll', actor: 'p1', payload: { cardId: h, from: ZONES.find((z) => state.zones[z].includes(h)) || from } };
    }
    case 'setLead': {
      const att = Object.values(state.cards).filter((c) => c.attachedTo).map((c) => c.id).sort();
      const a = att.length ? att[step.pick % att.length] : id;
      return { type: 'setLead', actor: 'p1', payload: { cardId: a, from: ZONES.find((z) => state.zones[z].includes(a)) || from } };
    }
    case 'detach': {
      const att = Object.values(state.cards).filter((c) => c.attachedTo).map((c) => c.id).sort();
      const a = att.length ? att[step.pick % att.length] : id;
      return { type: 'detach', actor: 'p1', payload: { cardId: a, from: ZONES.find((z) => state.zones[z].includes(a)) || from } };
    }
  }
  throw new Error(`unknown step ${step.type}`);
}

