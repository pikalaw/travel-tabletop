// Deck import (parser, signature, Scryfall with a mocked fetch), the built-in sample cards,
// starter packs, and backups, including the backup file recorded from v1.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { parseDecklist, listSignature, importDeck, importCache, textOf } from '../src/storage/scryfall';
import { ensureFixtures } from '../src/storage/fixtures';
import { STARTER_PACKS } from '../src/storage/starters';
import { checkManifest, exportBackup, readBackup, restoreBackup } from '../src/storage/backup';
import { closeDb, db, deleteDeck, deleteGame, getDefs, getImage, getRulings, holdSweep, listDecks, putDeck, sha256, staleDecks, sweep } from '../src/storage/db';
import { emptyState } from '../src/engine/engine';
import type { CardDef, Deck } from '../src/types/storage';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/v1/${f}`, import.meta.url));
const records = JSON.parse(fixture('records.json').toString()) as { decks: Deck[]; defs: CardDef[] };

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('mtg-tabletop'); r.onsuccess = () => res(); });
});
afterEach(() => vi.unstubAllGlobals());

describe('decklist parser', () => {
  it('reads common export formats and sections', () => {
    const { entries } = parseDecklist(`Deck
4 Lightning Bolt
4x Counterspell
1 Delver of Secrets (ISD) 51
1 Sol Ring *F*
Sideboard
2 Duress

