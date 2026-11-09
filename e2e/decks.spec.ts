import { test, expect } from '@playwright/test';
import { mockScryfall, longPress, unblind, answerDialog, barButton, watchErrors, importDeck, pickDecks } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

test('import fetches cards, three image sizes per face, and a token deck', async ({ page }) => {
  const errs = watchErrors(page);
  const calls = await mockScryfall(page, { tokens: { 'Aang, Air Nomad': ['Ally'], Badgermole: ['Clue'] } });
  await importDeck(page, 'My Aang', '2 Aang, Air Nomad\n1 Badgermole\n10 Plains');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  expect(calls.collection).toBeGreaterThan(0);
  const sizes = new Set(calls.images.map((u) => /\/(small|normal|large)\//.exec(u)?.[1]));
  expect([...sizes].sort()).toEqual(['large', 'normal', 'small']);
  await page.getByText('← Decks').click();
  await expect(page.locator('.deck-row', { hasText: 'My Aang · tokens' })).toHaveCount(1);
  errs.expectNone();
});

test('a duplicate import asks first; deleting a token deck names the decks using it', async ({ page }) => {
  await mockScryfall(page, { tokens: { 'Aang, Air Nomad': ['Ally'] } });
  await importDeck(page, 'My Aang', '2 Aang, Air Nomad\n1 Badgermole\n10 Plains');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  // the same cards in another order, under another name
  await page.locator('input').first().fill('Aang Again');
  await page.locator('textarea').fill('1 Badgermole\n10 Plains\n1 Aang, Air Nomad\n1 aang, air nomad');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.locator('.confirm-box.plain')).toContainText('Import another copy?');
  await expect(page.locator('.confirm-box.plain')).toContainText('My Aang (same cards)');
  await answerDialog(page, false);
  await page.getByText('← Decks').click();
  await expect(page.locator('.deck-row', { hasText: 'Aang' })).toHaveCount(2); // the deck and its token deck
  await page.locator('.deck-row', { hasText: 'My Aang · tokens' }).click();
  await page.locator('.page').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.confirm-box.plain')).toContainText('These decks use its tokens');
  await expect(page.locator('.confirm-box.plain')).toContainText('My Aang');
  await answerDialog(page, true);
  await expect(page.locator('.deck-row', { hasText: 'My Aang · tokens' })).toHaveCount(0);
});

test('the starter pack downloads all ten decks; players can share a deck; every player needs one', async ({ page }) => {
  test.setTimeout(120_000);
  await mockScryfall(page);
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Decks' }).click();
  await page.getByText('Download all 10 decks').click();
  await expect(page.getByText('All 10 decks are on this device')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.deck-row', { hasText: 'Avatar BB:' })).toHaveCount(10); // the mock gives these cards no tokens, so no token deck
  await page.getByText('← Home').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Avatar BB: Allies', 'Avatar BB: Waterbending'], ['Avatar BB: Allies', 'Avatar BB: Waterbending']]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');
  // both players got the same two decks: equal libraries, seven cards each in hand
  const mine = Number(await page.locator('.c33 .slot-label b').innerText());
  expect(mine).toBeGreaterThan(20);
  await expect(page.locator('.c23 .slot-label b')).toHaveText(String(mine));
  await expect(page.locator('.c52 [data-card]')).toHaveCount(7);
});

test('Jumpstart: pick two half-decks, download them, and play them as one deck', async ({ page }) => {
  test.setTimeout(120_000);
  await mockScryfall(page);
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Decks' }).click();
  const js = page.locator('.notice.starter', { hasText: 'Avatar: The Last Airbender Jumpstart' });
  await js.getByRole('button', { name: 'Choose decks' }).click();
  await expect(js.locator('.starter-group-name')).toHaveText(['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor']);
  await expect(js.locator('.deck-check')).toHaveCount(66);
  await expect(js.getByRole('button', { name: 'Download 0 selected' })).toBeDisabled();
  await js.locator('.deck-check', { hasText: /^Zuko$/ }).click();
  await js.locator('.deck-check', { hasText: 'Firebending (1)' }).click();
  await js.getByRole('button', { name: 'Download 2 selected' }).click();
  await expect(page.locator('.deck-row', { hasText: 'Avatar JS:' })).toHaveCount(2, { timeout: 60_000 });
  await expect(js.locator('.deck-check.here')).toHaveCount(2);
  await expect(js.getByRole('button', { name: 'Download the remaining 64' })).toBeVisible();
  await page.getByText('← Home').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Avatar JS: Zuko', 'Avatar JS: Firebending (1)'], ['Sample: Grove']]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');
  await expect(page.locator('.c33 .slot-label b')).toHaveText('33'); // 40 cards, 7 in hand
});

