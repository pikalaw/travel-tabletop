import { test, expect } from '@playwright/test';
import { startOneDevice, playFromHand, idsIn, longPress, barButton, resetBar, answerDialog, unblind, watchErrors } from './helpers';

test('power and toughness this turn: steppers and typing in the full view, a dashed badge on the board, gone when the turn passes', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield');
  const [a] = await idsIn(page, 'p1.battlefield');
  const card = page.locator(`.board [data-card="${a}"]`);
  await longPress(page, card);
  const row = page.locator('.fullcard .turn-pt');
  await expect(row).toContainText('This turn');
  const power = row.locator('[data-pt="power"]'), toughness = row.locator('[data-pt="toughness"]');
  await expect(power.locator('.pt-val')).toHaveText('+0');
  await power.getByRole('button', { name: 'Power +1' }).click();
  await power.getByRole('button', { name: 'Power +1' }).click();
  await toughness.getByRole('button', { name: 'Toughness −1' }).click();
  await expect(power.locator('.pt-val')).toHaveText('+2');
  await expect(toughness.locator('.pt-val')).toHaveText('−1');
  await expect(page.locator('.ticker')).toContainText('+0/−1 this turn (now +2/−1)');
  // typing a value, with a minus sign
  await power.locator('.pt-val').click();
  await page.locator('.dialog-input').fill('-3');
  await answerDialog(page, true);
  await expect(power.locator('.pt-val')).toHaveText('−3');
  await barButton(page, 'Close');
  await expect(card.locator('.badge.pt')).toHaveText('−3/−1');
  // not on a card out of play: no steppers there
  await longPress(page, page.locator('[data-drop="p1.hand"] [data-card]').first(), 0.4, 0.4);
  await expect(page.locator('.fullcard .turn-pt')).toHaveCount(0);
  await barButton(page, 'Close');

  // the Tokens button is in the combat footer too
  await resetBar(page); await barButton(page, 'Combat');
  await expect(page.locator('.bar.combat [aria-label="Tokens"]')).toHaveCount(1);
  await barButton(page, 'Pause');

  // until end of turn: passing the turn clears it
  await resetBar(page); await barButton(page, 'Pass turn');
  await answerDialog(page, true);
  await unblind(page, 'Player 1');
  await expect(page.locator('.board .badge.pt')).toHaveCount(0);
  errs.expectNone();
});
