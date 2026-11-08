import { expect, type CDPSession, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

type Target = Locator | string;
const loc = (page: Page, t: Target) => (typeof t === 'string' ? page.locator(t).first() : t);

/** Centre of an element, or a point at fraction (fx, fy) of its box. */
export async function point(page: Page, t: Target, fx = 0.5, fy = 0.5) {
  const b = await loc(page, t).boundingBox();
  if (!b) throw new Error(`no box for ${t}`);
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

/** A mouse drag in small steps, the way the app's gesture code expects. */
export async function drag(page: Page, src: Target, dst: Target, opts: { fx?: number; fy?: number; steps?: number } = {}) {
  const a = await point(page, src);
  const b = await point(page, dst, opts.fx ?? 0.5, opts.fy ?? 0.5);
  const steps = opts.steps ?? 12;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** Press and hold (a long-press opens the full-screen view). */
export async function longPress(page: Page, t: Target, fx = 0.5, fy = 0.5) {
  const p = await point(page, t, fx, fy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Tap a board card away from its marks and badges. */
export async function tapCard(page: Page, cardId: string) {
  // An open row scrolls; bring the card into its visible part first, as a player would.
  await page.locator(`.board [data-card="${cardId}"]`).first().scrollIntoViewIfNeeded();
  const p = await point(page, `.board [data-card="${cardId}"]`, 0.4, 0.6);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
}

/** Scroll the footer bar back to its start so its first buttons are on screen. */
export async function resetBar(page: Page) {
  await page.locator('.bar').first().evaluate((e) => { e.scrollLeft = 0; });
}

/** Click a footer button by its text, scrolling the bar to it first. */
export async function barButton(page: Page, text: string) {
  const b = page.locator('.bar').first().getByRole('button', { name: text, exact: true });
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await page.waitForTimeout(200);
}

/** Answer the app's own dialog with its main (OK) button or Cancel. */
export async function answerDialog(page: Page, ok: boolean) {
  const box = page.locator('.confirm-box.plain');
  await expect(box).toBeVisible();
  await box.locator(ok ? '.btn.yes' : '.btn:not(.yes)').first().click();
  await page.waitForTimeout(200);
}

/** A row's exact `open` class (a collapsed row has `can-open`, which a word-boundary match would also accept). */
export const OPEN = /(^|\s)open(\s|$)/;

/** Unblind to a player (same-device mode), answering "Are you sure you are …?". */
export async function unblind(page: Page, name: string) {
  await page.getByRole('button', { name: `Unblind to ${name}` }).click();
  await page.locator('.confirm-box .btn.yes').click();
  await page.waitForTimeout(300);
}

/** Start a one-device game with the default players and decks, unblinded to Player 1. */
export async function startOneDevice(page: Page, opts: { unblindTo?: string | null } = {}) {
  await page.goto('index.html');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  const who = opts.unblindTo === undefined ? 'Player 1' : opts.unblindTo;
  if (who) await unblind(page, who);
}

/** Card ids in a zone's row or pile on the board. */
export function idsIn(page: Page, zone: string) {
  return page.locator(`[data-drop="${zone}"]`).evaluate((e) => [...e.querySelectorAll('[data-card]')].map((c) => (c as HTMLElement).dataset.card!));
}

/** Move the first n hand cards of Player 1 onto a zone by dragging. */
export async function playFromHand(page: Page, zone: string, n = 1) {
  for (let i = 0; i < n; i++) await drag(page, page.locator('[data-drop="p1.hand"] [data-card]').first(), page.locator(`[data-drop="${zone}"]`));
}

/** Collect page errors; call expectNoErrors at the end of a test. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { errors, expectNone: () => expect(errors, errors.join('\n')).toEqual([]) };
}

/**
 * Mock the Scryfall API and image CDN. Cards are generated from their names; "Front N"
 * becomes the double-faced "Front N // Back N". `tokens` maps a card name to the token
 * names it creates. Images are real JPEGs of Scryfall's three sizes.
 */
export async function mockScryfall(page: Page, opts: { tokens?: Record<string, string[]> } = {}) {
  const slug = (n: string) => createHash('md5').update(n.toLowerCase()).digest('hex').slice(0, 8);
  const imgs = (id: string, face: 'f' | 'b') => Object.fromEntries(['small', 'normal', 'large', 'png'].map((s) => [s, `https://cards.scryfall.io/${s}/front/${id}-${face}.jpg`]));
  const tokenName = new Map<string, string>();
  for (const ts of Object.values(opts.tokens || {})) for (const t of ts) tokenName.set(`tok-${slug(t)}`, t);
  const card = (name: string, token = false): Record<string, unknown> => {
    const id = (token ? 'tok-' : '') + slug(name);
    const dfc = /^Front (\d+)$/.exec(name);
    const c: Record<string, unknown> = { id, name, set: token ? 'ttst' : 'tst', collector_number: '1' };
    if (dfc) {
      c.name = `Front ${dfc[1]} // Back ${dfc[1]}`;
      c.card_faces = [{ name: `Front ${dfc[1]}`, image_uris: imgs(id, 'f') }, { name: `Back ${dfc[1]}`, image_uris: imgs(id, 'b') }];
    } else c.image_uris = imgs(id, 'f');
    const toks = opts.tokens?.[name];
    if (toks) c.all_parts = [{ component: 'combo_piece', id, name }, ...toks.map((t) => ({ component: 'token', id: `tok-${slug(t)}`, name: t }))];
    return c;
  };
  const calls = { collection: 0, named: 0, images: [] as string[], identifiers: [] as Record<string, string>[] };
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await page.context().route('https://api.scryfall.com/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/cards/collection')) {
      calls.collection++;
      const ids = (JSON.parse(req.postData() || '{}').identifiers || []) as Record<string, string>[];
      calls.identifiers.push(...ids);
      const data = ids.map((x) => (x.id ? card(tokenName.get(x.id) || x.id, true) : card(x.name || '?')));
      return route.fulfill({ headers: cors, json: { data } });
    }
    if (req.url().includes('/cards/named')) {
      calls.named++;
      return route.fulfill({ headers: cors, json: card(new URL(req.url()).searchParams.get('fuzzy') || '?') });
    }
    return route.fulfill({ status: 404, headers: cors, json: { object: 'error' } });
  });
  await page.context().route('https://cards.scryfall.io/**', (route) => {
    const url = route.request().url();
    calls.images.push(url);
    const m = /\/(small|normal|large|png)\/front\/[^/]+-(f|b)\.jpg/.exec(url);
    const size = m?.[1] === 'png' ? 'large' : m?.[1] || 'normal';
    return route.fulfill({ headers: cors, contentType: 'image/jpeg', path: `${FIXTURES}scryfall/${size}-${m?.[2] || 'f'}.jpg` });
  });
  return calls;
}

/** Import a deck from a pasted list (Scryfall must be mocked). */
export async function importDeck(page: Page, name: string, list: string) {
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Decks' }).click();
  await page.getByText('Import a deck').click();
  await page.locator('input').first().fill(name);
  await page.locator('textarea').fill(list);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
}

/** On the setup screen, give each player form exactly these decks (by name). */
export async function pickDecks(page: Page, perForm: string[][]) {
  const forms = page.locator('.player-form');
  for (const [k, names] of perForm.entries()) {
    const checks = forms.nth(k).locator('.deck-check');
    await expect(checks.first()).toBeVisible(); // the checklist appears once the decks have loaded
    for (let i = 0; i < (await checks.count()); i++) {
      const c = checks.nth(i);
      const text = await c.innerText();
      const want = names.some((n) => text.includes(n));
      // the row's `on` class is its state (the checkbox inside isn't bound to it)
      const on = async () => ((await c.getAttribute('class')) || '').split(/\s+/).includes('on');
      if ((await on()) !== want) await c.click();
      await expect.poll(on).toBe(want);
    }
  }
}

/**
 * Pair a host page and a guest page by pasted text codes. The host must already be on its
 * pairing screen; `guestStart` takes the guest to the point where it asks for the host's code.
 */
export async function pairByText(H: Page, G: Page, guestStart: () => Promise<void>) {
  await H.getByText('Create code without camera').click();
  await H.waitForSelector('.code-text textarea');
  const offer = await H.locator('.code-text textarea').inputValue();
  await guestStart();
  await G.getByText('Paste text code').click();
  await G.locator('.paste textarea').fill(offer);
  await G.getByText('Use this code').click();
  await G.waitForSelector('.code-text textarea', { timeout: 15_000 });
  const answer = await G.locator('.code-text textarea').inputValue();
  await H.getByText("Next: scan the guest's code").click();
  await H.getByText('Paste text code').click();
  await H.locator('.paste textarea').fill(answer);
  await H.getByText('Use this code').click();
  return { offer, answer };
}

/** Start a two-device game: host "Larry", guest "Claire" (with the Grove deck). */
export async function startTwoDevices(H: Page, G: Page) {
  for (const pg of [H, G]) { await pg.goto('index.html'); await pg.getByRole('button', { name: 'New game' }).click(); }
  await H.getByText('Host (two devices)').click();
  await H.locator('.player-form input').first().fill('Larry');
  await H.getByText('Next: pair the guest').click();
  const codes = await pairByText(H, G, async () => {
    await G.getByText('Join (two devices)').click();
    await G.locator('.player-form input').first().fill('Claire');
    await pickDecks(G, [['Sample: Grove']]);
    await G.getByText("Next: scan the host's code").click();
  });
  await H.waitForSelector('.board', { timeout: 20_000 });
  await G.waitForSelector('.board', { timeout: 20_000 });
  return codes;
}

/** A one-finger touch gesture through CDP (real touch events, unlike page.mouse). */
export async function touchSwipe(cdp: CDPSession, page: Page, x0: number, y0: number, x1: number, y1: number, opts: { steps?: number; hold?: number; holdBefore?: number } = {}) {
  const steps = opts.steps ?? 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  if (opts.holdBefore) await page.waitForTimeout(opts.holdBefore);
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
    await page.waitForTimeout(16);
  }
  if (opts.hold) await page.waitForTimeout(opts.hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
}
