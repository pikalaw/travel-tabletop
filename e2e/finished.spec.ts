import { test, expect, type Page } from '@playwright/test';
import { startOneDevice, resetBar, answerDialog, watchErrors } from './helpers';

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
  await startOneDevice(page);
  await menu(page, 'Player 1 concedes'); await answerDialog(page, true);
  await expect(page.locator('.result-banner')).toContainText('Player 2 wins');
  await menu(page, 'Leave to home screen');

  const sections = page.locator('h2');
  await expect(sections).toHaveText(['Games in progress', 'Finished games']);
  const finished = page.locator('.game-list').nth(1).locator('li');
  await expect(finished).toHaveCount(1);
  await expect(finished.first()).toContainText('Player 2 won (concession)');
  await page.screenshot({ path: 'test-results/finished-home.png' });

  // open it: the result shows; undo continues the game, which goes back to games in progress
  await finished.first().getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.result-banner')).toContainText('Player 2 wins');
  await resetBar(page); await page.locator('.bar').first().getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.result-banner')).toHaveCount(0);
  await menu(page, 'Leave to home screen');
  await expect(page.locator('h2')).toHaveText(['Games in progress']);
  await expect(page.locator('.game-list li')).toHaveCount(2);
  // the game opened last is listed first
  await expect(page.locator('.game-list li').first()).toContainText('turn 1');

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