Commander
1 Krenko, Mob Boss`);
    expect(entries.map((e) => [e.count, e.name, e.section])).toEqual([
      [4, 'Lightning Bolt', 'main'],
      [4, 'Counterspell', 'main'],
      [1, 'Delver of Secrets', 'main'],
      [1, 'Sol Ring', 'main'],
      [2, 'Duress', 'sideboard'],
      [1, 'Krenko, Mob Boss', 'commander'],
    ]);
    expect(entries[2]).toMatchObject({ set: 'isd', number: '51' });
  });
});

describe('list signature', () => {
  it('ignores order, case, printings and split counts', () => {
    const a = listSignature('4 Lightning Bolt\n2 Mountain (DSK) 280\n1 Sol Ring');
    const b = listSignature('1 sol ring\n2 Mountain\n2 Lightning Bolt\n2x Lightning Bolt');
    expect(a).toBe(b);
    expect(listSignature('3 Lightning Bolt')).not.toBe(listSignature('4 Lightning Bolt'));
    expect(listSignature('Sideboard\n4 Duress')).toBe('');
  });
});

describe('sample cards', () => {
  it('are drawn exactly as v1 drew them: the same card ids', async () => {
    expect(await ensureFixtures()).toBe(true);
    expect(await ensureFixtures()).toBe(false);
    const decks = await listDecks();
    expect(decks.map((d) => d.id).sort()).toEqual(records.decks.map((d) => d.id).sort());
    for (const d of records.decks) expect(decks.find((x) => x.id === d.id)?.cards).toEqual(d.cards);
    const defs = await getDefs(records.defs.map((d) => d.id));
    expect(defs.map((d) => d.id).sort()).toEqual(records.defs.map((d) => d.id).sort());
  });
  it('Jumpstart: 66 lists of 20 cards over 46 themes, ids unique, basics from the Avatar set', () => {
    const js = STARTER_PACKS.find((p) => p.id === 'tla-jumpstart')!;
    expect(js.pick).toBe(true);
    expect(js.decks).toHaveLength(66);
    expect(new Set(js.decks.map((d) => d.starterId)).size).toBe(66);
    expect(new Set(js.decks.map((d) => d.short!.replace(/ \(\d\)$/, ''))).size).toBe(46);
    for (const d of js.decks) {
      const { entries, errors } = parseDecklist(d.text);
      expect(errors, d.name).toEqual([]);
      expect(entries.reduce((n, e) => n + e.count, 0), d.name).toBe(20);
      for (const e of entries) if (['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(e.name)) expect(e.set, d.name).toBe('tla');
    }
    expect(js.decks.find((d) => d.short === 'Hei Bai (2)')?.group).toBe('White');
  });

  it('starter packs: ten 20-card lists with set codes', () => {
    const pack = STARTER_PACKS.find((p) => p.id === 'tla-beginner-box');
    expect(pack!.decks).toHaveLength(10);
    for (const d of pack!.decks) {
      const n = parseDecklist(d.text).entries.reduce((s, e) => s + e.count, 0);
      expect(n, d.name).toBe(20);
      expect(parseDecklist(d.text).entries.every((e) => e.set === 'tla')).toBe(true);
    }
  });
});

describe('import from Scryfall (mocked)', () => {
  it('stores three sizes per face, double faces, the deck and its tokens', async () => {
    const img = (id: string, s: string) => `https://cards.scryfall.io/${s}/front/${id}.jpg`;
    const uris = (id: string) => ({ small: img(id, 'small'), normal: img(id, 'normal'), large: img(id, 'large') });
    const cards: Record<string, unknown> = {
      'lightning bolt': { id: 'bolt', name: 'Lightning Bolt', set: 'tst', collector_number: '1', image_uris: uris('bolt'), all_parts: [{ id: 'bolt', component: 'combo_piece' }, { id: 'gob', component: 'token' }] },
      'delver of secrets': { id: 'delver', name: 'Delver of Secrets // Insectile Aberration', card_faces: [{ name: 'Delver of Secrets', image_uris: uris('dlv-f') }, { name: 'Insectile Aberration', image_uris: uris('dlv-b') }] },
    };
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      fetched.push(url);
      if (url.endsWith('/cards/collection')) {
        const ids = (JSON.parse(String(init?.body)) as { identifiers: { name?: string; id?: string }[] }).identifiers;
        const data = ids.map((x) => (x.id === 'gob' ? { id: 'gob', name: 'Goblin', image_uris: uris('gob') } : cards[x.name!.toLowerCase()])).filter(Boolean);
        return new Response(JSON.stringify({ data: [...data, { junk: true }] }));
      }
      if (url.includes('/cards/named')) return new Response('{}', { status: 404 });
      return new Response(new Blob([url], { type: 'image/jpeg' }));
    }));
    const res = await importDeck({ name: 'Test', text: '4 Lightning Bolt\n2 Delver of Secrets\n1 Nonexistent Card' });
    expect(res).toMatchObject({ cards: 6, tokens: 1, missing: ['1 Nonexistent Card'] });
    const decks = await listDecks();
    const deck = decks.find((d) => d.id === res.deckId)!;
    expect(deck.cards).toHaveLength(6);
    expect(deck.signature).toBe(listSignature('4 Lightning Bolt\n2 Delver of Secrets\n1 Nonexistent Card'));
    const tokenDeck = decks.find((d) => d.id === res.tokenDeckId)!;
    expect(tokenDeck).toMatchObject({ kind: 'token', name: 'Test · tokens', forDecks: [res.deckId] });
    const [bolt, delver] = await getDefs([deck.cards[0]!, deck.cards[4]!]);
    expect(bolt!.sizes?.back).toBeNull();
    expect(delver!.back).not.toBeNull();
    expect(delver!.sizes?.back?.large).toBeTruthy();
    for (const h of [bolt!.front, bolt!.sizes!.front.small, bolt!.sizes!.front.large]) expect(await getImage(h)).toBeTruthy();
    expect(fetched.filter((u) => u.includes('cards.scryfall.io'))).toHaveLength(12); // 3 sizes × (bolt, 2 delver faces, goblin)
  });
});

