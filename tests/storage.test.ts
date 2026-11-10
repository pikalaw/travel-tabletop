import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Bytes } from '../src/storage/sha256';
import {
  closeDb, db, defIdFor, deleteGame, deleteGames, FINISHED_KEEP, gamePersistence, markOpened, tidyFinished, getDeck, getDef, getDefs, getGame, getImage, getMeta, isCardDef, isDeck,
  isGameRecord, isGameState, listDecks, listGames, loadLog, loadSnapshots, putDeck, putDef, putImage, setMeta, sha256,
} from '../src/storage/db';
import { artUrl, loadArt, sizeFor } from '../src/storage/art';
import type { CardDef, Deck, GameRecord, LogEntry } from '../src/types/storage';
import type { GameState } from '../src/types/state';

const records = JSON.parse(readFileSync(new URL('./fixtures/v1/records.json', import.meta.url), 'utf8')) as {
  decks: Deck[]; defs: CardDef[]; games: GameRecord[]; meta: { key: string; value: unknown }[];
};
const nodeHash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((res, rej) => { const r = indexedDB.deleteDatabase('mtg-tabletop'); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
});
afterEach(() => vi.restoreAllMocks());

describe('sha256', () => {
  it('the pure version matches Node for any input, including block edges', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31) & 255);
      expect(hex(sha256Bytes(b)), `length ${n}`).toBe(nodeHash(b));
    }
    fc.assert(fc.property(fc.uint8Array({ maxLength: 600 }), (b) => hex(sha256Bytes(b)) === nodeHash(b)), { numRuns: 200 });
  });
  it('sha256() gives the same hex with and without Web Crypto', async () => {
    const withSubtle = await sha256('Lightning Bolt|abc|');
    vi.spyOn(globalThis.crypto, 'subtle', 'get').mockReturnValue(undefined as unknown as SubtleCrypto);
    expect(await sha256('Lightning Bolt|abc|')).toBe(withSubtle);
    expect(withSubtle).toBe(createHash('sha256').update('Lightning Bolt|abc|').digest('hex'));
  });
  it('card ids are the first 20 hex digits of name|front|back', async () => {
    expect(await defIdFor('X', 'f', null)).toBe(createHash('sha256').update('X|f|').digest('hex').slice(0, 20));
  });
});

describe('records written by v1', () => {
  it('pass the type guards', () => {
    expect(records.decks.length).toBe(3);
    expect(records.decks.every(isDeck)).toBe(true);
    expect(records.defs.length).toBe(30);
    expect(records.defs.every(isCardDef)).toBe(true);
    expect(records.games.every(isGameRecord)).toBe(true);
  });
  it('read back through the database', async () => {
    const d = await db();
    for (const x of records.decks) await d.put('decks', x);
    for (const x of records.defs) await d.put('defs', x);
    for (const x of records.games) await d.put('games', x);
    for (const x of records.meta) await d.put('meta', x);
    expect((await listDecks()).map((x) => x.id)).toEqual(['sample-ember', 'sample-grove', 'builtin-tokens']);
    expect(await getDefs(records.defs.map((x) => x.id))).toHaveLength(30);
    expect((await getGame(records.games[0]!.id))?.state.gameId).toBe(records.games[0]!.id);
    expect(await getMeta('fixtures')).toBe(2);
  });
});

