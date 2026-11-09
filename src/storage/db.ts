// IndexedDB schema and helpers. One database holds card images (by content hash), card
// definitions, decks, saved games, undo snapshots and action logs.
//
// Records may have been written by an older build, so everything read back is checked by a
// type guard; a record that fails is skipped (and reported once on the console), never trusted.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { sha256Bytes } from './sha256';
import type { GameState } from '../types/state';
import type { CardDef, CardText, Deck, GameRecord, ImageRecord, LogEntry, MetaRecord, RulingsRecord, SnapshotRecord } from '../types/storage';

export const DB_NAME = 'mtg-tabletop';
/**
 * 1: the first release. 2: card definitions gain rules text, and rulings get their own store.
 * Version 1 cards are kept as they are; staleDecks names the decks to re-import.
 */
export const DB_VERSION = 2;

interface TabletopDB extends DBSchema {
  images: { key: string; value: ImageRecord };
  defs: { key: string; value: CardDef };
  decks: { key: string; value: Deck };
  games: { key: string; value: GameRecord };
  snapshots: { key: [string, number]; value: SnapshotRecord; indexes: { gameId: string } };
  logs: { key: [string, number]; value: LogEntry; indexes: { gameId: string } };
  meta: { key: string; value: MetaRecord };
  rulings: { key: string; value: RulingsRecord };
}

export type Database = IDBPDatabase<TabletopDB>;

let dbp: Promise<Database> | null = null;

export function db(): Promise<Database> {
  if (!dbp) {
    dbp = openDB<TabletopDB>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('images', { keyPath: 'hash' });
          d.createObjectStore('defs', { keyPath: 'id' });
          d.createObjectStore('decks', { keyPath: 'id' });
          d.createObjectStore('games', { keyPath: 'id' });
          const snaps = d.createObjectStore('snapshots', { keyPath: ['gameId', 'key'] });
          snaps.createIndex('gameId', 'gameId');
          const logs = d.createObjectStore('logs', { keyPath: ['gameId', 'seq'] });
          logs.createIndex('gameId', 'gameId');
          d.createObjectStore('meta', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          // Nothing is deleted: cards imported before version 2 have no rules text, and the app
          // names their decks at startup (staleDecks) so the user can delete and re-import them.
          d.createObjectStore('rulings', { keyPath: 'oracleId' });
        }
      },
    });
  }
  return dbp;
}

/** Close and forget the connection (tests, and before deleting the database). */
export async function closeDb(): Promise<void> {
  if (dbp) (await dbp).close();
  dbp = null;
}

// ---------- Type guards for records read back ----------

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const optional = <T>(x: unknown, guard: (y: unknown) => y is T): boolean => x === undefined || guard(x);
const isSizes = (x: unknown): boolean => isObj(x) && isStr(x.small) && isStr(x.large);

const isFace = (x: unknown): boolean => isObj(x) && isStr(x.name) && isStr(x.typeLine) && isStr(x.oracleText)
  && ['manaCost', 'power', 'toughness', 'loyalty', 'defense'].every((k) => optional(x[k], isStr));

export function isCardText(x: unknown): x is CardText {
  return isObj(x) && Array.isArray(x.faces) && x.faces.length > 0 && x.faces.every(isFace) && isObj(x.record)
    && optional(x.oracleId, isStr) && optional(x.layout, isStr);
}

export function isCardDef(x: unknown): x is CardDef {
  return isObj(x) && isStr(x.id) && isStr(x.name) && isStr(x.front) && (x.back === null || isStr(x.back))
    && optional(x.scryfallId, isStr)
    && (x.sizes === undefined || (isObj(x.sizes) && isSizes(x.sizes.front) && (x.sizes.back === null || isSizes(x.sizes.back))))
    && optional(x.text, isCardText);
}

/** Every image hash a card definition refers to. */
export function hashesOf(def: CardDef): string[] {
  return [def.front, def.back, def.sizes?.front.small, def.sizes?.front.large, def.sizes?.back?.small, def.sizes?.back?.large]
    .filter((h): h is string => !!h);
}

