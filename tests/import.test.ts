// Deck import (parser, signature, Scryfall with a mocked fetch), the built-in sample cards,
// starter packs, and backups, including the backup file recorded from v1.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { parseDecklist, listSignature, importDeck } from '../src/storage/scryfall';
import { ensureFixtures } from '../src/storage/fixtures';
import { STARTER_PACKS } from '../src/storage/starters';
import { checkManifest, exportBackup, readBackup, restoreBackup } from '../src/storage/backup';
import { closeDb, getDefs, getImage, listDecks, putDeck, sha256 } from '../src/storage/db';
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
  it('starter packs: ten 20-card lists with set codes', () => {
    const [pack] = STARTER_PACKS;
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
