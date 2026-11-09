// Built-in sample decks and tokens, drawn as SVG so the app is playable before any import.
// All names, art and rules text here are original placeholders.

import { putImage, putDef, putDeck, defIdFor, getMeta, setMeta, holdSweep, sweep } from './db';

type Color = 'red' | 'green' | 'gray' | 'gold';
type ArtKind = 'peak' | 'grove' | 'beast' | 'flame' | 'bolt' | 'sprout' | 'tower' | 'sigil' | 'coin' | 'wing';

/** One sample card face. */
export interface Face {
  name: string;
  type: string;
  text?: string;
  pt?: string;
  color?: Color;
  art?: ArtKind;
  cost?: string;
  back?: Face;
}

const FIXTURE_VERSION = 2;

const PALETTE: Record<Color, { frame: string; bg: string; art: [string, string] }> = {
  red: { frame: '#b8432c', bg: '#f3ddd3', art: ['#e8794a', '#7a2414'] },
  green: { frame: '#3c7d48', bg: '#dcebd6', art: ['#7cb76a', '#1f4a2a'] },
  gray: { frame: '#77808a', bg: '#e4e6e8', art: ['#aab3bc', '#40464d'] },
  gold: { frame: '#a9862e', bg: '#f1e8cf', art: ['#e6c45c', '#6b5212'] },
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ESC[c]!);

