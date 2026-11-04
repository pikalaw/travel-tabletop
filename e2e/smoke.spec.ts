import { test, expect } from '@playwright/test';
import { drag, longPress, startOneDevice, unblind, barButton, watchErrors } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

test('a one-device game: play, tap, counters, library, undo, full view, peek, tokens, life, blind', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const hand = page.locator('.c52 [data-card]');
  const field = page.locator('.c32 [data-card]');
  const n0 = await hand.count();
  expect(n0).toBe(7);

  await drag(page, hand.first(), page.locator('.c32 .row'));
  await expect(hand).toHaveCount(6);
  await expect(field).toHaveCount(1);

  await field.first().click();
  await expect(page.locator('.c32 .card.tapped')).toHaveCount(1);

  await drag(page, '.chip.plus', field.first());
  await expect(page.locator('.c32 .badge.plus')).toHaveText('+1');

  // library footer: draw 2
  await page.locator('.c33 .pile').click();
  await page.locator('.bar').getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Draw 2' }).click();
  await expect(hand).toHaveCount(8);
  await barButton(page, 'Done');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(hand).toHaveCount(6);

  // hold above the card's counter badge, which covers its middle on a small card
  await longPress(page, field.first(), 0.5, 0.2);
  await expect(page.locator('.fullcard')).toHaveCount(1);
  await page.getByRole('button', { name: 'Flip' }).click();
  await barButton(page, 'Close');

  // look at the top 3, move one to the graveyard
  await page.locator('.c33 .pile').click();
  const plus = page.locator('.bar').getByRole('button', { name: '+' });
  await plus.click(); await plus.click();
  await page.getByRole('button', { name: 'Look at top 3' }).click();
  await expect(page.locator('.sheet [data-card]')).toHaveCount(3);
  await drag(page, page.locator('.sheet [data-card]').first(), page.locator('.c43 .pile'));
  await expect(page.locator('.c43 .slot-label b')).toHaveText('1');
  await expect(page.locator('.sheet [data-card]')).toHaveCount(2);
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).click();
  await barButton(page, 'Done');

  // tokens: create by drag, remove by dragging onto the Tokens button
  await barButton(page, 'Tokens');
  await drag(page, '.token-item', page.locator('.c32 .row'), { fy: 0.85 });
  await expect(page.locator('.c32 .mark.token')).toHaveCount(1);
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).click();
  await drag(page, page.locator('.c32 .card:has(.mark.token)'), page.locator('.token-btn'));
  await expect(page.locator('.c32 .mark.token')).toHaveCount(0);

  // player counters
  await page.locator('.counters-cell').click();
  await page.locator('.ctr-panel.p1 .ctr-row').getByRole('button', { name: '−' }).first().click();
  await expect(page.locator('.ctr-panel.p1 .ctr-val').first()).toHaveText('19');
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).click();

  // blind, then unblind to Player 2: the board switches to their side
  await barButton(page, 'Blind my hand');
  await unblind(page, 'Player 2');
  await expect(page.locator('.c32 .slot-label')).toContainText('Player 2');
  errs.expectNone();
});
