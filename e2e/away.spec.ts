import { test, expect } from '@playwright/test';
import { startOneDevice, playFromHand, barButton, resetBar, unblind, watchErrors } from './helpers';

test('one device: unblinding goes straight to the board, with no "while you were away" list; the log has every action', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page); // Player 1 is looking
  await playFromHand(page, 'p1.battlefield', 1);
  await resetBar(page); await barButton(page, 'Blind my hand');

  // Player 2 unblinds: no sheet over the board
  await unblind(page, 'Player 2');
  await expect(page.locator('.sheet')).toHaveCount(0);
  // the log still lists Player 1's play
  await page.locator('.ticker-text').click();
  await expect(page.locator('.sheet .log-list')).toContainText(/→ their battlefield/);
  errs.expectNone();
});
