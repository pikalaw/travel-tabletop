// Deck import: parse a pasted decklist, resolve cards through Scryfall, download images,
// and store definitions and the deck locally. Needs internet; everything else in the app does not.
// Scryfall asks for 50–100 ms between API requests; image downloads are from *.scryfall.io,
// which has no such limit, but we still keep concurrency modest.

import { putImage, putDef, putDeck, defIdFor, db } from './db.js';

const API = 'https://api.scryfall.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Parse common decklist formats (Arena, MTGO, Moxfield exports).
 * Lines: "4 Lightning Bolt", "4x Lightning Bolt", "1 Delver of Secrets (ISD) 51", "1 Sol Ring *F*".
 * Section headers "Commander", "Deck", "Sideboard", "Maybeboard", "Companion" are recognised.
 * @returns {{ entries: { count: number, name: string, set?: string, number?: string, section: string, line: string }[], errors: string[] }}
 */
export function parseDecklist(text) {
  const entries = [];
  const errors = [];
  let section = 'main';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const header = line.replace(/:$/, '').toLowerCase();
    if (['commander', 'commanders'].includes(header)) { section = 'commander'; continue; }
    if (['deck', 'main', 'mainboard', 'main deck'].includes(header)) { section = 'main'; continue; }
    if (['sideboard', 'maybeboard', 'considering', 'companion', 'tokens', 'about'].includes(header)) { section = header; continue; }
    if (/^name\s/i.test(line)) continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9\-★†]+))?)?(?:\s+\*[A-Za-z]+\*)*\s*$/);
    if (!m) {
      // A bare card name counts as one copy.
      if (/^[A-Za-z]/.test(line)) entries.push({ count: 1, name: line, section, line });
      else errors.push(line);
      continue;
    }
    entries.push({ count: parseInt(m[1], 10), name: m[2].trim(), set: m[3]?.toLowerCase(), number: m[4], section, line });
  }
  return { entries, errors };
}

async function api(path, init) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    return res.json();
  }
  throw new Error('Scryfall rate limit; try again in a minute');
}

/** The three sizes we keep: small (146×204) for crowded boards, normal (488×680), large (672×936) for full screen. */
export const SIZES = ['small', 'normal', 'large'];
const pickSizes = (u) => (u?.normal ? { small: u.small || u.normal, normal: u.normal, large: u.large || u.normal } : null);

/** Image URLs, in three sizes, for a Scryfall card object: front, and back for double-faced layouts. */
export function imagesOf(card) {
  if (card.image_uris) return { name: card.name, front: pickSizes(card.image_uris), back: null };
  const faces = card.card_faces || [];
  if (faces[0]?.image_uris) {
    return { name: card.name, front: pickSizes(faces[0].image_uris), back: pickSizes(faces[1]?.image_uris) };
  }
  return null;
}

/**
 * A fingerprint of a pasted list's cards (counts and names, order and printing ignored),
 * used to warn before importing the same list twice.
 */
