import { test, expect } from '@playwright/test';
import { startOneDevice, playFromHand, idsIn, drag, barButton, resetBar, unblind, watchErrors } from './helpers';

test('one device: unblinding lists every action by the other player since you last looked, alerts highlighted', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page); // Player 1 is looking
  // Player 1 draws, plays a creature, and puts +1/+1 on it
  await page.locator('.c33 .pile').click();
  await page.getByRole('button', { name: 'Draw 1' }).click();
  await barButton(page, 'Done');
  await playFromHand(page, 'p1.battlefield', 1);
  const [a] = await idsIn(page, 'p1.battlefield');
  await resetBar(page);
  const chip = page.locator('[data-counter="plus"]');
  await chip.scrollIntoViewIfNeeded();
  await drag(page, chip, page.locator(`[data-card="${a}"]`));
  await expect(page.locator(`[data-card="${a}"] [data-badge="plus"]`)).toHaveCount(1);
  await resetBar(page); await barButton(page, 'Blind my hand');

  // Player 2 unblinds: all three actions are listed, not only the draw
  await unblind(page, 'Player 2');
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('While Player 2 was away');
  const items = sheet.locator('.log-list li');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText(/drew 1 card/);
  await expect(items.nth(1)).toContainText(/→ their battlefield/);
  await expect(items.nth(2)).toContainText(/\+1\/\+1 counter/);
  await sheet.getByRole('button', { name: 'Done' }).click().catch(async () => { await page.mouse.click(8, 8); });

  // Player 1 comes back: nothing Player 1 did is listed, and nothing happened since, so no sheet
  await resetBar(page); await barButton(page, 'Blind my hand');
  await unblind(page, 'Player 1');
  await expect(page.locator('.sheet')).toHaveCount(0);
  errs.expectNone();
});
