import { test, expect } from '@playwright/test';
import { startOneDevice, resetBar, answerDialog } from './helpers';

const tail = (u: string) => u.split('/').pop();

test('game links: format, reopening, hash changes, other devices, ended and malformed links', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await startOneDevice(page, { unblindTo: null });
  const url = page.url();
  expect(url).toMatch(/#game=\d{4}-\d\d-\d\d-[0-9a-z]{16}$/);

  await page.locator('.bar [aria-label="Menu"]').click();
  await page.getByText('Leave to home screen').click();
  await expect(page).not.toHaveURL(/#game=/);

  // the same device opens the link: the board comes back
  await page.goto('about:blank'); await page.goto(url);
  await page.waitForSelector('.board');
  expect(tail(page.url())).toBe(tail(url));

  // another link put in the hash mid-game does not take over
  await page.evaluate(() => { location.hash = '#game=2026-01-01-zzzzzzzzzzzzzzzz'; });
  await page.waitForTimeout(400);
  await expect(page.locator('.board')).toHaveCount(1);
  expect(tail(page.url())).toBe(tail(url));

  // another device with the same link: a warning, no board
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto(url);
  await expect(other.locator('.notice.warn')).toBeVisible();
  await expect(other.locator('.board')).toHaveCount(0);
  await ctx.close();

  // end the game, then open its link: a notice
  await resetBar(page);
  await page.locator('.bar [aria-label="Menu"]').click();
  await page.getByText('Player 1 concedes').click();
  await answerDialog(page, true);
  await page.goto('about:blank'); await page.goto(url);
  await expect(page.locator('.notice.warn')).toBeVisible();

  // a malformed link goes home
  await page.goto('index.html#game=<bad>');
  await expect(page.getByRole('button', { name: 'New game' })).toBeVisible();
  expect(errors).toEqual([]);
});
