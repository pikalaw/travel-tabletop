// The full view's model: what it shows and offers for a card in play, in hand, on the stack, and
// for an ability item (including one from a face-down card).
import { describe, expect, it } from 'vitest';
import { fullModel } from '../src/ui/fullModel';
import { started } from './support';

describe('fullModel', () => {
  function table() {
    const h = started();
    const [a, b, c, d] = h.state.zones['p1.hand'];
    const send = (type: string, payload: object, actor: 'p1' | 'p2' = 'p1') => expect(h.dispatch({ type, actor, payload }).ok).toBe(true);
    send('move', { cardId: a, from: 'p1.hand', to: 'p1.battlefield' });
    send('move', { cardId: b, from: 'p1.hand', to: 'stack', toIndex: 0 });
    send('putAbility', { cardId: a, from: 'p1.battlefield', text: 'Draw a card.' });
    return { h, a, b, c, d, send };
  }

  it('a card in play: tap toggle, combat by side, abilities; no stack caption', () => {
    const { h, a } = table();
    const m = fullModel(h.state, a, 'p1.battlefield', 'p1')!;
    expect(m).toMatchObject({ title: h.state.cards[a].name, caption: null, abilityText: null, offersAbilities: true, tapToggle: true });
    expect(m.actions).toMatchObject({ tap: true, attack: true, block: false, flip: true, attach: true, counters: true, reveal: false });
    // attack or block follows the card's side, not who is looking
    expect(fullModel(h.state, a, 'p1.battlefield', 'p2')!.actions).toMatchObject({ attack: true, block: false });
  });

  it('the stack: position caption, top resolves first; an ability item offers only what makes sense', () => {
    const { h, a, b } = table();
    const item = h.state.zones.stack[0]!;
    const top = fullModel(h.state, item, 'stack', 'p2')!;
    expect(top).toMatchObject({ title: `Ability of ${h.state.cards[a].name}`, abilityText: 'Draw a card.', caption: 'Stack 1 of 2 · resolves first', offersAbilities: false, tapToggle: false });
    expect(Object.entries(top.actions).filter(([, v]) => v).map(([k]) => k)).toEqual([]);
    const spell = fullModel(h.state, b, 'stack', 'p1')!;
    expect(spell).toMatchObject({ caption: 'Stack 2 of 2', offersAbilities: true, tapToggle: false });
    expect(spell.actions).toMatchObject({ flip: true, attach: true, tap: false, attack: false, block: false });
  });

  it('hidden faces: a card in the other hand is a hidden card; a face-down ability hides its source', () => {
    const { h, a, c, send } = table();
    expect(fullModel(h.state, c, 'p1.hand', 'p2')).toMatchObject({ visible: false, title: 'Hidden card', offersAbilities: false });
    expect(fullModel(h.state, c, 'p1.hand', 'p1')!.actions.reveal).toBe(true);
    send('setFaceDown', { cardId: a, from: 'p1.battlefield', value: true });
    send('putAbility', { cardId: a, from: 'p1.battlefield', text: 'Turn it face up.' });
    const item = h.state.zones.stack[0]!;
    expect(fullModel(h.state, item, 'stack', 'p2')).toMatchObject({ visible: false, title: 'Ability of a face-down card', abilityText: 'Turn it face up.' });
    expect(fullModel(h.state, item, 'stack', 'p1')).toMatchObject({ visible: true, title: `Ability of ${h.state.cards[a].name}` });
  });

  it('a group in play: detach, make lead and detach all', () => {
    const { h, a, d, send } = table();
    send('attach', { cardId: d, from: 'p1.hand', toCardId: a, toZone: 'p1.battlefield' });
    expect(fullModel(h.state, d, 'p1.battlefield', 'p1')!.actions).toMatchObject({ detach: true, makeLead: true, attach: false, detachAll: 1 });
    expect(fullModel(h.state, a, 'p1.battlefield', 'p1')!.actions).toMatchObject({ detach: false, makeLead: false, attach: true, detachAll: 1 });
    expect(fullModel(h.state, 'nope', 'p1.battlefield', 'p1')).toBeNull();
  });
});
