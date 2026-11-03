import { test, expect } from '@playwright/test';
import { unblind } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

test('after one visit the app works offline: reload, start a game, card images load', async ({ page, context }) => {
  await page.goto('index.html');
  await page.getByRole('button', { name: 'New game' }).waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).waitFor();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll('.board img')].filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0).length,
  )).toBeGreaterThan(0);
});