describe('card text and rulings (mocked Scryfall)', () => {
  const img = (id: string, sz: string) => `https://cards.scryfall.io/${sz}/front/${id}.jpg`;
  const uris = (id: string) => ({ small: img(id, 'small'), normal: img(id, 'normal'), large: img(id, 'large') });
  const sages = {
    id: 'sages', oracle_id: 'o-sages', name: 'Fire Sages', set: 'tla', collector_number: '136', layout: 'normal',
    type_line: 'Creature — Human Cleric', mana_cost: '{1}{R}', power: '2', toughness: '2',
    oracle_text: 'Firebending 1 (Whenever this creature attacks, add {R}.)\n{1}{R}{R}: Put a +1/+1 counter on this creature.',
    keywords: ['Firebending'], rarity: 'uncommon', prices: { usd: '0.10' }, purchase_uris: { x: 'y' }, image_uris: uris('sages'),
  };
  const mountain = { id: 'mtn', oracle_id: 'o-mtn', name: 'Mountain', set: 'tla', collector_number: '290', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)', image_uris: uris('mtn') };
  const dfc = {
    id: 'dfc', oracle_id: 'o-dfc', name: 'Front // Back', set: 'tla', collector_number: '1', layout: 'transform',
    card_faces: [
      { name: 'Front', type_line: 'Creature — Human', oracle_text: 'At the beginning of your upkeep, transform this.', power: '1', toughness: '1', image_uris: uris('dfc-f') },
      { name: 'Back', type_line: 'Creature — Wolf', oracle_text: 'Trample', power: '3', toughness: '3', image_uris: uris('dfc-b') },
    ],
  };
  const byName: Record<string, unknown> = { 'fire sages': sages, mountain, front: dfc };

  function stubScryfall() {
    const calls = { collection: [] as string[][], rulings: [] as string[] };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/cards/collection')) {
        const ids = (JSON.parse(String(init?.body)) as { identifiers: { name?: string }[] }).identifiers;
        calls.collection.push(ids.map((x) => x.name || '?'));
        return new Response(JSON.stringify({ data: ids.map((x) => byName[(x.name || '').toLowerCase()]).filter(Boolean) }));
      }
      if (url.includes('/rulings')) {
        calls.rulings.push(url);
        return new Response(JSON.stringify({ object: 'list', data: [{ object: 'ruling', oracle_id: 'o-sages', source: 'wotc', published_at: '2025-11-14', comment: 'You may activate the ability any number of times.' }] }));
      }
      return new Response(new Blob([url], { type: 'image/jpeg' }));
    }));
    return calls;
  }

  it('keeps the typed text per face and the record without prices or links', () => {
    const t = textOf(sages);
    expect(t).toMatchObject({ oracleId: 'o-sages', layout: 'normal', faces: [{ name: 'Fire Sages', typeLine: 'Creature — Human Cleric', manaCost: '{1}{R}', power: '2', toughness: '2' }] });
    expect(t.faces[0]!.oracleText.split('\n')).toHaveLength(2);
    expect(t.record).toMatchObject({ keywords: ['Firebending'], rarity: 'uncommon', collector_number: '136' });
    for (const k of ['prices', 'purchase_uris', 'image_uris']) expect(t.record).not.toHaveProperty(k);
    expect(textOf(dfc).faces.map((f) => [f.name, f.typeLine, f.oracleText, f.power])).toEqual([
      ['Front', 'Creature — Human', 'At the beginning of your upkeep, transform this.', '1'], ['Back', 'Creature — Wolf', 'Trample', '3']]);
  });

  it('stores text on each card, rulings once per card (none for basic lands), and shares lookups across a batch', async () => {
    const calls = stubScryfall();
    const cache = importCache();
    const a = await importDeck({ name: 'A', text: '4 Fire Sages\n10 Mountain', cache });
    const b = await importDeck({ name: 'B', text: '2 Fire Sages\n2 Front\n8 Mountain', cache });
    // the second deck looked up only the name the first had not
    expect(calls.collection).toEqual([['Fire Sages', 'Mountain'], ['Front']]);
    // rulings: Fire Sages and Front once each, Mountain never
    expect(calls.rulings.map((u) => u.replace('https://api.scryfall.com', ''))).toEqual(['/cards/tla/136/rulings', '/cards/tla/1/rulings']);
    expect((await getRulings('o-sages'))?.rulings).toEqual([{ source: 'wotc', publishedAt: '2025-11-14', comment: 'You may activate the ability any number of times.' }]);
    expect(await getRulings('o-mtn')).toBeUndefined();
    const decks = await listDecks();
    const [sagesDef] = await getDefs([decks.find((d) => d.id === a.deckId)!.cards[0]!]);
    expect(sagesDef!.text?.faces[0]?.typeLine).toBe('Creature — Human Cleric');
    expect(b.cards).toBe(12);
    // a later import (a new batch) finds the rulings on the device and asks again for nothing
    await importDeck({ name: 'C', text: '1 Fire Sages' });
    expect(calls.rulings).toHaveLength(2);
  });

  it('a failed rulings request does not fail the import', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/cards/collection')) {
        const ids = (JSON.parse(String(init?.body)) as { identifiers: { name?: string }[] }).identifiers;
        return new Response(JSON.stringify({ data: ids.map((x) => byName[(x.name || '').toLowerCase()]).filter(Boolean) }));
      }
      if (url.includes('/rulings')) return new Response('down', { status: 500 });
      return new Response(new Blob([url], { type: 'image/jpeg' }));
    }));
    const r = await importDeck({ name: 'A', text: '4 Fire Sages' });
    expect(r).toMatchObject({ cards: 4, missing: [] });
    expect(await getRulings('o-sages')).toBeUndefined();
  });

  it('upgrading from version 1 keeps everything, and names the decks with cards that lack text', async () => {
    await closeDb();
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('mtg-tabletop'); r.onsuccess = () => res(); });
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open('mtg-tabletop', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const [n, key] of [['images', 'hash'], ['defs', 'id'], ['decks', 'id'], ['games', 'id'], ['meta', 'key']] as const) d.createObjectStore(n, { keyPath: key });
        d.createObjectStore('snapshots', { keyPath: ['gameId', 'key'] }).createIndex('gameId', 'gameId');
        d.createObjectStore('logs', { keyPath: ['gameId', 'seq'] }).createIndex('gameId', 'gameId');
      };
      r.onsuccess = () => {
        const tx = r.result.transaction(['defs', 'decks', 'games', 'meta'], 'readwrite');
        tx.objectStore('defs').put({ id: 'x', name: 'X', front: 'h', back: null, scryfallId: 's-x' });
        tx.objectStore('defs').put({ id: 'y', name: 'Y', front: 'h', back: null });
        tx.objectStore('decks').put({ id: 'd', name: 'D', kind: 'deck', cards: ['x', 'y'], createdAt: 1 });
        tx.objectStore('decks').put({ id: 'e', name: 'E', kind: 'deck', cards: ['y'], createdAt: 1 });
        tx.objectStore('games').put({ id: 'g1' });
        tx.objectStore('meta').put({ key: 'fixtures', value: 1 });
        tx.oncomplete = () => { r.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
    });
    const d = await db();
    expect(await d.count('defs')).toBe(2);
    expect(await d.count('decks')).toBe(2);
    expect(await d.get('meta', 'fixtures')).toEqual({ key: 'fixtures', value: 1 });
    // only D has a Scryfall card without text; E's card is not from Scryfall
    expect((await staleDecks()).map((x) => x.id)).toEqual(['d']);
    expect(await d.count('games')).toBe(1);
    expect(d.objectStoreNames.contains('rulings')).toBe(true);
  });
});

