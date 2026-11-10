import { test, expect, type Page } from '@playwright/test';
import { startOneDevice, resetBar, answerDialog, unblind, watchErrors } from './helpers';

async function menu(page: Page, item: string) {
  await resetBar(page);
  await page.locator('.bar [aria-label="Menu"]').click();
  await page.getByText(item, { exact: true }).click();
}

test('finished games: listed under games in progress, open with their result, undo to continue, delete all', async ({ page }) => {
  const errs = watchErrors(page);
  // one game left in progress, then one finished
  await startOneDevice(page);
  await menu(page, 'Leave to home screen');
  // the finished one has a name
  await page.getByRole('button', { name: 'New game' }).click();
  await expect(page.locator('.deck-check.on').first()).toBeVisible();
  await page.getByLabel(/Game name/).fill('Friday match');
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board'); await unblind(page, 'Player 1');
  await menu(page, 'Player 1 concedes'); await answerDialog(page, true);
  await expect(page.locator('.result-banner')).toContainText('Player 2 wins');
  await menu(page, 'Leave to home screen');

  const sections = page.locator('h2');
  await expect(sections).toHaveText(['Games in progress', 'Finished games']);
  const finished = page.locator('.game-list').nth(1).locator('li');
  await expect(finished).toHaveCount(1);
  await expect(finished.first().locator('.game-title')).toHaveText('Friday match');
  await expect(finished.first().locator('.game-detail')).toContainText('Player 1 vs Player 2');
  await expect(finished.first()).toContainText('Player 2 won (concession)');
  await expect(finished.first().locator('.winner')).toHaveText('Player 2');
  expect(await finished.first().locator('.winner').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(232, 194, 90)');
  // an unnamed game is titled by its players
  await expect(page.locator('.game-list').first().locator('.game-title')).toHaveText('Player 1 vs Player 2');
  await page.screenshot({ path: 'test-results/finished-home.png' });

  // open it: the result shows; undo continues the game, which goes back to games in progress
  await finished.first().getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.result-banner')).toContainText('Player 2 wins');
  await resetBar(page); await page.locator('.bar').first().getByRole('button', { name: 'Undo', exact: true }).click(); await answerDialog(page, true);
  await expect(page.locator('.result-banner')).toHaveCount(0);
  await menu(page, 'Leave to home screen');
  await expect(page.locator('h2')).toHaveText(['Games in progress']);
  await expect(page.locator('.game-list li')).toHaveCount(2);
  // the game played last is listed first: undoing the end is play
  await expect(page.locator('.game-list li').first().locator('.game-title')).toHaveText('Friday match');

  // finish it again, then delete all finished games
  await page.locator('.game-list li').first().getByRole('button', { name: 'Resume' }).click();
  await page.waitForSelector('.board');
  await menu(page, 'Player 1 concedes'); await answerDialog(page, true);
  await menu(page, 'Leave to home screen');
  await page.getByRole('button', { name: 'Delete all' }).click();
  await expect(page.locator('.dialog, [role="dialog"]').first()).toContainText('Delete the finished game?');
  await answerDialog(page, true);
  await expect(page.locator('h2')).toHaveText(['Games in progress']);
  await expect(page.locator('.game-list li')).toHaveCount(1);
  errs.expectNone();
});