export function isRulingsRecord(x: unknown): x is RulingsRecord {
  return isObj(x) && isStr(x.oracleId) && isNum(x.fetchedAt) && Array.isArray(x.rulings)
    && x.rulings.every((r) => isObj(r) && isStr(r.source) && isStr(r.publishedAt) && isStr(r.comment));
}

export function isDeck(x: unknown): x is Deck {
  return isObj(x) && isStr(x.id) && isStr(x.name) && (x.kind === 'deck' || x.kind === 'token') && isStrArr(x.cards)
    && isNum(x.createdAt) && optional(x.builtin, (y): y is boolean => typeof y === 'boolean')
    && optional(x.starterId, isStr) && optional(x.forDecks, isStrArr) && optional(x.signature, isStr) && optional(x.commanders, isStrArr);
}

/** The shape of a saved game state: enough to render and resume; the engine checks the rest. */
export function isGameState(x: unknown): x is GameState {
  if (!isObj(x) || x.schemaVersion !== 1 || !isStr(x.gameId) || (x.mode !== 'networked' && x.mode !== 'same-device')) return false;
  if (!isNum(x.seq) || !isNum(x.turn) || (x.activePlayer !== 'p1' && x.activePlayer !== 'p2') || !isNum(x.nextId)) return false;
  if (!isObj(x.players) || !isObj(x.cards) || !isObj(x.zones)) return false;
  for (const p of ['p1', 'p2']) {
    const pl = x.players[p];
    if (!isObj(pl) || !isStr(pl.name) || !Array.isArray(pl.counters) || typeof pl.libraryTopFaceUp !== 'boolean') return false;
  }
  if (Object.keys(x.zones).length !== 15 || !Object.values(x.zones).every(isStrArr)) return false;
  return x.result === null || isObj(x.result);
}

export function isGameRecord(x: unknown): x is GameRecord {
  return isObj(x) && isStr(x.id) && (x.mode === 'networked' || x.mode === 'same-device') && x.role === 'host'
    && isObj(x.setup) && isGameState(x.state) && isNum(x.updatedAt) && typeof x.over === 'boolean';
}

export function isSnapshotRecord(x: unknown): x is SnapshotRecord {
  return isObj(x) && isStr(x.gameId) && isNum(x.key) && isGameState(x.state);
}

const LOG_KINDS = new Set(['command', 'notice', 'rejected', 'undo', 'snapshot']);
export function isLogEntry(x: unknown): x is LogEntry {
  return isObj(x) && isStr(x.gameId) && isNum(x.seq) && isStr(x.ts) && isNum(x.turn) && isStr(x.kind) && LOG_KINDS.has(x.kind)
    && isStr(x.actor) && isNum(x.schemaVersion);
}

const reported = new Set<string>();
function keep<T>(store: string, guard: (x: unknown) => x is T) {
  return (x: unknown): x is T => {
    if (guard(x)) return true;
    if (!reported.has(store)) { reported.add(store); console.warn(`Skipped a ${store} record this version cannot read.`); }
    return false;
  };
}

// ---------- Hashing ----------

const enc = new TextEncoder();

/** SHA-256 of bytes or a string, as lowercase hex. Uses Web Crypto when the page has it. */
export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const buf = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
    : sha256Bytes(bytes);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Content-derived card id, identical on every device that has the same images. */
export async function defIdFor(name: string, front: string, back: string | null): Promise<string> {
  return (await sha256(`${name}|${front}|${back || ''}`)).slice(0, 20);
}

// ---------- Images ----------

/** Store image bytes once; returns the content hash. */
export async function putImage(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = await sha256(bytes);
  const d = await db();
  if (!(await d.getKey('images', hash))) await d.put('images', { hash, blob, type: blob.type });
  return hash;
}

export async function getImage(hash: string): Promise<ImageRecord | undefined> {
  return (await db()).get('images', hash);
}

// ---------- Card definitions and decks ----------

