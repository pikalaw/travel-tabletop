import { test, expect } from '@playwright/test';
import { startOneDevice, playFromHand, watchErrors } from './helpers';

test('a resumed game\'s log sheet shows what happened before', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 2);
  const before = await page.locator('.ticker-text').innerText();
  // leave and come back from the home screen, as after stepping away (nothing kept in memory)
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Resume' }).first().click();
  await page.waitForSelector('.board');
  // the ticker shows the last action, and the log sheet lists the earlier ones
  await expect(page.locator('.ticker-text')).toHaveText(before);
  await page.locator('.ticker-text').click();
  const sheet = page.locator('.sheet');
  // newest first, back to the start of the game
  const items = sheet.locator('.log-list li');
  await expect(items.first()).toContainText(before);
  await expect(items.last()).toContainText('New game');
  // numbered turn.n; the game's start is a turn start, set apart and unnumbered
  await expect(items.last()).toHaveClass(/turn-start/);
  await expect(items.last().locator('.num')).toHaveCount(0);
  await expect(items.first().locator('.num')).toHaveText(/^1\.\d+$/);
  await page.screenshot({ path: 'test-results/log-sheet.png' });
  errs.expectNone();
});
