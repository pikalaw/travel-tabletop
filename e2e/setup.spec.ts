import { test, expect } from '@playwright/test';
import { unblind, watchErrors } from './helpers';

test('New game: swap who goes first exchanges the players’ names and decks, and is remembered', async ({ page }) => {
  const errs = watchErrors(page);
  await page.goto('index.html');
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.locator('.deck-check.on').first()).toBeVisible();
  const forms = page.locator('.player-form');
  await forms.nth(0).getByLabel('Name').fill('Ann');
  await forms.nth(1).getByLabel('Name').fill('Bo');
  const picks = async (i: number) => (await forms.nth(i).locator('.deck-check.on').allInnerTexts()).sort();
  const before = [await picks(0), await picks(1)];

  await page.getByRole('button', { name: '⇅ Swap who goes first' }).click();
  await expect(forms.nth(0).getByLabel('Name')).toHaveValue('Bo');
  await expect(forms.nth(1).getByLabel('Name')).toHaveValue('Ann');
  expect([await picks(0), await picks(1)]).toEqual([before[1], before[0]]);

  // Bo, now Player 1, takes the first turn
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await expect(page.locator('.turn-label')).toContainText('Bo', { ignoreCase: true });
  await unblind(page, 'Bo');

  // the swap is remembered for the next game, like the rest of the setup
  await page.goto('index.html');
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(forms.nth(0).getByLabel('Name')).toHaveValue('Bo');
  errs.expectNone();
});