export async function putDef(def: CardDef): Promise<void> { await (await db()).put('defs', def); }

export async function getDef(id: string): Promise<CardDef | undefined> {
  const d = await (await db()).get('defs', id);
  return keep('card', isCardDef)(d) ? d : undefined;
}

export async function getDefs(ids: readonly string[]): Promise<CardDef[]> {
  const tx = (await db()).transaction('defs');
  const out = await Promise.all([...new Set(ids)].map((id) => tx.store.get(id)));
  await tx.done;
  return out.filter(keep('card', isCardDef));
}

export async function putDeck(deck: Deck): Promise<void> { await (await db()).put('decks', deck); }

export async function putRulings(rec: RulingsRecord): Promise<void> { await (await db()).put('rulings', rec); }

/** A card's rulings by oracle id, or undefined if none were fetched. */
export async function getRulings(oracleId: string): Promise<RulingsRecord | undefined> {
  const r = await (await db()).get('rulings', oracleId);
  return isRulingsRecord(r) ? r : undefined;
}

/** Decks first, then token decks, each by name. */
export async function listDecks(): Promise<Deck[]> {
  const all = (await (await db()).getAll('decks')).filter(keep('deck', isDeck));
  return all.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'deck' ? -1 : 1));
}

/** Imported decks with a card saved before card text was kept (it came from Scryfall but has no text). */
export async function staleDecks(): Promise<Deck[]> {
  const stale = new Set<string>();
  for (const def of await (await db()).getAll('defs')) {
    if (isCardDef(def) && def.scryfallId && !def.text) stale.add(def.id);
  }
  if (!stale.size) return [];
  return (await listDecks()).filter((d) => d.cards.some((id) => stale.has(id)));
}

export async function getDeck(id: string): Promise<Deck | undefined> {
  const d = await (await db()).get('decks', id);
  return keep('deck', isDeck)(d) ? d : undefined;
}

export async function deleteDeck(id: string): Promise<void> {
  await deleteDecks([id]);
}

/** Delete decks in one step, then sweep the cards no deck or saved game still uses. */
export async function deleteDecks(ids: readonly string[]): Promise<void> {
  const tx = (await db()).transaction('decks', 'readwrite');
  for (const id of ids) void tx.store.delete(id);
  await tx.done;
  await sweep();
}

// ---------- Meta ----------

export async function getMeta(key: string): Promise<unknown> {
  return (await (await db()).get('meta', key))?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', { key, value });
}

// ---------- Saved games ----------

export async function saveGameRecord(rec: Omit<GameRecord, 'updatedAt'>): Promise<void> {
  await (await db()).put('games', { ...rec, updatedAt: Date.now() });
}

export async function getGame(id: string): Promise<GameRecord | undefined> {
  const g = await (await db()).get('games', id);
  return keep('game', isGameRecord)(g) ? g : undefined;
}

