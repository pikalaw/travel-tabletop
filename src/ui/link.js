// Game links: index.html#game=<id> reopens a saved game on the device that has it.
// The game itself never travels in the link; another device can only report that it lacks it.

const B32 = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lower case (no i, l, o, u)

/**
 * A new game id: the date for readability, then 80 random bits, so ids from different devices
 * never collide in practice (the odds for two ids are about 1 in 10^24).
 * crypto.getRandomValues works on plain-HTTP pages too, unlike crypto.subtle.
 */
export function newGameId(now = new Date()) {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0, acc = 0, out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(acc >> bits) & 31]; }
  }
  return `${now.toISOString().slice(0, 10)}-${out}`;
}

/** The game id in a URL hash such as "#game=2026-11-02-abc…", or null. */
export function parseGameLink(hash) {
  const m = /^#game=([0-9A-Za-z-]{1,64})$/.exec(hash || '');
  return m ? m[1] : null;
}

/** Point the address bar at this game (or at no game), without adding a history entry. */
export function setGameLink(id) {
  try {
    const url = location.pathname + location.search + (id ? `#game=${id}` : '');
    if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url);
  } catch { /* not fatal: the link is only a convenience */ }
}
