import { test, expect } from '@playwright/test';
import { mockScryfall, importDeck, pickDecks, unblind, longPress, barButton, answerDialog, watchErrors } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

const RULINGS = [
  { source: 'wotc', published_at: '2024-11-08', comment: 'If the creature leaves the battlefield, the ability still resolves.' },
  { source: 'scryfall', published_at: '2025-01-02', comment: 'This card’s mana ability does not use the stack.' },
];

test('rulings: a card with rulings links to a panel over the full view; swipe down or Back returns', async ({ page }) => {
  const errs = watchErrors(page);
  const calls = await mockScryfall(page, { oracle: { 'Elf Test': '{T}: Add {G}.' }, rulings: { 'Elf Test': RULINGS } });
  await importDeck(page, 'Rulings', '10 Elf Test\n10 Bear Test');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  expect(calls.rulings).toBe(2); // once per unique card
  await page.getByText('← Decks').click();
  await page.getByText('← Home').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Rulings'], ['Rulings']]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');
  const hand = page.locator('[data-drop="p1.hand"] [data-card]');
  const alts = await hand.evaluateAll((els) => els.map((e) => e.querySelector('img')?.getAttribute('alt')));
  const elf = alts.indexOf('Elf Test'), bear = alts.indexOf('Bear Test');
  test.skip(elf < 0 || bear < 0, 'the opening hand lacks one of the two cards');

  // a card without rulings has no link
  await longPress(page, hand.nth(bear));
  await expect(page.locator('.fullcard-meta b')).toHaveText('Bear Test');
  await expect(page.locator('.rulings-link')).toHaveCount(0);
  await barButton(page, 'Close');

  await longPress(page, hand.nth(elf));
  await page.locator('.rulings-link').click();
  const panel = page.locator('.rulings-panel');
  await expect(panel.locator('.rulings-head b')).toHaveText('Rulings: Elf Test');
  await expect(panel.locator('.rulings-face')).toContainText('{T}: Add {G}.');
  await expect(panel.locator('.rulings-list li')).toHaveCount(2);
  await expect(panel.locator('.rulings-list li').nth(0)).not.toContainText('unofficial');
  await expect(panel.locator('.rulings-list li').nth(1)).toContainText('Scryfall note (unofficial)');
  // a swipe down on its header closes it, leaving the full view open
  const r = (await panel.locator('.rulings-head').boundingBox())!;
  await page.mouse.move(r.x + r.width / 3, r.y + r.height / 2); await page.mouse.down();
  await page.mouse.move(r.x + r.width / 3, r.y + r.height / 2 + 120, { steps: 6 }); await page.mouse.up();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.fullcard')).toHaveCount(1);
  // and Back does too
  await page.locator('.rulings-link').click();
  await panel.getByRole('button', { name: 'Back' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.fullcard')).toHaveCount(1);
  errs.expectNone();
});

test('Delete all decks: removes every deck but the built-in ones, and their cards', async ({ page }) => {
  const errs = watchErrors(page);
  await mockScryfall(page);
  for (const [name, list] of [['One', '20 Bear Test'], ['Two', '20 Wolf Test']]) {
    await importDeck(page, name!, list!);
    await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  }
  await page.getByText('← Decks').click();
  const rows = page.locator('.deck-row');
  await expect(page.locator('.deck-row', { hasText: 'Two' })).toHaveCount(1); // the list has loaded
  const before = await rows.count();
  const defs = () => page.evaluate(() => new Promise<number>((res) => {
    const r = indexedDB.open('mtg-tabletop');
    r.onsuccess = () => { const q = r.result.transaction('defs').objectStore('defs').count(); q.onsuccess = () => { r.result.close(); res(q.result); }; };
  }));
  const defsBefore = await defs();
  await page.getByRole('button', { name: 'Delete all decks' }).click();
  await expect(page.locator('.confirm-box.plain')).toContainText('Delete all 2 decks?');
  await answerDialog(page, true);
  await expect(rows).toHaveCount(before - 2);
  await expect(page.locator('.deck-row', { hasText: 'Sample' })).toHaveCount(2);
  await expect(page.locator('.deck-row', { hasText: 'Basic tokens' })).toHaveCount(1);
  expect(await defs()).toBe(defsBefore - 2);
  // nothing left to delete: no button
  await expect(page.getByRole('button', { name: 'Delete all decks' })).toHaveCount(0);
  errs.expectNone();
});

test('the deck page viewer links to the rulings too; Escape closes the panel, then the viewer', async ({ page }) => {
  const errs = watchErrors(page);
  await mockScryfall(page, { oracle: { 'Elf Test': '{T}: Add {G}.' }, rulings: { 'Elf Test': RULINGS } });
  await importDeck(page, 'Elves', '20 Elf Test');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await page.getByText('← Decks').click();
  await page.locator('.deck-row', { hasText: 'Elves' }).first().click();
  await page.locator('.deck-card').first().click();
  const viewer = page.locator('.deck-viewer');
  await viewer.locator('.rulings-link').click();
  const panel = viewer.locator('.rulings-panel');
  await expect(panel.locator('.rulings-head b')).toHaveText('Rulings: Elf Test');
  await expect(panel.locator('.rulings-list li')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  errs.expectNone();
});