export function listSignature(text) {
  const totals = new Map();
  for (const e of parseDecklist(text).entries) {
    if (e.section !== 'main' && e.section !== 'commander' && e.section !== 'tokens') continue;
    const k = `${e.section === 'commander' ? 'c:' : ''}${e.name.toLowerCase().replace(/\s+/g, ' ')}`;
    totals.set(k, (totals.get(k) || 0) + e.count);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${n} ${k}`).join('\n');
}

const identOf = (e) => (e.set && e.number ? { set: e.set, collector_number: e.number } : e.set ? { name: e.name, set: e.set } : { name: e.name });
const keyOf = (e) => (e.set && e.number ? `${e.set}#${e.number}` : e.name.toLowerCase());

/**
 * Import a deck. onProgress(text) is called as work proceeds.
 * @returns {Promise<{ deckId: string, cards: number, missing: string[] }>}
 */
export async function importDeck({ name, kind = 'deck', text, onProgress = () => {}, extra = {}, tokens = null }) {
  const { entries, errors } = parseDecklist(text);
  const wanted = entries.filter((e) => e.section === 'main' || e.section === 'commander' || (kind === 'token' && e.section === 'tokens'));
  if (!wanted.length) throw new Error('No cards found in that list.');
  const unique = [...new Map(wanted.map((e) => [keyOf(e), e])).values()];

  // 1. Resolve names through the collection endpoint, 75 at a time.
  const found = new Map();
  for (let i = 0; i < unique.length; i += 75) {
    onProgress(`Looking up cards ${i + 1}–${Math.min(i + 75, unique.length)} of ${unique.length}…`);
    const batch = unique.slice(i, i + 75);
    const res = await api('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: batch.map(identOf) }) });
    for (const card of res?.data || []) {
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
  const missing = [];
  for (const e of unique) {
    if (found.has(keyOf(e))) continue;
    onProgress(`Trying a looser match for “${e.name}”…`);
    const card = await api(`/cards/named?fuzzy=${encodeURIComponent(e.name)}`);
    await sleep(120);
    if (card) found.set(keyOf(e), card); else missing.push(e.line);
  }

  // 3. Download images and store definitions, reusing cards already on this device.
  const known = await knownCards();
  const defOf = new Map();
  let done = 0;
  const todo = unique.filter((e) => found.has(keyOf(e)));
  await pool(todo, async (e) => {
    const id = await storeCard(found.get(keyOf(e)), known);
    if (id) defOf.set(keyOf(e), id); else missing.push(`${e.line} (no image)`);
    onProgress(`Downloaded ${++done} of ${todo.length} cards…`);
  });

  const cards = [];
  const commanders = [];
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
  let tokenDeckId = null;
  if (kind === 'deck') {
    const tokenIds = new Set();
    for (const card of found.values()) {
      for (const part of card.all_parts || []) {
        if (part.component === 'token' && part.id !== card.id) tokenIds.add(part.id);
      }
    }
    if (tokenIds.size) {
      onProgress(`Getting ${tokenIds.size} token${tokenIds.size === 1 ? '' : 's'}…`);
      const tokenCards = [];
      const ids = [...tokenIds];
      for (let i = 0; i < ids.length; i += 75) {
        const res = await api('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((id) => ({ id })) }) });
        tokenCards.push(...(res?.data || []));
        await sleep(120);
      }
      const tokenDefs = [];
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
  return { deckId, cards: cards.length + commanders.length, tokens: tokenCount, tokenDeckId, missing: [...missing, ...errors] };
}

/** Scryfall id → defId for cards already stored with all three sizes. */
async function knownCards() {
  const known = new Map();
  for (const d of await (await db()).getAll('defs')) {
    if (d.scryfallId && d.sizes) known.set(d.scryfallId, d.id); // older one-size imports re-download
  }
  return known;
}

/** Run `fn` over items with 4 at a time. */
async function pool(items, fn) {
  const queue = [...items];
  const worker = async () => { while (queue.length) await fn(queue.shift()); };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/** Download one Scryfall card's images (3 sizes per face) and store its definition. Returns the defId. */
async function storeCard(card, known) {
  if (known.has(card.id)) return known.get(card.id);
  const imgs = imagesOf(card);
  if (!imgs?.front) return null;
  const fetchImg = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`image ${r.status}`);
    return putImage(await r.blob());
  };
  const fetchFace = async (urls) => {
    const out = {};
    for (const size of SIZES) out[size] = urls[size] === urls.normal && out.normal ? out.normal : await fetchImg(urls[size]);
    return out;
  };
  const f = await fetchFace(imgs.front);
  const b = imgs.back ? await fetchFace(imgs.back) : null;
  // The card id derives from the normal-size images, so it matches across devices and older imports.
  const id = await defIdFor(imgs.name, f.normal, b?.normal || null);
  await putDef({
    id, name: imgs.name, front: f.normal, back: b?.normal || null, scryfallId: card.id,
    sizes: { front: { small: f.small, large: f.large }, back: b ? { small: b.small, large: b.large } : null },
  });
  known.set(card.id, id);
  return id;
}