function wrap(text: string, width: number): string[] {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { if (line) lines.push(line); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

const ART: Record<ArtKind, (a: string, b: string) => string> = {
  peak: (a, b) => `<polygon points="60,330 200,140 290,250 380,120 570,330" fill="${b}"/><polygon points="200,140 235,190 165,190" fill="#fff" opacity=".8"/><circle cx="470" cy="150" r="40" fill="${a}"/>`,
  grove: (a, b) => `<rect x="60" y="270" width="510" height="60" fill="${b}"/>${[120, 250, 380, 500].map((x, i) => `<rect x="${x - 8}" y="${200 - i * 6}" width="16" height="${90 + i * 6}" fill="#4a3220"/><circle cx="${x}" cy="${180 - i * 6}" r="${55 + (i % 2) * 12}" fill="${i % 2 ? a : b}"/>`).join('')}`,
  beast: (a, b) => `<ellipse cx="315" cy="250" rx="170" ry="70" fill="${b}"/><circle cx="470" cy="200" r="50" fill="${b}"/><circle cx="485" cy="190" r="9" fill="${a}"/>${[200, 260, 370, 420].map((x) => `<rect x="${x}" y="290" width="22" height="50" fill="${b}"/>`).join('')}`,
  flame: (a, b) => `<path d="M315 110 C390 190 430 240 400 300 C380 340 250 340 230 300 C200 240 260 210 280 160 C300 210 330 220 315 110Z" fill="${a}"/><path d="M315 200 C350 240 360 270 345 300 C330 320 300 320 290 300 C280 270 300 250 315 200Z" fill="${b}"/>`,
  bolt: (a, b) => `<polygon points="340,110 230,250 300,250 260,340 400,190 330,190 380,110" fill="${a}" stroke="${b}" stroke-width="8"/>`,
  sprout: (a, b) => `<path d="M315 330 L315 200" stroke="${b}" stroke-width="14"/><ellipse cx="260" cy="190" rx="60" ry="28" fill="${a}" transform="rotate(-25 260 190)"/><ellipse cx="370" cy="170" rx="60" ry="28" fill="${a}" transform="rotate(25 370 170)"/>`,
  tower: (a, b) => `<rect x="250" y="140" width="130" height="190" fill="${b}"/><rect x="230" y="120" width="170" height="30" fill="${a}"/><rect x="295" y="250" width="40" height="80" fill="${a}"/>`,
  sigil: (a, b) => `<circle cx="315" cy="225" r="95" fill="none" stroke="${b}" stroke-width="10"/><polygon points="315,140 390,270 240,270" fill="none" stroke="${a}" stroke-width="10"/><circle cx="315" cy="225" r="18" fill="${a}"/>`,
  coin: (a, b) => `<circle cx="315" cy="225" r="100" fill="${a}" stroke="${b}" stroke-width="12"/><text x="315" y="255" font-size="90" text-anchor="middle" fill="${b}" font-family="Georgia,serif">$</text>`,
  wing: (a, b) => `<path d="M315 300 C230 260 150 200 120 120 C200 150 260 170 315 230 C370 170 430 150 510 120 C480 200 400 260 315 300Z" fill="${a}" stroke="${b}" stroke-width="6"/>`,
};

/** Render one card face as an SVG string (630 × 880). */
export function cardSvg({ name, type, text = '', pt = '', color = 'gray', art = 'sigil', cost = '' }: Face): string {
  const c = PALETTE[color] || PALETTE.gray;
  const lines = wrap(text, 34).slice(0, 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 630 880" width="630" height="880">
<rect width="630" height="880" rx="34" fill="#141414"/>
<rect x="22" y="22" width="586" height="836" rx="22" fill="${c.frame}"/>
<rect x="44" y="44" width="542" height="64" rx="12" fill="${c.bg}"/>
<text x="64" y="88" font-size="34" font-family="Georgia,serif" font-weight="bold" fill="#111">${esc(name)}</text>
<text x="566" y="88" font-size="30" font-family="Georgia,serif" text-anchor="end" fill="#111">${esc(cost)}</text>
<rect x="44" y="118" width="542" height="330" rx="6" fill="${c.bg}"/>
<g>${(ART[art] || ART.sigil)(c.art[0], c.art[1])}</g>
<rect x="44" y="458" width="542" height="56" rx="12" fill="${c.bg}"/>
<text x="64" y="496" font-size="28" font-family="Georgia,serif" fill="#111">${esc(type)}</text>
<rect x="44" y="524" width="542" height="300" rx="6" fill="#f7f4ee"/>
${lines.map((l, i) => `<text x="66" y="${574 + i * 38}" font-size="28" font-family="Georgia,serif" fill="#1a1a1a">${esc(l)}</text>`).join('\n')}
${pt ? `<rect x="462" y="782" width="124" height="62" rx="12" fill="${c.bg}" stroke="#141414" stroke-width="4"/><text x="524" y="826" font-size="36" font-family="Georgia,serif" font-weight="bold" text-anchor="middle" fill="#111">${esc(pt)}</text>` : ''}
<text x="64" y="846" font-size="18" font-family="Helvetica,Arial,sans-serif" fill="#f0f0f0" opacity=".8">Sample card · placeholder art</text>
</svg>`;
}

// ---------- Fixture content ----------

const EMBER: [number, Face][] = [
  [16, { name: 'Mountain', type: 'Basic Land — Mountain', text: 'Tap: Add R.', color: 'red', art: 'peak' }],
  [4, { name: 'Cinder Pup', type: 'Creature — Hound', text: 'Haste.', pt: '1/1', color: 'red', art: 'beast', cost: '{R}' }],
  [4, { name: 'Ashfang Raider', type: 'Creature — Raider', text: 'When this enters, it deals 1 damage to any target.', pt: '3/2', color: 'red', art: 'flame', cost: '{2}{R}' }],
  [3, { name: 'Kiln Brute', type: 'Creature — Giant', text: 'Trample.', pt: '4/3', color: 'red', art: 'beast', cost: '{3}{R}' }],
  [4, { name: 'Spark Volley', type: 'Instant', text: 'Deal 3 damage to any target.', color: 'red', art: 'bolt', cost: '{R}' }],
  [3, { name: 'Flare Up', type: 'Sorcery', text: 'Create two 1/1 red Goblin creature tokens. They gain haste until end of turn.', color: 'red', art: 'flame', cost: '{2}{R}' }],
  [2, { name: 'Forge Warden', type: 'Planeswalker — Warden', text: 'Loyalty 3. +1: Deal 1 damage to each opponent. −2: Create a 1/1 Goblin token.', color: 'red', art: 'tower', cost: '{2}{R}{R}' }],
  [2, { name: 'Molten Sentinel', type: 'Creature — Golem (transforms)', text: 'At the beginning of your upkeep, you may transform this.', pt: '2/3', color: 'red', art: 'tower', cost: '{2}{R}',
    back: { name: 'Molten Colossus', type: 'Creature — Golem', text: 'Trample, haste.', pt: '6/5', color: 'red', art: 'flame' } }],
  [2, { name: 'Scry Ember', type: 'Sorcery', text: 'Look at the top three cards of your library. Put one into your hand and the rest on the bottom.', color: 'red', art: 'sigil', cost: '{1}{R}' }],
];

const GROVE: [number, Face][] = [
  [16, { name: 'Forest', type: 'Basic Land — Forest', text: 'Tap: Add G.', color: 'green', art: 'grove' }],
  [4, { name: 'Mossback Hound', type: 'Creature — Dog', text: 'Vigilance.', pt: '2/2', color: 'green', art: 'beast', cost: '{1}{G}' }],
  [4, { name: 'Thornwood Elk', type: 'Creature — Elk', text: 'Reach.', pt: '3/3', color: 'green', art: 'beast', cost: '{2}{G}' }],
  [3, { name: 'Grovekeeper Elder', type: 'Creature — Druid', text: 'Tap: Put a +1/+1 counter on target creature.', pt: '2/4', color: 'green', art: 'grove', cost: '{3}{G}' }],
  [4, { name: 'Rampant Bloom', type: 'Sorcery', text: 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', color: 'green', art: 'sprout', cost: '{1}{G}' }],
  [3, { name: 'Wild Surge', type: 'Instant', text: 'Target creature gets +3/+3 until end of turn.', color: 'green', art: 'sprout', cost: '{G}' }],
  [2, { name: 'Elder of the Grove', type: 'Planeswalker — Elder', text: 'Loyalty 4. +1: Create a 2/2 Wolf token. −3: Put three +1/+1 counters on target creature.', color: 'green', art: 'grove', cost: '{3}{G}{G}' }],
  [2, { name: 'Hollow Sapling', type: 'Creature — Treefolk (transforms)', text: 'When you control seven or more lands, transform this.', pt: '0/3', color: 'green', art: 'sprout', cost: '{1}{G}',
    back: { name: 'Ancient Hollow', type: 'Creature — Treefolk', text: 'Reach, trample.', pt: '7/7', color: 'green', art: 'grove' } }],
  [2, { name: 'Seedling Surveyor', type: 'Creature — Scout', text: 'When this enters, look at the top card of any library. You may put it into its owner\'s graveyard.', pt: '1/2', color: 'green', art: 'sprout', cost: '{G}' }],
];

const TOKENS: Face[] = [
  { name: 'Goblin', type: 'Token Creature — Goblin', pt: '1/1', color: 'red', art: 'beast' },
  { name: 'Soldier', type: 'Token Creature — Soldier', pt: '1/1', color: 'gray', art: 'tower' },
  { name: 'Wolf', type: 'Token Creature — Wolf', pt: '2/2', color: 'green', art: 'beast' },
  { name: 'Beast', type: 'Token Creature — Beast', pt: '3/3', color: 'green', art: 'beast' },
  { name: 'Zombie', type: 'Token Creature — Zombie', pt: '2/2', color: 'gray', art: 'sigil' },
  { name: 'Spirit', type: 'Token Creature — Spirit', text: 'Flying.', pt: '1/1', color: 'gray', art: 'wing' },
  { name: 'Angel', type: 'Token Creature — Angel', text: 'Flying.', pt: '4/4', color: 'gold', art: 'wing' },
  { name: 'Plant', type: 'Token Creature — Plant', text: 'Defender.', pt: '0/1', color: 'green', art: 'sprout' },
  { name: 'Treasure', type: 'Token Artifact — Treasure', text: 'Tap, sacrifice this: Add one mana of any color.', color: 'gold', art: 'coin' },
  { name: 'Clue', type: 'Token Artifact — Clue', text: '{2}, sacrifice this: Draw a card.', color: 'gray', art: 'sigil' },
  { name: 'Food', type: 'Token Artifact — Food', text: '{2}, tap, sacrifice this: You gain 3 life.', color: 'gold', art: 'sprout' },
  { name: 'Copy', type: 'Token — copy of a card', text: 'Write what this copies here in a counter label, or just remember it.', color: 'gray', art: 'sigil' },
];

const svgBlob = (svg: string) => new Blob([svg], { type: 'image/svg+xml' });

async function makeDef(face: Face): Promise<string> {
  const front = await putImage(svgBlob(cardSvg(face)));
  const back = face.back ? await putImage(svgBlob(cardSvg(face.back))) : null;
  const name = face.back ? `${face.name} // ${face.back.name}` : face.name;
  const id = await defIdFor(name, front, back);
  await putDef({ id, name, front, back });
  return id;
}

async function makeDeck(id: string, name: string, kind: 'deck' | 'token', entries: [number, Face][]): Promise<void> {
  const cards: string[] = [];
  for (const [count, face] of entries) {
    const defId = await makeDef(face);
    for (let i = 0; i < count; i++) cards.push(defId);
  }
  await putDeck({ id, name, kind, cards, builtin: true, createdAt: 0 });
}

/** Create the sample decks and tokens once per fixture version. */
/** Build the sample decks if this device has none or an older set; old sample cards are swept. */
export function ensureFixtures(): Promise<boolean> {
  return holdSweep(async () => {
    const made = await makeFixtures();
    if (made) void sweep();
    return made;
  });
}

async function makeFixtures(): Promise<boolean> {
  if ((await getMeta('fixtures')) === FIXTURE_VERSION) return false;
  await makeDeck('sample-ember', 'Sample: Ember (red)', 'deck', EMBER);
  await makeDeck('sample-grove', 'Sample: Grove (green)', 'deck', GROVE);
  await makeDeck('builtin-tokens', 'Basic tokens', 'token', TOKENS.map((t): [number, Face] => [1, t]));
  await setMeta('fixtures', FIXTURE_VERSION);
  return true;
}
