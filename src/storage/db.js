// IndexedDB schema and helpers. One database holds card images (by content hash),
// card definitions, decks, saved games, undo snapshots and action logs.

import { openDB } from 'idb';
import { sha256Bytes } from './sha256.js';

/** @typedef {import('../types').CardDef} CardDef */
/** @typedef {import('../types').Deck} Deck */

let dbp = null;

export function db() {
  if (!dbp) {
    dbp = openDB('mtg-tabletop', 1, {
      upgrade(d) {
        d.createObjectStore('images', { keyPath: 'hash' });
        d.createObjectStore('defs', { keyPath: 'id' });
        d.createObjectStore('decks', { keyPath: 'id' });
        d.createObjectStore('games', { keyPath: 'id' });
        const snaps = d.createObjectStore('snapshots', { keyPath: ['gameId', 'key'] });
        snaps.createIndex('gameId', 'gameId');
        const logs = d.createObjectStore('logs', { keyPath: ['gameId', 'seq'] });
        logs.createIndex('gameId', 'gameId');
        d.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbp;
}

const enc = new TextEncoder();

/** SHA-256 of bytes or a string, as lowercase hex. */
export async function sha256(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const buf = globalThis.crypto?.subtle ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)) : sha256Bytes(bytes);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Store image bytes once; returns the content hash. */
export async function putImage(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = await sha256(bytes);
  const d = await db();
  if (!(await d.getKey('images', hash))) await d.put('images', { hash, blob, type: blob.type });
  return hash;
}

/** Content-derived card id, identical on every device that has the same images. */
export async function defIdFor(name, front, back) {
  return (await sha256(`${name}|${front}|${back || ''}`)).slice(0, 20);
}

/** @param {CardDef} def */
export async function putDef(def) { await (await db()).put('defs', def); }
/** @returns {Promise<CardDef | undefined>} */
export async function getDef(id) { return (await db()).get('defs', id); }
export async function getDefs(ids) {
  const d = await db();
  const tx = d.transaction('defs');
  const out = await Promise.all([...new Set(ids)].map((id) => tx.store.get(id)));
  await tx.done;
  return out.filter(Boolean);
}

/** @param {Deck} deck */
export async function putDeck(deck) { await (await db()).put('decks', deck); }
/** @returns {Promise<Deck[]>} */
export async function listDecks() {
  const all = await (await db()).getAll('decks');
  return all.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'deck' ? -1 : 1));
}
export async function getDeck(id) { return (await db()).get('decks', id); }
export async function deleteDeck(id) { await (await db()).delete('decks', id); }

export async function getMeta(key) { return (await (await db()).get('meta', key))?.value; }
export async function setMeta(key, value) { await (await db()).put('meta', { key, value }); }

// ---------- Images as object URLs ----------

const urlCache = new Map();
export async function imageUrl(hash) {
  if (!hash) return null;
  if (urlCache.has(hash)) return urlCache.get(hash);
  const rec = await (await db()).get('images', hash);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(hash, url);
  return url;
}

/**
 * Resolve image URLs for a set of card definitions, in every stored size.
 * `front` / `back` are the normal size; `sizes.front.small` etc. fall back to normal when missing
 * (sample cards are SVG and scale, and decks imported before sizes existed have one size).
 * @returns {Promise<Map<string, { name: string, front: string | null, back: string | null,
 *   sizes: { front: { small: string | null, normal: string | null, large: string | null },
 *            back: { small: string | null, normal: string | null, large: string | null } | null } }>>}
 */
export async function loadArt(defIds) {
  const defs = await getDefs(defIds);
  const out = new Map();
  for (const def of defs) {
    const front = await imageUrl(def.front);
    const back = def.back ? await imageUrl(def.back) : null;
    const face = async (normal, extra) => ({
      small: (extra?.small && (await imageUrl(extra.small))) || normal,
      normal,
      large: (extra?.large && (await imageUrl(extra.large))) || normal,
    });
    out.set(def.id, {
      name: def.name, front, back,
      sizes: { front: await face(front, def.sizes?.front), back: back ? await face(back, def.sizes?.back) : null },
    });
  }
  return out;
}

/** Choose an image size for a card drawn `cssHeight` CSS pixels tall on this screen. */
export function sizeFor(cssHeight) {
  const px = cssHeight * (globalThis.devicePixelRatio || 1);
  if (px <= 230) return 'small';   // small is 204 px tall
  if (px <= 720) return 'normal';  // normal is 680 px tall
  return 'large';                  // large is 936 px tall
}

/** URL of one face of a card at a size, with fallbacks. */
export function artUrl(art, face, size) {
  if (!art) return null;
  const set = face === 'back' ? art.sizes?.back : art.sizes?.front;
  return set?.[size] || (face === 'back' ? art.back : art.front) || null;
}

// ---------- Saved games ----------

export async function saveGameRecord(rec) { await (await db()).put('games', { ...rec, updatedAt: Date.now() }); }
export async function getGame(id) { return (await db()).get('games', id); }
export async function listGames() {
  const all = await (await db()).getAll('games');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function deleteGame(id) {
  const d = await db();
  const tx = d.transaction(['games', 'snapshots', 'logs'], 'readwrite');
  tx.objectStore('games').delete(id);
  for (const store of ['snapshots', 'logs']) {
    let cur = await tx.objectStore(store).index('gameId').openCursor(IDBKeyRange.only(id));
    while (cur) { cur.delete(); cur = await cur.continue(); }
  }
  await tx.done;
}

export async function loadSnapshots(gameId) {
  const rows = await (await db()).getAllFromIndex('snapshots', 'gameId', gameId);
  return rows.sort((a, b) => a.key - b.key).map((r) => ({ key: r.key, state: r.state }));
}
export async function loadLog(gameId) {
  const rows = await (await db()).getAllFromIndex('logs', 'gameId', gameId);
  return rows.sort((a, b) => a.seq - b.seq);
}

/**
 * Host persistence: one transaction per command (state + snapshot + log).
 * @param {object} meta  fields stored on the game record (mode, names, role, myPlayer)
 */
export function gamePersistence(meta) {
  return {
    async commit({ state, push, drop, log }) {
      const d = await db();
      const tx = d.transaction(['games', 'snapshots', 'logs'], 'readwrite');
      tx.objectStore('games').put({ ...meta, id: state.gameId, state, updatedAt: Date.now(), over: !!state.result });
      if (push) tx.objectStore('snapshots').put({ gameId: state.gameId, key: push.key, state: push.state });
      for (const key of drop || []) tx.objectStore('snapshots').delete([state.gameId, key]);
      for (const e of log || []) tx.objectStore('logs').put(e);
      await tx.done;
    },
  };
}
