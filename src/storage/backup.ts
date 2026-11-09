// Deck backups: any number of decks, with their card definitions and every image size,
// in one zip file (.mtgdecks). Restoring checks each image against its hash and reports which
// decks are new, already on this device, or possible duplicates of decks already here.
//
// A backup file comes from outside the app, so its manifest passes a guard before use.

import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { db, sha256, listDecks, getDefs, putDef, putDeck, isCardDef, isDeck, isRulingsRecord, getRulings, putRulings, holdSweep, sweep, hashesOf } from './db';
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupManifest, type Deck, type RulingsRecord } from '../types/storage';

export { BACKUP_FORMAT, BACKUP_VERSION };

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
const TYPE: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

const NOT_A_BACKUP = 'That file is not a deck backup from this app.';

/** Token decks that belong with the chosen decks (not built-in ones: every device has those). */
export function companionTokenDecks(allDecks: readonly Deck[], deckIds: readonly string[]): Deck[] {
  const chosen = new Set(deckIds);
  return allDecks.filter((d) => d.kind === 'token' && !d.builtin && !chosen.has(d.id) && (d.forDecks || []).some((id) => chosen.has(id)));
}

/** Build a backup of `deckIds` (their token decks are added automatically). */
export async function exportBackup(deckIds: readonly string[], onProgress: (text: string) => void = () => {}, now: Date = new Date()):
  Promise<{ blob: Blob; decks: number; cards: number; images: number }> {
  const all = await listDecks();
  const decks = [...all.filter((d) => deckIds.includes(d.id)), ...companionTokenDecks(all, deckIds)];
  const defIds = [...new Set(decks.flatMap((d) => [...d.cards, ...(d.commanders || [])]))];
  const defs = await getDefs(defIds);
  const hashes = [...new Set(defs.flatMap(hashesOf))];
  const files: Zippable = {};
  const images: Record<string, string> = {};
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
  // Rulings, so a device restoring without internet has them too.
  const rulings: RulingsRecord[] = [];
  for (const oracleId of new Set(defs.map((x) => x.text?.oracleId).filter((x): x is string => !!x))) {
    const rec = await getRulings(oracleId);
    if (rec) rulings.push(rec);
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(),
    decks, defs, images, rulings,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const zip = zipSync(files);
  return { blob: new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), decks: decks.length, cards: defs.length, images: Object.keys(images).length };
}

/**
 * How a deck in a backup relates to this device: `new`; `same` id (restoring updates it from the
 * file); `builtin` here (never touched); or `similar` (same name, cards or starter deck under
 * another id, which may be a different deck).
 */
export type BackupRowStatus = 'new' | 'same' | 'builtin' | 'similar';
export interface BackupRow { deck: Deck; status: BackupRowStatus; like?: string }
export interface ReadBackup { manifest: BackupManifest; files: Record<string, Uint8Array>; rows: BackupRow[] }

/** Check a parsed manifest. Throws a user-facing message if it is not one this version can restore. */
export function checkManifest(x: unknown): BackupManifest {
  const m = x as Partial<Record<keyof BackupManifest, unknown>> | null;
  if (typeof m !== 'object' || m === null || m.format !== BACKUP_FORMAT) throw new Error(NOT_A_BACKUP);
  if (typeof m.version !== 'number' || m.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  const images = m.images;
  if (!Array.isArray(m.decks) || !Array.isArray(m.defs) || typeof images !== 'object' || images === null
    || !m.decks.every(isDeck) || !m.defs.every(isCardDef) || !Object.values(images).every((e) => typeof e === 'string')
    || (m.rulings !== undefined && !(Array.isArray(m.rulings) && m.rulings.every(isRulingsRecord)))) {
    throw new Error('The backup file is damaged.');
  }
  return m as BackupManifest;
}

/** Read a backup file and compare its decks with this device. */
export async function readBackup(file: Blob): Promise<ReadBackup> {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(await file.arrayBuffer())); }
  catch { throw new Error(NOT_A_BACKUP); }
  const raw = files['manifest.json'];
  if (!raw) throw new Error(NOT_A_BACKUP);
  let parsed: unknown;
  try { parsed = JSON.parse(strFromU8(raw)); } catch { throw new Error(NOT_A_BACKUP); }
  const manifest = checkManifest(parsed);
  const here = await listDecks();
  const rows = manifest.decks.map((deck): BackupRow => {
    const mine = here.find((d) => d.id === deck.id);
    if (mine) return { deck, status: mine.builtin ? 'builtin' : 'same' };
    const twin = here.find((d) => d.kind === deck.kind &&
      (d.name.toLowerCase() === deck.name.toLowerCase() || (d.signature && d.signature === deck.signature) ||
       (d.starterId && d.starterId === deck.starterId)));
    return twin ? { deck, status: 'similar', like: twin.name } : { deck, status: 'new' };
  });
  return { manifest, files, rows };
}

