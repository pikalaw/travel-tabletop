// Visibility rules and zone helpers. Pure functions shared by the engine, host, log and UI.

/** @typedef {import('../types').GameState} GameState */
/** @typedef {import('../types').CardInstance} CardInstance */
/** @typedef {import('../types').PlayerId} PlayerId */
/** @typedef {import('../types').ZoneId} ZoneId */
/** @typedef {import('../types').Viewer} Viewer */

/** @type {PlayerId[]} */
export const PLAYERS = ['p1', 'p2'];
export const ZONE_KINDS = /** @type {const} */ (['library', 'hand', 'battlefield', 'lands', 'graveyard', 'exile', 'command']);

/** @returns {ZoneId[]} */
export function allZones() {
  /** @type {ZoneId[]} */
  const out = [];
  for (const p of PLAYERS) for (const k of ZONE_KINDS) out.push(/** @type {ZoneId} */ (`${p}.${k}`));
  out.push('stack');
  return out;
}

/** @param {PlayerId} p */
export const other = (p) => (p === 'p1' ? 'p2' : 'p1');

/** @param {string} zone @returns {PlayerId | null} */
export function zoneOwner(zone) {
  if (zone === 'stack') return null;
  const p = zone.split('.')[0];
  return p === 'p1' || p === 'p2' ? p : null;
}

/** @param {string} zone */
export function zoneKind(zone) {
  return zone === 'stack' ? 'stack' : zone.split('.')[1];
}

/** @param {string} zone */
export function isZone(zone) {
  return allZones().includes(/** @type {ZoneId} */ (zone));
}

/** Zones where cards are "on the battlefield" (tokens survive only here). */
export function isBattlefieldZone(zone) {
  const k = zoneKind(zone);
  return k === 'battlefield' || k === 'lands';
}

/** @param {GameState} state @param {string} cardId @returns {ZoneId | null} */
export function findZone(state, cardId) {
  for (const z of /** @type {ZoneId[]} */ (Object.keys(state.zones))) {
    if (state.zones[z].includes(cardId)) return z;
  }
  return null;
}

/**
 * Can `viewer` see the face of `card` while it sits in `zone`?
 * @param {GameState} state @param {CardInstance} card @param {string} zone @param {Viewer} viewer
 */
export function canSeeFace(state, card, zone, viewer) {
  const kind = zoneKind(zone);
  const owner = zoneOwner(zone);
  if (kind === 'library') {
    // Only the top card, and only when that library plays with its top card face up.
    const top = state.zones[/** @type {ZoneId} */ (zone)][0] === card.id;
    return top && !!owner && state.players[owner].libraryTopFaceUp;
  }
  if (kind === 'hand') {
    return card.revealed || (viewer !== 'nobody' && viewer === owner);
  }
  if (card.faceDown) return viewer !== 'nobody' && viewer === card.owner;
  return true;
}

/** Players who can see the face of a card in a zone. @returns {PlayerId[]} */
export function visibleTo(state, card, zone) {
  return PLAYERS.filter((p) => canSeeFace(state, card, zone, p));
}

/** Hand size for a player. */
export function handCount(state, p) {
  return state.zones[`${p}.hand`].length;
}
