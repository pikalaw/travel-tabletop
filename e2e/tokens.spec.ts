import { test, expect, type Page } from '@playwright/test';
import { mockScryfall, importDeck, pickDecks, unblind, longPress, barButton, drag, startOneDevice, watchErrors } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

/** A mouse gesture on the viewer's picture, from its centre by (dx, dy); `to` continues to a slot. */
async function gesture(page: Page, dx: number, dy: number, to?: string) {
  const r = (await page.locator('.deck-viewer-img').boundingBox())!;
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  if (to) {
    const b = (await page.locator(`[data-drop="${to}"]`).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  }
  await page.mouse.up();
}

test('the Tokens sheet: one list of the tokens for the decks in play, sorted by name; long-press shows one full screen', async ({ page }) => {
  const errs = watchErrors(page);
  await mockScryfall(page, { tokens: { 'Aang, Air Nomad': ['Ally', 'Spirit'], Badgermole: ['Clue'] } });
  await importDeck(page, 'Aang', '2 Aang, Air Nomad\n18 Plains');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await importDeck(page, 'Badger', '2 Badgermole\n18 Forest');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await page.getByText('← Decks').click();
  await page.getByText('← Home').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Aang'], ['Aang']]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');

  // only the Aang deck's tokens: not the other deck's Clue, not the sample decks' basic tokens
  await barButton(page, 'Tokens');
  const items = page.locator('.sheet .token-item');
  await expect(items).toHaveCount(2);
  expect(await items.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tokenName))).toEqual(['Ally', 'Spirit']);
  await expect(page.locator('.sheet .token-grid')).toHaveCount(1);

  // long-press: full screen, next goes to the other token, Escape closes back to the sheet
  await longPress(page, items.nth(0));
  const viewer = page.locator('.deck-viewer');
  await expect(viewer).toBeVisible();
  await expect(page.locator('.deck-viewer-name')).toContainText('Ally');
  await page.locator('[aria-label="Next card"]').click();
  await expect(page.locator('.deck-viewer-name')).toContainText('Spirit');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('.sheet .token-item')).toHaveCount(2);

  // the full view's gestures: swipe left for the next token, right for the previous, down to close
  await longPress(page, items.nth(0));
  await gesture(page, -120, 0);
  await expect(page.locator('.deck-viewer-name')).toContainText('Spirit');
  await gesture(page, 120, 0);
  await expect(page.locator('.deck-viewer-name')).toContainText('Ally');
  await gesture(page, 0, 120);
  await expect(viewer).toHaveCount(0);
  // drag up: back to the board with the token, dropped on a slot it is created there
  await longPress(page, items.nth(1));
  await gesture(page, 0, -80, 'p1.lands');
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('[data-drop="p1.lands"] [data-card]')).toHaveCount(1);
  await expect(page.locator('.ticker-text')).toContainText('created Spirit');
  // a tap creates nothing (it says to drag); a drag onto a battlefield creates the token there
  await items.nth(0).click();
  await expect(page.locator('.toast')).toContainText('Drag a token onto a battlefield');
  await expect(page.locator('[data-drop="p1.battlefield"] [data-card]')).toHaveCount(0);
  await drag(page, items.nth(0), page.locator('[data-drop="p1.battlefield"]'));
  await expect(page.locator('[data-drop="p1.battlefield"] [data-card]')).toHaveCount(1);
  errs.expectNone();
});

test('a sample-deck game offers the basic tokens', async ({ page }) => {
  await startOneDevice(page);
  await barButton(page, 'Tokens');
  await expect(page.locator('.sheet .token-item').first()).toBeVisible();
  await expect(page.locator('.sheet')).not.toContainText('No tokens');
});