describe('backups', () => {
  it('the v1 backup reads and restores: decks, cards and every image', async () => {
    const file = new Blob([fixture('sample-decks.mtgdecks')]);
    const read = await readBackup(file);
    expect(read.rows.map((r) => [r.deck.id, r.status])).toEqual([['sample-ember', 'new'], ['sample-grove', 'new'], ['builtin-tokens', 'new']]);
    const res = await restoreBackup(read, read.rows.map((r) => r.deck.id));
    expect(res).toEqual({ decks: 3, cards: 30, skipped: [] });
    const defs = await getDefs(records.defs.map((d) => d.id));
    expect(defs).toHaveLength(30);
    for (const d of defs) expect(await getImage(d.front)).toBeTruthy();
    // restoring again reports them as already here, and a copy gets a new id
    const again = await readBackup(file);
    expect(again.rows.every((r) => r.status === 'same')).toBe(true);
    await restoreBackup(again, ['sample-ember']);
    expect((await listDecks()).filter((d) => d.name === 'Sample: Ember (red) (copy)')).toHaveLength(1);
  });

  it('an exported backup restores on a fresh device', async () => {
    await ensureFixtures();
    await putDeck({ id: 'grove-tokens', name: 'Grove tokens', kind: 'token', cards: [records.decks[2]!.cards[0]!], forDecks: ['sample-grove'], createdAt: 1 });
    const out = await exportBackup(['sample-grove']);
    expect(out).toMatchObject({ decks: 2 }); // its token deck comes along
    const files = unzipSync(new Uint8Array(await out.blob.arrayBuffer()));
    expect(Object.keys(files)).toContain('manifest.json');
    await closeDb();
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('mtg-tabletop'); r.onsuccess = () => res(); });
    const read = await readBackup(out.blob);
    expect(read.rows.map((r) => r.deck.id)).toEqual(['sample-grove', 'grove-tokens']);
    const res = await restoreBackup(read, read.rows.map((r) => r.deck.id));
    expect(res.skipped).toEqual([]);
    expect((await listDecks()).map((d) => d.id)).toEqual(['sample-grove', 'grove-tokens']);
  });

  it('carries each card\'s rulings, so a device restoring without internet has them', async () => {
    const image = await sha256('img');
    const d = await db();
    await d.put('images', { hash: image, blob: new Blob(['img'], { type: 'image/png' }), type: 'image/png' });
    const text = { oracleId: 'o-elf', faces: [{ name: 'Elf', typeLine: 'Creature', oracleText: '{T}: Add {G}.' }], record: {} };
    await d.put('defs', { id: 'elf', name: 'Elf', front: image, back: null, scryfallId: 's-elf', text });
    await putDeck({ id: 'elves', name: 'Elves', kind: 'deck', cards: ['elf'], createdAt: 1 });
    const rulings = { oracleId: 'o-elf', rulings: [{ source: 'wotc', publishedAt: '2024-11-08', comment: 'It is a mana ability.' }], fetchedAt: 5 };
    await d.put('rulings', rulings);
    const out = await exportBackup(['elves']);
    // a fresh device
    await closeDb();
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase('mtg-tabletop'); r.onsuccess = () => res(); });
    const read = await readBackup(out.blob);
    expect(read.manifest.rulings).toEqual([rulings]);
    await restoreBackup(read, ['elves']);
    expect(await getRulings('o-elf')).toEqual(rulings);
    // a malformed rulings list marks the file damaged
    expect(() => checkManifest({ ...read.manifest, rulings: [{ oracleId: 1 }] })).toThrow('damaged');
  });

  it('refuses files that are not backups, newer backups and damaged images', async () => {
    await expect(readBackup(new Blob(['not a zip']))).rejects.toThrow('not a deck backup');
    const zip = (m: unknown, extra: Record<string, Uint8Array> = {}) => new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(m)), ...extra })]);
    await expect(readBackup(zip({ format: 'other' }))).rejects.toThrow('not a deck backup');
    await expect(readBackup(zip({ format: 'travel-tabletop-decks', version: 2 }))).rejects.toThrow('newer version');
    expect(() => checkManifest({ format: 'travel-tabletop-decks', version: 1, decks: [{ id: 1 }], defs: [], images: {} })).toThrow('damaged');
    const bytes = strToU8('image');
    const h = await sha256(strToU8('different'));
    const def: CardDef = { id: 'd', name: 'Bad Image', front: h, back: null };
    const read = await readBackup(zip({ format: 'travel-tabletop-decks', version: 1, exportedAt: '', decks: [{ id: 'k', name: 'K', kind: 'deck', cards: ['d'], createdAt: 0 }], defs: [def], images: { [h]: 'jpg' } }, { [`images/${h}.jpg`]: bytes }));
    expect(await restoreBackup(read, ['k'])).toEqual({ decks: 1, cards: 0, skipped: ['Bad Image'] });
  });
});