/** Most recently played first. */
export async function listGames(): Promise<GameRecord[]> {
  const all = (await (await db()).getAll('games')).filter(keep('game', isGameRecord));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteGame(id: string): Promise<void> {
  const tx = (await db()).transaction(['games', 'snapshots', 'logs'], 'readwrite');
  void tx.objectStore('games').delete(id);
  for (const store of ['snapshots', 'logs'] as const) {
    let cur = await tx.objectStore(store).index('gameId').openCursor(IDBKeyRange.only(id));
    while (cur) { void cur.delete(); cur = await cur.continue(); }
  }
  await tx.done;
  await sweep();
}

// ---------- Cleanup ----------
// A card is stored once and shared by every deck and saved game that uses it, so deleting a
// deck or a game cannot delete its cards directly. The sweep works out from scratch what is
// still used: cards in any deck, saved game or undo snapshot; the images and rulings of those
// cards. Everything else is deleted. Imports, restores and the sample decks store cards before
// the deck that uses them, so they run under holdSweep and any sweep waits until they finish.

export interface SweepResult { defs: number; images: number; rulings: number }

let holds = 0;
let pending = false;

/** Run work that stores cards before their deck; a sweep asked for meanwhile runs afterwards. */
export async function holdSweep<T>(work: () => Promise<T>): Promise<T> {
  holds++;
  try { return await work(); } finally {
    holds--;
    if (!holds && pending) { pending = false; void sweep().catch((e: unknown) => console.error('cleanup failed', e)); }
  }
}

/** Delete unused cards, images and rulings. Null when it was deferred or skipped. */
export async function sweep(): Promise<SweepResult | null> {
  if (holds) { pending = true; return null; }
  const tx = (await db()).transaction(['decks', 'games', 'snapshots', 'defs', 'images', 'rulings'], 'readwrite');
  const decks = await tx.objectStore('decks').getAll();
  const games = await tx.objectStore('games').getAll();
  const snaps = await tx.objectStore('snapshots').getAll();
  const defs = await tx.objectStore('defs').getAll();
  const used = new Set<string>();
  const readable = decks.every(isDeck) && games.every(isGameRecord) && snaps.every(isSnapshotRecord);
  if (readable) {
    for (const d of decks) for (const id of [...d.cards, ...(d.commanders || [])]) used.add(id);
    for (const s of [...games, ...snaps]) for (const c of Object.values(s.state.cards)) used.add(c.defId);
  }
  // A record this version cannot read might use any card or image: delete nothing.
  if (!readable || !defs.every((d) => !used.has(d.id) || isCardDef(d))) {
    console.warn('Cleanup skipped: a record this version cannot read.');
    tx.abort();
    await tx.done.catch(() => {});
    return null;
  }
  const images = new Set<string>(), oracles = new Set<string>();
  const out: SweepResult = { defs: 0, images: 0, rulings: 0 };
  for (const def of defs) {
    if (!used.has(def.id)) { void tx.objectStore('defs').delete(def.id); out.defs++; continue; }
    for (const h of hashesOf(def)) images.add(h);
    if (def.text?.oracleId) oracles.add(def.text.oracleId);
  }
  for (const h of await tx.objectStore('images').getAllKeys()) if (!images.has(h)) { void tx.objectStore('images').delete(h); out.images++; }
  for (const o of await tx.objectStore('rulings').getAllKeys()) if (!oracles.has(o)) { void tx.objectStore('rulings').delete(o); out.rulings++; }
  await tx.done;
  return out;
}

export async function loadSnapshots(gameId: string): Promise<{ key: number; state: GameState }[]> {
  const rows = (await (await db()).getAllFromIndex('snapshots', 'gameId', gameId)).filter(keep('snapshot', isSnapshotRecord));
  return rows.sort((a, b) => a.key - b.key).map((r) => ({ key: r.key, state: r.state }));
}

export async function loadLog(gameId: string): Promise<LogEntry[]> {
  const rows = (await (await db()).getAllFromIndex('logs', 'gameId', gameId)).filter(keep('log', isLogEntry));
  return rows.sort((a, b) => a.seq - b.seq);
}

/** What the host hands to persistence after each command. */
export interface Commit {
  state: GameState;
  push?: { key: number; state: GameState } | undefined;
  drop: number[];
  log: LogEntry[];
}

export interface Persistence {
  commit(c: Commit): Promise<void>;
}

/** Host persistence: one transaction per command (state, snapshot and log together). */
export function gamePersistence(meta: Pick<GameRecord, 'mode' | 'role' | 'setup'>): Persistence {
  return {
    async commit({ state, push, drop, log }) {
      const tx = (await db()).transaction(['games', 'snapshots', 'logs'], 'readwrite');
      void tx.objectStore('games').put({ ...meta, id: state.gameId, state, updatedAt: Date.now(), over: !!state.result });
      if (push) void tx.objectStore('snapshots').put({ gameId: state.gameId, key: push.key, state: push.state });
      for (const key of drop) void tx.objectStore('snapshots').delete([state.gameId, key]);
      for (const e of log) void tx.objectStore('logs').put(e);
      await tx.done;
    },
  };
}