test('starting needs a deck for every player', async ({ page }) => {
  await page.goto('index.html');
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Sample: Ember (red)'], []]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.error')).toBeVisible();
  await expect(page.locator('.board')).toHaveCount(0);
  await page.getByText('Host (two devices)').click();
  await pickDecks(page, [[]]);
  await page.getByText('Next: pair the guest').click();
  await expect(page.locator('.error')).toBeVisible();
});

test('the board uses the small image, the full view the large one, and a double-faced card flips', async ({ page }) => {
  await mockScryfall(page);
  await importDeck(page, 'Size Test', [1, 2, 4, 5, 6, 7, 8].map((i) => `5 Test Card ${i}`).join('\n') + '\n4 Front 3');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await page.getByText('← Decks').click();
  await page.getByText('← Home').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Size Test'], ['Size Test']]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');
  const natural = (sel: string) => page.locator(sel).first().evaluate(async (i: HTMLImageElement) => { await i.decode().catch(() => {}); return i.naturalWidth; });
  await expect.poll(() => natural('.c52 img')).toBe(146);
  await longPress(page, page.locator('.c52 [data-card]').first());
  await expect.poll(() => natural('.fullcard img')).toBe(672);
  await barButton(page, 'Close');
});

test('the deck page viewer: next card, flip a double-faced card, close', async ({ page }) => {
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Decks' }).click();
  await page.getByText('Sample: Ember (red)').click();
  await page.locator('.deck-card').first().click();
  await expect(page.locator('.deck-viewer')).toBeVisible();
  const first = await page.locator('.deck-viewer-name').innerText();
  await page.locator('[aria-label="Next card"]').click();
  await expect(page.locator('.deck-viewer-name')).not.toHaveText(first);
  for (let i = 0; i < 12 && !(await page.locator('.deck-viewer-bar').getByText('Flip').count()); i++) await page.locator('[aria-label="Next card"]').click();
  const src1 = await page.locator('.deck-viewer img').getAttribute('src');
  await page.locator('.deck-viewer-bar').getByText('Flip').click();
  expect(await page.locator('.deck-viewer img').getAttribute('src')).not.toBe(src1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.deck-viewer')).toHaveCount(0);
  await page.locator('.deck-card').nth(2).click();
  await page.locator('.deck-viewer-img').click();
  await expect(page.locator('.deck-viewer')).toHaveCount(0);
});

test('a deck saved without card text is flagged until deleted; deleting it removes its cards', async ({ page }) => {
  const errs = watchErrors(page);
  await mockScryfall(page);
  await importDeck(page, 'Old Import', '1 Badgermole\n10 Plains');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  // make it look like a version 1 import: Scryfall cards without text
  const count = (store: string) => page.evaluate((s) => new Promise<number>((res) => {
    const r = indexedDB.open('mtg-tabletop');
    r.onsuccess = () => { const q = r.result.transaction(s).objectStore(s).count(); q.onsuccess = () => { r.result.close(); res(q.result); }; };
  }), store);
  await page.evaluate(() => new Promise<void>((res) => {
    const r = indexedDB.open('mtg-tabletop');
    r.onsuccess = () => {
      const tx = r.result.transaction('defs', 'readwrite');
      const st = tx.objectStore('defs');
      const all = st.getAll();
      all.onsuccess = () => { for (const d of all.result) if (d.scryfallId) { delete d.text; st.put(d); } };
      tx.oncomplete = () => { r.result.close(); res(); };
    };
  }));
  const defsBefore = await count('defs');
  await page.goto('./');
  await expect(page.locator('.notice.warn')).toContainText('1 deck was imported before card text was saved: Old Import');
  await page.locator('.notice.warn').getByRole('button', { name: 'Decks' }).click();
  const row = page.locator('.deck-row', { hasText: 'Old Import' }).first();
  await expect(row.locator('.reimport-tag')).toHaveText('needs re-import');
  await expect(page.locator('.deck-row', { hasText: 'Sample' }).locator('.reimport-tag')).toHaveCount(0);
  await row.click();
  await page.locator('.page').getByRole('button', { name: 'Delete' }).click();
  await answerDialog(page, true);
  await expect(page.locator('.deck-row', { hasText: 'Old Import' })).toHaveCount(0);
  expect(await count('defs')).toBeLessThan(defsBefore);
  await page.getByText('← Home').click();
  await expect(page.locator('.notice.warn')).toHaveCount(0);
  errs.expectNone();
});
