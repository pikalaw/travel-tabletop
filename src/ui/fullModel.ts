// What the full view shows for one card or ability item, and what it offers. One pure function,
// so FullCard and its footer read a model instead of testing what kind of thing they show.

import { canSeeFace, isBattlefieldZone, zoneKind, zoneOwner } from '../engine/view';
import type { CardInstance, GameState, Viewer, ZoneId } from '../types/state';

export interface FullActions {
  flip: boolean;
  faceDown: boolean;
  reveal: boolean;
  /** Not for a creature on the active player's side: it is marked attacking with the ⚔ Attack tag. */
  block: boolean;
  attach: boolean;
  detach: boolean;
  makeLead: boolean;
  /** How many cards are attached to this card's group's lead (0: no Detach all). */
  detachAll: number;
  counters: boolean;
}

export interface FullModel {
  card: CardInstance;
  zone: ZoneId;
  /** The viewer sees the face (a face-down card's owner does too). */
  visible: boolean;
  title: string;
  /** An ability item's text, shown under the title. */
  abilityText: string | null;
  /** "Stack 2 of 3" for anything on the stack. */
  caption: string | null;
  /** List the card's abilities, to put one on the stack (not for a card already on the stack). */
  offersAbilities: boolean;
  /** A tap on the picture taps or untaps the card (there is no Tap button). */
  tapToggle: boolean;
  actions: FullActions;
}

export function fullModel(state: GameState, cardId: string, zone: ZoneId, viewer: Viewer): FullModel | null {
  const card = state.cards[cardId];
  if (!card) return null;
  const kind = zoneKind(zone);
  const field = isBattlefieldZone(zone);
  const visible = canSeeFace(state, card, zone, viewer) || (card.faceDown && viewer === card.owner);
  const isCard = !card.ability;
  const name = visible ? card.name : null;
  const pos = zone === 'stack' ? state.zones.stack.indexOf(cardId) + 1 : 0;
  const lead = card.attachedTo || card.id;
  const attached = field ? state.zones[zone].filter((id) => state.cards[id]?.attachedTo === lead).length : 0;
  const attacker = field && zoneOwner(zone) === state.activePlayer;
  return {
    card,
    zone,
    visible,
    title: card.ability ? `Ability of ${name ?? 'a face-down card'}` : (name ?? 'Hidden card'),
    abilityText: card.ability?.text ?? null,
    caption: pos ? `Stack ${pos} of ${state.zones.stack.length}${pos === 1 ? ' · resolves first' : ''}` : null,
    offersAbilities: isCard && visible && zone !== 'stack',
    tapToggle: field,
    actions: {
      flip: isCard,
      faceDown: isCard,
      reveal: kind === 'hand',
      block: field && !attacker,
      attach: isCard && !card.attachedTo && kind !== 'library',
      detach: !!card.attachedTo,
      makeLead: !!card.attachedTo,
      detachAll: attached,
      counters: isCard,
    },
  };
}
