// Deck import: parse a pasted decklist, resolve cards through Scryfall, download images,
// and store definitions and the deck locally. Needs internet; everything else in the app does not.
// Scryfall asks for 50–100 ms between API requests; image downloads are from *.scryfall.io,
// which has no such limit, but we still keep concurrency modest.
//
// Scryfall's responses are checked by type guards before use: a card without a usable shape is
// treated as not found.

import { putImage, putDef, putDeck, defIdFor, db, getRulings, putRulings, holdSweep, sweep } from './db';
import type { CardText, Deck, FaceText, Ruling } from '../types/storage';

const API = 'https://api.scryfall.com';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Section = 'main' | 'commander' | 'sideboard' | 'maybeboard' | 'considering' | 'companion' | 'tokens' | 'about';

export interface DeckEntry {
  count: number;
  name: string;
  set?: string;
  number?: string;
  section: Section;
  line: string;
}

/**
 * Parse common decklist formats (Arena, MTGO, Moxfield exports).
 * Lines: "4 Lightning Bolt", "4x Lightning Bolt", "1 Delver of Secrets (ISD) 51", "1 Sol Ring *F*".
 * Section headers "Commander", "Deck", "Sideboard", "Maybeboard", "Companion" are recognised.
 */
export function parseDecklist(text: string): { entries: DeckEntry[]; errors: string[] } {
  const entries: DeckEntry[] = [];
  const errors: string[] = [];
  let section: Section = 'main';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const header = line.replace(/:$/, '').toLowerCase();
    if (['commander', 'commanders'].includes(header)) { section = 'commander'; continue; }
    if (['deck', 'main', 'mainboard', 'main deck'].includes(header)) { section = 'main'; continue; }
    if (['sideboard', 'maybeboard', 'considering', 'companion', 'tokens', 'about'].includes(header)) { section = header as Section; continue; }
    if (/^name\s/i.test(line)) continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9\-★†]+))?)?(?:\s+\*[A-Za-z]+\*)*\s*$/);
    if (!m) {
      // A bare card name counts as one copy.
      if (/^[A-Za-z]/.test(line)) entries.push({ count: 1, name: line, section, line });
      else errors.push(line);
      continue;
    }
    const e: DeckEntry = { count: parseInt(m[1]!, 10), name: m[2]!.trim(), section, line };
    if (m[3]) e.set = m[3].toLowerCase();
    if (m[4]) e.number = m[4];
    entries.push(e);
  }
  return { entries, errors };
}

// ---------- Scryfall's card objects ----------

export interface ImageUris { small?: string; normal?: string; large?: string; png?: string }
/** The printed facts of a card or one of its faces (all optional: Scryfall leaves out what a card lacks). */
interface ScryfallFacts {
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
}
export interface ScryfallCard extends ScryfallFacts {
  id: string;
  name: string;
  set?: string;
  collector_number?: string;
  oracle_id?: string;
  layout?: string;
  image_uris?: ImageUris;
  card_faces?: ({ name: string; image_uris?: ImageUris } & ScryfallFacts)[];
  all_parts?: { id: string; component: string; name?: string }[];
}

const FACT_KEYS = ['type_line', 'oracle_text', 'mana_cost', 'power', 'toughness', 'loyalty', 'defense'] as const;
/** Parts of Scryfall's record not worth keeping: prices go stale, links point at Scryfall's site. */
const DROPPED_KEYS = ['prices', 'purchase_uris', 'related_uris', 'uri', 'scryfall_uri', 'rulings_uri', 'prints_search_uri', 'set_uri', 'set_search_uri', 'scryfall_set_uri', 'image_uris'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isUris = (x: unknown): x is ImageUris => isObj(x) && ['small', 'normal', 'large', 'png'].every((k) => x[k] === undefined || isStr(x[k]));

const factsOk = (x: Record<string, unknown>) => FACT_KEYS.every((k) => x[k] === undefined || isStr(x[k]));

export function isScryfallCard(x: unknown): x is ScryfallCard {
  return isObj(x) && isStr(x.id) && isStr(x.name) && factsOk(x)
    && (x.oracle_id === undefined || isStr(x.oracle_id)) && (x.layout === undefined || isStr(x.layout))
    && (x.set === undefined || isStr(x.set)) && (x.collector_number === undefined || isStr(x.collector_number))
    && (x.image_uris === undefined || isUris(x.image_uris))
    && (x.card_faces === undefined || (Array.isArray(x.card_faces) && x.card_faces.every((f) => isObj(f) && isStr(f.name) && factsOk(f) && (f.image_uris === undefined || isUris(f.image_uris)))))
    && (x.all_parts === undefined || (Array.isArray(x.all_parts) && x.all_parts.every((p) => isObj(p) && isStr(p.id) && isStr(p.component))));
}

/** The `data` of a collection response, keeping only well-formed cards. */
function cardsOf(res: unknown): ScryfallCard[] {
  return isObj(res) && Array.isArray(res.data) ? res.data.filter(isScryfallCard) : [];
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    return res.json() as Promise<unknown>;
  }
  throw new Error('Scryfall rate limit; try again in a minute');
}

