// Per-player 4-digit codes for one-device games: unblinding a hand needs that player's code.
// Only salted hashes are stored, with the saved game. This stops a casual peek while the other
// player looks away; it is not strong security (4 digits, stored on the same device).

import { sha256, getGame, saveGameRecord } from '../storage/db.js';

export const CODE_RE = /^\d{4}$/;

export function newSalt() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const hashCode = (salt, pl, code) => sha256(`${salt}:${pl}:${code}`);

/** Hash both players' codes for a new game's metadata. */
export async function makePins(codes) {
  const pinSalt = newSalt();
  return { pinSalt, pins: { p1: await hashCode(pinSalt, 'p1', codes.p1), p2: await hashCode(pinSalt, 'p2', codes.p2) } };
}

/**
 * The lock the game screen uses. `meta` is the game's metadata object (it is saved with every
 * command); `gameId()` returns the current game id so a reset can be saved at once.
 */
export function makeLock(meta, gameId) {
  if (!meta?.pins || !meta.pinSalt) return null;
  return {
    async check(pl, code) {
      return CODE_RE.test(code) && (await hashCode(meta.pinSalt, pl, code)) === meta.pins[pl];
    },
    /** Set a new code for `pl`, authorised by the other player's code. */
    async reset(pl, otherCode, newCode) {
      const other = pl === 'p1' ? 'p2' : 'p1';
      if (!CODE_RE.test(newCode)) return 'The new code must be 4 digits.';
      if ((await hashCode(meta.pinSalt, other, otherCode)) !== meta.pins[other]) return 'That is not the other player’s code.';
      meta.pins = { ...meta.pins, [pl]: await hashCode(meta.pinSalt, pl, newCode) };
      const rec = await getGame(gameId());
      if (rec) await saveGameRecord({ ...rec, pins: meta.pins, pinSalt: meta.pinSalt });
      return null;
    },
  };
}
