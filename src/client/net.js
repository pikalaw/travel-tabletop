// Host/guest handshake on top of a transport. Each side checks that it has every card
// image the other side's decks need, so both screens can draw every card.

import { getDefs, listDecks } from '../storage/db.js';
import { PROTOCOL_VERSION, APP_VERSION } from '../version.js';

/** Card specs for startGame from a set of decks: library cards and commanders. */
export async function deckSpec(decks) {
  const ids = decks.flatMap((d) => [...d.cards, ...(d.commanders || [])]);
  const defs = new Map((await getDefs(ids)).map((d) => [d.id, d]));
  const cards = [];
  const commanders = [];
  for (const d of decks) {
    for (const id of d.cards) cards.push({ defId: id, name: defs.get(id)?.name || '?', deckId: d.id });
    for (const id of d.commanders || []) commanders.push({ defId: id, name: defs.get(id)?.name || '?', deckId: d.id });
  }
  return { cards, commanders };
}

/** Every token definition on this device (from all token decks). */
export async function tokenDefIds() {
  return [...new Set((await listDecks()).filter((d) => d.kind === 'token').flatMap((d) => d.cards))];
}

/** Names of defs (from a list of {defId,name}) that this device does not have. */
export async function missingDefs(list) {
  const unique = [...new Map(list.map((x) => [x.defId, x])).values()];
  const have = new Set((await getDefs(unique.map((x) => x.defId))).map((d) => d.id));
  return unique.filter((x) => !have.has(x.defId)).map((x) => x.name || x.defId);
}

/** The guest's hello. */
export async function buildHello({ name, decks, gameId }) {
  const spec = await deckSpec(decks);
  return {
    type: 'hello', protocolVersion: PROTOCOL_VERSION, appVersion: APP_VERSION, name,
    spec, deckNames: decks.map((d) => d.name), tokens: await tokenDefIds(), gameId: gameId || null,
  };
}

/** Host side: check a hello. Returns null if fine, or a refusal message. */
export async function checkHello(hello) {
  if (hello.protocolVersion !== PROTOCOL_VERSION || hello.appVersion !== APP_VERSION) {
    return { type: 'refuse', reason: 'version', detail: `Host runs version ${APP_VERSION}, guest runs ${hello.appVersion}. Update both devices to the same version.` };
  }
  if (!hello.gameId) {
    const need = [...(hello.spec?.cards || []), ...(hello.spec?.commanders || [])];
    const missing = await missingDefs(need);
    if (missing.length) {
      return { type: 'refuse', reason: 'cards', missing, detail: `The host device is missing ${missing.length} of your cards. Import the same decks on both devices first.` };
    }
  }
  return null;
}

/** Guest side: check the host's welcome against local card images. */
export async function checkWelcome(welcome) {
  const st = welcome.state;
  const need = Object.values(st.cards).filter((c) => !c.isToken).map((c) => ({ defId: c.defId, name: c.name }));
  return missingDefs(need);
}