/**
 * Restore chosen decks from a read backup. A deck that already exists by id is replaced by the
 * file's (its name, cards, rules text and images); a token deck is merged instead, since one token
 * deck serves many decks and this device may have decks the file lacks. Built-in decks here are
 * never touched. Images are verified against their hashes; cards with a bad image are skipped.
 * Cards are stored before their decks, so the cleanup sweep waits until the restore is done.
 */
export const restoreBackup = (...a: Parameters<typeof restoreChosen>) =>
  holdSweep(async () => { try { return await restoreChosen(...a); } finally { void sweep(); } });

async function restoreChosen({ manifest, files }: Pick<ReadBackup, 'manifest' | 'files'>, chosenIds: readonly string[], onProgress: (text: string) => void = () => {}):
  Promise<{ decks: number; updated: number; cards: number; skipped: string[] }> {
  const here = new Map((await listDecks()).map((d) => [d.id, d]));
  const chosen = manifest.decks.filter((d) => chosenIds.includes(d.id) && !here.get(d.id)?.builtin);
  const neededDefs = new Set(chosen.flatMap((d) => [...d.cards, ...(d.commanders || [])]));
  const defs = manifest.defs.filter((d) => neededDefs.has(d.id));
  const d = await db();
  const skipped: string[] = [];
  const goodDefs = new Set<string>();
  let n = 0;
  for (const def of defs) {
    let ok = true;
    for (const h of hashesOf(def)) {
      if (await d.getKey('images', h)) continue;
      const ext = manifest.images[h] || '';
      const bytes = files[`images/${h}.${ext}`];
      if (!bytes || (await sha256(bytes)) !== h) { ok = false; break; }
      const type = TYPE[ext] || 'application/octet-stream';
      await d.put('images', { hash: h, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), type });
    }
    if (ok) { await putDef(def); goodDefs.add(def.id); } else skipped.push(def.name);
    if (++n % 20 === 0) onProgress(`Restoring cards ${n} of ${defs.length}…`);
  }
  // The restored cards' rulings, unless this device already has a copy fetched as recently.
  const oracles = new Set(manifest.defs.filter((x) => goodDefs.has(x.id)).map((x) => x.text?.oracleId).filter(Boolean));
  for (const rec of manifest.rulings || []) {
    if (!oracles.has(rec.oracleId)) continue;
    const mine = await getRulings(rec.oracleId);
    if (!mine || mine.fetchedAt < rec.fetchedAt) await putRulings(rec);
  }
  let updated = 0;
  for (const deck of chosen) {
    const mine = here.get(deck.id);
    const out: Deck = {
      ...deck,
      cards: deck.cards.filter((id) => goodDefs.has(id)),
      commanders: (deck.commanders || []).filter((id) => goodDefs.has(id)),
      builtin: false,
    };
    if (mine?.kind === 'token' && deck.kind === 'token') {
      out.cards = [...new Set([...mine.cards, ...out.cards])];
      out.forDecks = [...new Set([...(mine.forDecks || []), ...(deck.forDecks || [])])];
    }
    if (mine) updated++;
    await putDeck(out);
  }
  return { decks: chosen.length, updated, cards: goodDefs.size, skipped: [...new Set(skipped)] };
}

/** Ask the browser not to clear this app's storage under pressure. Safe to call repeatedly. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

/** Persistence status and usage, for display. */
export async function storageStatus(): Promise<{ persisted: boolean | null; usage: number | null; quota: number | null }> {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch { return { persisted: null, usage: null, quota: null }; }
}
