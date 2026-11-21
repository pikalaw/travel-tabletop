import { test, expect } from '@playwright/test';
import { barButton, startOneDevice, watchErrors } from './helpers';

// A footer button that opens a sheet closes it again on a second tap, so a mistaken tap in the
// crowded footer is undone where it was made.
test('Tokens, Mana, Dice and Menu: a second tap on the button closes its sheet', async ({ page }) => {
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
  // another footer button switches straight to its sheet
  await barButton(page, 'Tokens');
  await barButton(page, 'Mana');
  await expect(sheet).toHaveAttribute('aria-label', 'Mana');
  errs.expectNone();
});
