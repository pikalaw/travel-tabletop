import { test, expect } from '@playwright/test';
import { barButton, drag, startOneDevice, answerDialog, watchErrors } from './helpers';

// Token expiry (protocol 10): a token made to last until end of combat goes at End combat and
// comes back with Undo; one made to last until end of turn survives End combat and goes at Pass turn.
test('expiring tokens: end of combat goes at End combat, back with Undo; end of turn goes at Pass turn', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const field = page.locator('[data-drop="p1.battlefield"] [data-card]');
  const bar = page.locator('.bar').first();

  // no marks and no such tokens: no End combat button
  await expect(bar.getByRole('button', { name: 'End combat', exact: true })).toHaveCount(0);

  await barButton(page, 'Tokens');
  const sheet = page.locator('.sheet');
  await expect(sheet.getByRole('radio', { name: 'Stays' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('radio', { name: 'End of combat' }).click();
  await drag(page, sheet.locator('.token-item').first(), page.locator('[data-drop="p1.battlefield"]'));
  await sheet.getByRole('radio', { name: 'End of turn' }).click();
  await drag(page, sheet.locator('.token-item').first(), page.locator('[data-drop="p1.battlefield"]'));
  await expect(field).toHaveCount(2);
  await expect(page.locator('.ticker-text')).toContainText('(until end of turn)');
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.board .mark.expiry[aria-label="expires end of combat"]')).toHaveCount(1);
  await expect(page.locator('.board .mark.expiry[aria-label="expires end of turn"]')).toHaveCount(1);

  // End combat shows for the combat token, asks, and removes only it
  await barButton(page, 'End combat');
  await expect(page.locator('.confirm-box.plain')).toContainText('This removes 1 token.');
  await answerDialog(page, true);
  await expect(field).toHaveCount(1);
  await expect(page.locator('.ticker-text')).toContainText('ended combat; 1 token expired');
  await expect(bar.getByRole('button', { name: 'End combat', exact: true })).toHaveCount(0);

  // one Undo brings it back
  await barButton(page, 'Undo');
  await expect(field).toHaveCount(2);

  // Pass turn removes both
  await barButton(page, 'Pass turn');
  await answerDialog(page, true);
  await expect(field).toHaveCount(0);
  errs.expectNone();
});
