import { test, expect } from '@playwright/test';
import { mockScryfall, importDeck, pickDecks, unblind, longPress, barButton, startOneDevice, watchErrors } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

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
  // a tap still adds the token to the player's battlefield
  await items.nth(0).click();
  await expect(page.locator('[data-drop="p1.battlefield"] [data-card]')).toHaveCount(1);
  errs.expectNone();
});

test('a sample-deck game offers the basic tokens', async ({ page }) => {
  await startOneDevice(page);
  await barButton(page, 'Tokens');
  await expect(page.locator('.sheet .token-item').first()).toBeVisible();
  await expect(page.locator('.sheet')).not.toContainText('No tokens');
});