describe('the guards', () => {
  const state = records.games[0]!.state;
  it('reject damaged records, which reads then skip', async () => {
    expect(isGameState({ ...state, zones: {} })).toBe(false);
    expect(isGameState({ ...state, schemaVersion: 2 })).toBe(false);
    expect(isDeck({ id: 'x', name: 'n', kind: 'deck', cards: [1], createdAt: 0 })).toBe(false);
    expect(isCardDef({ id: 'x', name: 'n', front: 'f' })).toBe(false); // back must be present (null or a hash)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = await db();
    await d.put('decks', { id: 'bad', name: 'Bad', kind: 'deck', cards: 'nope', createdAt: 0 } as unknown as Deck);
    await d.put('decks', records.decks[0]!);
    expect((await listDecks()).map((x) => x.id)).toEqual([records.decks[0]!.id]);
    expect(await getDeck('bad')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('round trips', () => {
  it('images are stored once by content hash', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const h1 = await putImage(new Blob([bytes], { type: 'image/png' }));
    const h2 = await putImage(new Blob([bytes], { type: 'image/png' }));
    expect(h1).toBe(h2);
    expect(h1).toBe(nodeHash(bytes));
    expect((await getImage(h1))?.type).toBe('image/png');
  });
  it('defs and decks; decks sort before token decks', async () => {
    const def: CardDef = { id: 'd1', name: 'Bolt', front: 'f', back: null, sizes: { front: { small: 's', large: 'l' }, back: null } };
    await putDef(def);
    expect(await getDef('d1')).toEqual(def);
    await putDeck({ id: 't', name: 'A tokens', kind: 'token', cards: ['d1'], createdAt: 1 });
    await putDeck({ id: 'b', name: 'B', kind: 'deck', cards: ['d1', 'd1'], createdAt: 2 });
    await putDeck({ id: 'a', name: 'A', kind: 'deck', cards: ['d1'], createdAt: 3 });
    expect((await listDecks()).map((x) => x.id)).toEqual(['a', 'b', 't']);
    await setMeta('offlineNoticeShown', true);
    expect(await getMeta('offlineNoticeShown')).toBe(true);
  });
  it('host persistence writes state, snapshots and log in one go; deleting a game removes all three', async () => {
    const state = records.games[0]!.state as GameState;
    const p = gamePersistence({ mode: 'same-device', role: 'host', setup: {} });
    const entry = (seq: number): LogEntry => ({ gameId: state.gameId, seq, ts: 't', mode: 'same-device', turn: 1, kind: 'command', actor: 'p1', schemaVersion: 1 });
    await p.commit({ state, push: { key: 1, state }, drop: [], log: [entry(1)] });
    await p.commit({ state, push: { key: 2, state }, drop: [1], log: [entry(2), entry(3)] });
    expect((await loadSnapshots(state.gameId)).map((s) => s.key)).toEqual([2]);
    expect((await loadLog(state.gameId)).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect((await listGames()).map((g) => g.id)).toEqual([state.gameId]);
    expect((await getGame(state.gameId))?.over).toBe(!!state.result);
    await deleteGame(state.gameId);
    expect(await getGame(state.gameId)).toBeUndefined();
    expect(await loadSnapshots(state.gameId)).toEqual([]);
    expect(await loadLog(state.gameId)).toEqual([]);
  });
});

describe('art', () => {
  it('resolves every size, falling back to normal', async () => {
    const h = await putImage(new Blob([new Uint8Array([9])], { type: 'image/jpeg' }));
    const small = await putImage(new Blob([new Uint8Array([8])], { type: 'image/jpeg' }));
    await putDef({ id: 'one', name: 'One', front: h, back: null });
    await putDef({ id: 'two', name: 'Two', front: h, back: h, sizes: { front: { small, large: h }, back: { small, large: h } } });
    const art = await loadArt(['one', 'two']);
    const one = art.get('one')!, two = art.get('two')!;
    expect(one.sizes.front.small).toBe(one.front);
    expect(one.sizes.back).toBeNull();
    expect(two.sizes.front.small).not.toBe(two.front);
    expect(artUrl(two, 'back', 'small')).toBe(two.sizes.back!.small);
    expect(artUrl(one, 'back', 'large')).toBeNull();
  });
  it('picks a size from the drawn height', () => {
    expect(sizeFor(100, 2)).toBe('small');
    expect(sizeFor(300, 2)).toBe('normal');
    expect(sizeFor(400, 2)).toBe('large');
  });
});

describe('finished games', () => {
  const base = records.games[0]!.state as GameState;
  const state = (id: string, over: boolean): GameState => ({ ...structuredClone(base), gameId: id, result: over ? { winner: 'p1', reason: 'concede' } : null });
  async function save(id: string, over: boolean, openedAt: number, snaps = 0) {
    const p = gamePersistence({ mode: 'same-device', role: 'host', setup: {}, openedAt });
    const st = state(id, over);
    await p.commit({ state: st, drop: [], log: [] });
    for (let k = 1; k <= snaps; k++) await p.commit({ state: st, push: { key: k, state: st }, drop: [], log: [] });
  }
  it('lists games most recently opened first; opening one moves it up but keeps when it was played', async () => {
    await save('a', false, 1); await save('b', true, 3); await save('c', false, 2);
    expect((await listGames()).map((g) => g.id)).toEqual(['b', 'c', 'a']);
    const played = (await getGame('a'))!.updatedAt;
    await markOpened('a');
    expect((await listGames()).map((g) => g.id)).toEqual(['a', 'b', 'c']);
    expect((await getGame('a'))!.updatedAt).toBe(played);
  });
  it('tidying keeps the newest finished games and one undo snapshot each; games in progress are untouched', async () => {
    for (let i = 0; i < FINISHED_KEEP + 2; i++) await save(`f${i}`, true, 100 + i, 3);
    await save('live', false, 1, 3);
    await tidyFinished();
    const left = await listGames();
    expect(left.filter((g) => g.over)).toHaveLength(FINISHED_KEEP);
    expect(left.map((g) => g.id)).not.toContain('f0');
    expect(left.map((g) => g.id)).not.toContain('f1');
    expect((await loadSnapshots('f5')).map((s) => s.key)).toEqual([3]);
    expect((await loadSnapshots('f0'))).toEqual([]);
    expect((await loadSnapshots('live')).map((s) => s.key)).toEqual([1, 2, 3]);
    await deleteGames(left.filter((g) => g.over).map((g) => g.id));
    expect((await listGames()).map((g) => g.id)).toEqual(['live']);
  });
});
