import { test, expect } from '@playwright/test';
import { barButton, startOneDevice, watchErrors } from './helpers';

// A footer button that opens a sheet closes it again on a second tap, so a mistaken tap in the
// crowded footer is undone where it was made.
test('Tokens, Mana, Dice, Menu and the ticker: a second tap closes the sheet it opened', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const sheet = page.locator('.sheet');
  for (const name of ['Tokens', 'Mana', 'Dice', 'Menu']) {
    const button = page.locator('.bar').first().getByRole('button', { name, exact: true });
    await barButton(page, name);
    await expect(sheet).toHaveCount(1);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await barButton(page, name);
    await expect(sheet).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
  // the ticker opens Recent actions, and a second tap closes it
  const ticker = page.locator('.ticker-text');
  await ticker.click();
  await expect(sheet).toHaveAttribute('aria-label', 'Recent actions');
  await expect(ticker).toHaveAttribute('aria-pressed', 'true');
  await ticker.click();
  await expect(sheet).toHaveCount(0);
  // another footer button switches straight to its sheet
  await barButton(page, 'Tokens');
  await barButton(page, 'Mana');
  await expect(sheet).toHaveAttribute('aria-label', 'Mana');
  errs.expectNone();
});