describe('cleanup sweep', () => {
  const def = (id: string, front: string, oracleId?: string): CardDef =>
    ({ id, name: id, front, back: null, ...(oracleId ? { text: { oracleId, faces: [{ name: id, typeLine: 'Instant', oracleText: '' }], record: {} } } : {}) });
  const deck = (id: string, cards: string[]): Deck => ({ id, name: id, kind: 'deck', cards, createdAt: 1 });
  const stateWith = (gameId: string, defIds: string[]) => {
    const s = emptyState();
    s.gameId = gameId;
    for (const [i, defId] of defIds.entries()) (s.cards as Record<string, unknown>)[`c${i}`] = { id: `c${i}`, defId, name: defId };
    return s;
  };
  async function seed() {
    const d = await db();
    for (const x of [def('a', 'ia', 'oa'), def('shared', 'is', 'os'), def('b', 'ib', 'ob'), def('g', 'ig'), def('snap', 'isnap'), def('orphan', 'io', 'oo')]) await d.put('defs', x);
    for (const h of ['ia', 'is', 'ib', 'ig', 'isnap', 'io', 'loose']) await d.put('images', { hash: h, blob: new Blob(['x']), type: 'image/png' });
    for (const o of ['oa', 'os', 'ob', 'oo']) await d.put('rulings', { oracleId: o, rulings: [], fetchedAt: 1 });
    await putDeck(deck('A', ['a', 'shared']));
    await putDeck(deck('B', ['b', 'shared']));
    await d.put('games', { id: 'G', mode: 'same-device', role: 'host', setup: {}, state: stateWith('G', ['g']), updatedAt: 1, over: false });
    await d.put('snapshots', { gameId: 'G', key: 1, state: stateWith('G', ['g', 'snap']) });
  }
  const keys = async () => {
    const d = await db();
    return { defs: (await d.getAllKeys('defs')).sort(), images: (await d.getAllKeys('images')).sort(), rulings: (await d.getAllKeys('rulings')).sort() };
  };

  it('keeps what a deck, a saved game or an undo snapshot uses, and deletes the rest', async () => {
    await seed();
    expect(await sweep()).toEqual({ defs: 1, images: 2, rulings: 1 });
    expect(await keys()).toEqual({
      defs: ['a', 'b', 'g', 'shared', 'snap'], images: ['ia', 'ib', 'ig', 'is', 'isnap'], rulings: ['oa', 'ob', 'os'],
    });
    // deleting a deck sweeps: its own card goes, the shared one stays
    await deleteDeck('A');
    expect(await keys()).toEqual({ defs: ['b', 'g', 'shared', 'snap'], images: ['ib', 'ig', 'is', 'isnap'], rulings: ['ob', 'os'] });
    // deleting the game drops its cards, including the one only its undo history used
    await deleteGame('G');
    expect(await keys()).toEqual({ defs: ['b', 'shared'], images: ['ib', 'is'], rulings: ['ob', 'os'] });
  });

  it('waits while cards are being stored before their deck', async () => {
    await seed();
    let release!: () => void;
    const held = holdSweep(async () => {
      await (await db()).put('defs', def('incoming', 'ia'));
      await new Promise<void>((r) => { release = r; });
      await putDeck(deck('C', ['incoming']));
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await sweep()).toBeNull();
    expect((await keys()).defs).toContain('incoming');
    release();
    await held;
    // the deferred sweep runs once the hold ends: the orphan goes, the new deck's card stays
    await vi.waitFor(async () => expect((await keys()).defs).not.toContain('orphan'));
    expect((await keys()).defs).toContain('incoming');
  });

  it('deletes nothing when a record cannot be read', async () => {
    await seed();
    await (await db()).put('games', { id: 'broken' } as never);
    expect(await sweep()).toBeNull();
    expect((await keys()).defs).toContain('orphan');
  });
});
