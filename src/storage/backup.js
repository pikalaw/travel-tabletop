// Deck backups: any number of decks, with their card definitions and every image size,
// in one zip file (.mtgdecks). Restoring checks each image against its hash and reports which
// decks are new, already on this device, or possible duplicates of decks already here.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { db, sha256, listDecks, getDefs, putDef, putDeck } from './db.js';

export const BACKUP_FORMAT = 'travel-tabletop-decks';
export const BACKUP_VERSION = 1;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

/** Every image hash a card definition refers to. */
function hashesOf(def) {
  return [def.front, def.back, def.sizes?.front?.small, def.sizes?.front?.large, def.sizes?.back?.small, def.sizes?.back?.large].filter(Boolean);
}

/** Token decks that belong with the chosen decks. */
export function companionTokenDecks(allDecks, deckIds) {
  const chosen = new Set(deckIds);
  return allDecks.filter((d) => d.kind === 'token' && !chosen.has(d.id) && (d.forDecks || []).some((id) => chosen.has(id)));
}

/**
 * Build a backup of `deckIds` (their token decks are added automatically).
 * @returns {Promise<{ blob: Blob, decks: number, cards: number, images: number }>}
 */
export async function exportBackup(deckIds, onProgress = () => {}) {
  const all = await listDecks();
  const decks = [...all.filter((d) => deckIds.includes(d.id)), ...companionTokenDecks(all, deckIds)];
  const defIds = [...new Set(decks.flatMap((d) => [...d.cards, ...(d.commanders || [])]))];
  const defs = await getDefs(defIds);
  const hashes = [...new Set(defs.flatMap(hashesOf))];
  const files = {};
  const images = {};
  const d = await db();
  let n = 0;
  for (const h of hashes) {
    const rec = await d.get('images', h); // one read per transaction: awaiting other work would close a shared one
    if (!rec) continue;
    const ext = EXT[rec.type || rec.blob.type] || 'bin';
    files[`images/${h}.${ext}`] = [new Uint8Array(await rec.blob.arrayBuffer()), { level: 0 }]; // already compressed
    images[h] = ext;
    if (++n % 20 === 0) onProgress(`Packing images ${n} of ${hashes.length}…`);
  }
  const manifest = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    decks, defs, images,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const zip = zipSync(files);
  return { blob: new Blob([zip], { type: 'application/zip' }), decks: decks.length, cards: defs.length, images: Object.keys(images).length };
}

/**
 * Read a backup file and compare its decks with this device.
 * @returns {Promise<{ manifest: any, files: Record<string, Uint8Array>, rows: { deck: any, status: 'new' | 'same' | 'similar', like?: string }[] }>}
 */
export async function readBackup(file) {
  let files;
  try { files = unzipSync(new Uint8Array(await file.arrayBuffer())); }
  catch { throw new Error('That file is not a deck backup from this app.'); }
  if (!files['manifest.json']) throw new Error('That file is not a deck backup from this app.');
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  if (manifest.format !== BACKUP_FORMAT) throw new Error('That file is not a deck backup from this app.');
  if (manifest.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  const here = await listDecks();
  const rows = manifest.decks.map((deck) => {
    if (here.some((d) => d.id === deck.id)) return { deck, status: /** @type {'same'} */ ('same') };
    const twin = here.find((d) => d.kind === deck.kind &&
      (d.name.toLowerCase() === deck.name.toLowerCase() || (d.signature && d.signature === deck.signature) ||
       (d.starterId && d.starterId === deck.starterId)));
    return twin ? { deck, status: /** @type {'similar'} */ ('similar'), like: twin.name } : { deck, status: /** @type {'new'} */ ('new') };
  });
  return { manifest, files, rows };
}

/**
 * Restore chosen decks from a read backup. Decks that already exist by id are imported as
 * copies with new ids. Images are verified against their hashes; cards with a bad image are skipped.
 * @returns {Promise<{ decks: number, cards: number, skipped: string[] }>}
 */
export async function restoreBackup({ manifest, files }, chosenIds, onProgress = () => {}) {
  const here = new Set((await listDecks()).map((d) => d.id));
  const chosen = manifest.decks.filter((d) => chosenIds.includes(d.id));
  const neededDefs = new Set(chosen.flatMap((d) => [...d.cards, ...(d.commanders || [])]));
  const defs = manifest.defs.filter((d) => neededDefs.has(d.id));
  const d = await db();
  const skipped = [];
  const goodDefs = new Set();
  let n = 0;
  for (const def of defs) {
    let ok = true;
    for (const h of hashesOf(def)) {
      if (await d.getKey('images', h)) continue;
      const ext = manifest.images[h];
      const bytes = files[`images/${h}.${ext}`];
      if (!bytes || (await sha256(bytes)) !== h) { ok = false; break; }
      await d.put('images', { hash: h, blob: new Blob([bytes], { type: TYPE[ext] || 'application/octet-stream' }), type: TYPE[ext] });
    }
    if (ok) { await putDef(def); goodDefs.add(def.id); } else skipped.push(def.name);
    if (++n % 20 === 0) onProgress(`Restoring cards ${n} of ${defs.length}…`);
  }
  // New ids for decks that already exist here, so a copy never overwrites the original.
  const idMap = new Map();
  for (const deck of chosen) {
    idMap.set(deck.id, here.has(deck.id) ? `${deck.id}-copy-${Math.random().toString(36).slice(2, 7)}` : deck.id);
  }
  for (const deck of chosen) {
    const copy = here.has(deck.id);
    await putDeck({
      ...deck,
      id: idMap.get(deck.id),
      name: copy ? `${deck.name} (copy)` : deck.name,
      cards: deck.cards.filter((id) => goodDefs.has(id)),
      commanders: (deck.commanders || []).filter((id) => goodDefs.has(id)),
      forDecks: deck.forDecks ? deck.forDecks.map((id) => idMap.get(id) || id) : undefined,
      starterId: copy ? undefined : deck.starterId,
      builtin: false,
    });
  }
  return { decks: chosen.length, cards: goodDefs.size, skipped: [...new Set(skipped)] };
}

/** Ask the browser not to clear this app's storage under pressure. Safe to call repeatedly. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

/** Persistence status and usage, for display. */
export async function storageStatus() {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch { return { persisted: null, usage: null, quota: null }; }
}