/** The three sizes we keep: small (146×204) for crowded boards, normal (488×680), large (672×936) for full screen. */
export const SIZES = ['small', 'normal', 'large'] as const;
type SizeUrls = Record<(typeof SIZES)[number], string>;
const pickSizes = (u: ImageUris | undefined): SizeUrls | null => (u?.normal ? { small: u.small || u.normal, normal: u.normal, large: u.large || u.normal } : null);

/** Image URLs, in three sizes, for a Scryfall card object: front, and back for double-faced layouts. */
export function imagesOf(card: ScryfallCard): { name: string; front: SizeUrls | null; back: SizeUrls | null } | null {
  if (card.image_uris) return { name: card.name, front: pickSizes(card.image_uris), back: null };
  const faces = card.card_faces || [];
  if (faces[0]?.image_uris) {
    return { name: card.name, front: pickSizes(faces[0].image_uris), back: pickSizes(faces[1]?.image_uris) };
  }
  return null;
}

const faceOf = (f: { name: string } & ScryfallFacts): FaceText => {
  const out: FaceText = { name: f.name, typeLine: f.type_line || '', oracleText: f.oracle_text || '' };
  if (f.mana_cost) out.manaCost = f.mana_cost;
  if (f.power !== undefined) out.power = f.power;
  if (f.toughness !== undefined) out.toughness = f.toughness;
  if (f.loyalty !== undefined) out.loyalty = f.loyalty;
  if (f.defense !== undefined) out.defense = f.defense;
  return out;
};

/**
 * The rules text and other facts kept for a card: typed faces (one, or one per face for
 * double-faced and split cards; a face missing a fact takes the card's), and the rest of the
 * record as delivered, minus prices and links.
 */
export function textOf(card: ScryfallCard): CardText {
  const faces = card.card_faces?.length ? card.card_faces.map((f) => faceOf({ ...pickFacts(card), ...f })) : [faceOf(card)];
  const record = Object.fromEntries(Object.entries(card).filter(([k]) => !DROPPED_KEYS.includes(k)));
  const text: CardText = { faces, record };
  if (card.oracle_id) text.oracleId = card.oracle_id;
  if (card.layout) text.layout = card.layout;
  return text;
}
const pickFacts = (c: ScryfallFacts): ScryfallFacts => Object.fromEntries(FACT_KEYS.filter((k) => c[k] !== undefined && k !== 'oracle_text').map((k) => [k, c[k]]));

/**
 * A fingerprint of a pasted list's cards (counts and names, order and printing ignored),
 * used to warn before importing the same list twice.
 */
