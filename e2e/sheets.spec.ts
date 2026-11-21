import { test, expect } from '@playwright/test';
import { startOneDevice, watchErrors, barButton, resetBar } from './helpers';

test('the game menu is centred on the board, fits its items, and has no Pass the turn (the footer has it)', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page); // Player 1 is active and looking
  await page.locator('.bar [aria-label="Menu"]').scrollIntoViewIfNeeded();
  await page.locator('.bar [aria-label="Menu"]').click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Game menu');
  await expect(sheet.getByText('Pass the turn')).toHaveCount(0);
  const board = (await page.locator('.board-wrap').boundingBox())!;
  const box = (await sheet.boundingBox())!;
  const mid = (y: number, h: number) => y + h / 2;
  expect(Math.abs(mid(box.y, box.height) - mid(board.y, board.height))).toBeLessThan(3);
  // every item shows in full: the body does not scroll
  expect(await sheet.locator('.sheet-body').evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(1);
  errs.expectNone();
});

test('a sheet cards are dragged out of stays at the top, leaving the bottom half of the board free to drop on', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await page.locator('.ticker-text').click(); // the log: centred
  await expect(page.locator('.sheet.center')).toHaveCount(1);
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).click();
  await resetBar(page); await barButton(page, 'Tokens'); // a sheet cards are dragged out of
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Tokens');
  await expect(sheet).not.toHaveClass(/\bcenter\b/);
  const board = (await page.locator('.board-wrap').boundingBox())!;
  expect((await sheet.boundingBox())!.y - board.y).toBeLessThan(10);
  errs.expectNone();
});