export function listSignature(text: string): string {
  const totals = new Map<string, number>();
  for (const e of parseDecklist(text).entries) {
    if (e.section !== 'main' && e.section !== 'commander' && e.section !== 'tokens') continue;
    const k = `${e.section === 'commander' ? 'c:' : ''}${e.name.toLowerCase().replace(/\s+/g, ' ')}`;
    totals.set(k, (totals.get(k) || 0) + e.count);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${n} ${k}`).join('\n');
}

const identOf = (e: DeckEntry) => (e.set && e.number ? { set: e.set, collector_number: e.number } : e.set ? { name: e.name, set: e.set } : { name: e.name });
const keyOf = (e: DeckEntry) => (e.set && e.number ? `${e.set}#${e.number}` : e.name.toLowerCase());

export interface ImportOptions {
  name: string;
  kind?: 'deck' | 'token';
  text: string;
  onProgress?: (text: string) => void;
  extra?: Partial<Deck>;
  /** A shared token deck to add this deck's tokens to, instead of "<deck> · tokens". */
  tokens?: { deckId: string; name?: string; extra?: Partial<Deck> } | null;
  /**
   * Shared by the imports of one batch (several decks at once), so a card name, a token or a
   * card's rulings is requested at most once per batch. Make one with `importCache()`.
   */
  cache?: ImportCache;
}

export interface ImportCache {
  /** Lookups by list key (`set#number` or the lower-cased name). */
  cards: Map<string, ScryfallCard>;
  /** Tokens by Scryfall id. */
  tokens: Map<string, ScryfallCard>;
  /** Oracle ids whose rulings were looked up in this batch. */
  rulings: Set<string>;
}

export const importCache = (): ImportCache => ({ cards: new Map(), tokens: new Map(), rulings: new Set() });

export interface ImportResult {
  deckId: string;
  cards: number;
  tokens: number;
  tokenDeckId: string | null;
  missing: string[];
}

/** Import a deck. onProgress(text) is called as work proceeds. */
/** Import one deck, then clear out cards nothing uses any more (for instance after a failed import). */
export function importDeck(o: ImportOptions): Promise<ImportResult> {
  return holdSweep(async () => {
    try { return await importOne(o); } finally { void sweep(); }
  });
}

async function importOne({ name, kind = 'deck', text, onProgress = () => {}, extra = {}, tokens = null, cache = importCache() }: ImportOptions): Promise<ImportResult> {
  const { entries, errors } = parseDecklist(text);
  const wanted = entries.filter((e) => e.section === 'main' || e.section === 'commander' || (kind === 'token' && e.section === 'tokens'));
  if (!wanted.length) throw new Error('No cards found in that list.');
  const unique = [...new Map(wanted.map((e) => [keyOf(e), e])).values()];

  // 1. Resolve names through the collection endpoint, 75 at a time (names already looked up in
  //    this batch are reused).
  const found = new Map<string, ScryfallCard>();
  for (const e of unique) { const c = cache.cards.get(keyOf(e)); if (c) found.set(keyOf(e), c); }
  const lookup = unique.filter((e) => !found.has(keyOf(e)));
  for (let i = 0; i < lookup.length; i += 75) {
    onProgress(`Looking up cards ${i + 1}–${Math.min(i + 75, lookup.length)} of ${lookup.length}…`);
    const batch = lookup.slice(i, i + 75);
    const res = await api('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: batch.map(identOf) }) });
    for (const card of cardsOf(res)) {
      for (const e of batch) {
        const k = keyOf(e);
        if (found.has(k)) continue;
        const nm = e.name.toLowerCase();
        const cardNames = [card.name.toLowerCase(), ...(card.card_faces || []).map((f) => f.name.toLowerCase())];
        if ((e.set && e.number && card.set === e.set && card.collector_number === e.number) || cardNames.includes(nm) || card.name.toLowerCase().startsWith(nm + ' //')) {
          found.set(k, card);
        }
      }
    }
    await sleep(120);
  }
  // 2. Fuzzy fallback for anything unmatched.
  const missing: string[] = [];
  for (const e of unique) {
    if (found.has(keyOf(e))) continue;
    onProgress(`Trying a looser match for “${e.name}”…`);
    const card = await api(`/cards/named?fuzzy=${encodeURIComponent(e.name)}`);
    await sleep(120);
    if (isScryfallCard(card)) found.set(keyOf(e), card); else missing.push(e.line);
  }
  for (const [k, c] of found) cache.cards.set(k, c);

  // 3. Download images and store definitions, reusing cards already on this device.
  const known = await knownCards();
  const defOf = new Map<string, string>();
  let done = 0;
  const todo = unique.filter((e) => found.has(keyOf(e)));
  await pool(todo, async (e) => {
    const id = await storeCard(found.get(keyOf(e))!, known);
    if (id) defOf.set(keyOf(e), id); else missing.push(`${e.line} (no image)`);
    onProgress(`Downloaded ${++done} of ${todo.length} cards…`);
  });

  const cards: string[] = [];
  const commanders: string[] = [];
  for (const e of wanted) {
    const id = defOf.get(keyOf(e));
    if (!id) continue;
    for (let i = 0; i < e.count; i++) (e.section === 'commander' ? commanders : cards).push(id);
  }
  const deckId = `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await putDeck({ id: deckId, name: name || 'Imported deck', kind, cards, commanders, createdAt: Date.now(), signature: listSignature(text), ...extra });

  // 4. Tokens: every token the deck's cards can create, per Scryfall's related-card data.
  //    Saved to a token deck: by default "<deck> · tokens", or a shared deck given in `tokens`.
  let tokenCount = 0;
  let tokenDeckId: string | null = null;
  if (kind === 'deck') {
    const tokenIds = new Set<string>();
    for (const card of found.values()) {
      for (const part of card.all_parts || []) {
        if (part.component === 'token' && part.id !== card.id) tokenIds.add(part.id);
      }
    }
    if (tokenIds.size) {
      onProgress(`Getting ${tokenIds.size} token${tokenIds.size === 1 ? '' : 's'}…`);
      const tokenCards: ScryfallCard[] = [...tokenIds].map((id) => cache.tokens.get(id)).filter((c): c is ScryfallCard => !!c);
      const ids = [...tokenIds].filter((id) => !cache.tokens.has(id));
      for (let i = 0; i < ids.length; i += 75) {
        const res = await api('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }) });
        for (const c of cardsOf(res)) { cache.tokens.set(c.id, c); tokenCards.push(c); }
        await sleep(120);
      }
      const tokenDefs: string[] = [];
      await pool(tokenCards, async (card) => {
        const id = await storeCard(card, known);
        if (id) tokenDefs.push(id); else missing.push(`token ${card.name} (no image)`);
      });
      tokenDeckId = tokens?.deckId || `${deckId}-tokens`;
      const existing = await (await db()).get('decks', tokenDeckId);
      const merged = [...new Set([...(existing?.cards || []), ...tokenDefs])];
      await putDeck({
        ...(existing || {}),
        id: tokenDeckId,
        name: existing?.name || tokens?.name || `${name || 'Imported deck'} · tokens`,
        kind: 'token',
        cards: merged,
        forDecks: [...new Set([...(existing?.forDecks || []), deckId])],
        createdAt: existing?.createdAt || Date.now(),
        ...(tokens?.extra || {}),
      });
      tokenCount = tokenDefs.length;
    }
  }

  // 5. Rulings, once per card (by oracle id) across every printing and every import.
  await fetchRulings([...found.values()], cache, onProgress);
  return { deckId, cards: cards.length + commanders.length, tokens: tokenCount, tokenDeckId, missing: [...missing, ...errors] };
}

/** Scryfall id → defId for cards already stored with all three sizes and their rules text. */
async function knownCards(): Promise<Map<string, string>> {
  const known = new Map<string, string>();
  for (const d of await (await db()).getAll('defs')) {
    if (d.scryfallId && d.sizes && d.text) known.set(d.scryfallId, d.id); // anything less is fetched again
  }
  return known;
}

const isRulingsList = (x: unknown): x is { data: unknown[] } => isObj(x) && Array.isArray(x.data);

/**
 * Fetch and store the rulings of cards that have none on this device yet (one request per card,
 * shared by its printings). Basic lands are skipped. A failed request leaves that card without
 * rulings and is retried by a later import; it never fails this one.
 */
async function fetchRulings(cards: readonly ScryfallCard[], cache: ImportCache, onProgress: (t: string) => void): Promise<void> {
  const todo: ScryfallCard[] = [];
  for (const c of cards) {
    const oid = c.oracle_id;
    if (!oid || !c.set || !c.collector_number || cache.rulings.has(oid)) continue;
    if (/\bBasic\b.*\bLand\b/.test(c.type_line || c.card_faces?.[0]?.type_line || '')) continue;
    cache.rulings.add(oid);
    if (await getRulings(oid)) continue;
    todo.push(c);
  }
  for (const [i, c] of todo.entries()) {
    onProgress(`Getting rulings ${i + 1} of ${todo.length}…`);
    try {
      const res = await api(`/cards/${encodeURIComponent(c.set!)}/${encodeURIComponent(c.collector_number!)}/rulings`);
      if (isRulingsList(res)) {
        const rulings: Ruling[] = res.data.filter(isObj).filter((r) => isStr(r.comment))
          .map((r) => ({ source: isStr(r.source) ? r.source : '', publishedAt: isStr(r.published_at) ? r.published_at : '', comment: r.comment as string }));
        await putRulings({ oracleId: c.oracle_id!, rulings, fetchedAt: Date.now() });
      } else cache.rulings.delete(c.oracle_id!);
    } catch {
      cache.rulings.delete(c.oracle_id!); // try again on a later import
    }
    await sleep(120);
  }
}

/** Run `fn` over items with 4 at a time. */
async function pool<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const worker = async () => { while (queue.length) await fn(queue.shift()!); };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/** Download one Scryfall card's images (3 sizes per face) and store its definition. Returns the defId. */
async function storeCard(card: ScryfallCard, known: Map<string, string>): Promise<string | null> {
  const hit = known.get(card.id);
  if (hit) return hit;
  const imgs = imagesOf(card);
  if (!imgs?.front) return null;
  const fetchImg = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`image ${r.status}`);
    return putImage(await r.blob());
  };
  const fetchFace = async (urls: SizeUrls) => {
    const out: Partial<SizeUrls> = {};
    for (const size of SIZES) out[size] = urls[size] === urls.normal && out.normal ? out.normal : await fetchImg(urls[size]);
    return out as SizeUrls;
  };
  const f = await fetchFace(imgs.front);
  const b = imgs.back ? await fetchFace(imgs.back) : null;
  // The card id derives from the normal-size images, so it matches across devices and older imports.
  const id = await defIdFor(imgs.name, f.normal, b?.normal || null);
  await putDef({
    id, name: imgs.name, front: f.normal, back: b?.normal || null, scryfallId: card.id,
    sizes: { front: { small: f.small, large: f.large }, back: b ? { small: b.small, large: b.large } : null },
    text: textOf(card),
  });
  known.set(card.id, id);
  return id;
}
