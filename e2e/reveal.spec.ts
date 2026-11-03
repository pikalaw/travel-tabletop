import { test, expect } from '@playwright/test';
import { longPress, startOneDevice, startTwoDevices, barButton } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

test('one device: Reveal blinds the hand and shows only that card', async ({ page }) => {
  await startOneDevice(page);
  await longPress(page, page.locator('.c52 [data-card]').first());
  const bg = await page.locator('.full-wrap').evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).not.toMatch(/rgba\(.*, 0\)$/); // opaque: the board never shows behind it
  await barButton(page, 'Reveal');
  await expect(page.locator('.reveal-screen')).toHaveCount(1);
  await expect(page.locator('.reveal-screen img')).toHaveCount(1);
  await expect(page.locator('.c52 .slot-label')).toContainText('hidden', { ignoreCase: true });
  await page.locator('.reveal-screen').click();
  await expect(page.locator('.reveal-screen')).toHaveCount(0);
  await expect(page.locator('.c52 .mark.rev')).toHaveCount(0); // a reveal is an event, not a lasting mark
});

test('two devices: the revealed card pops up on the other device each time', async ({ browser }) => {
  const H = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  const G = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  await startTwoDevices(H, G);
  const name = await H.locator('.c52 [data-card] img').first().getAttribute('alt');
  await longPress(H, H.locator('.c52 [data-card]').first());
  await barButton(H, 'Reveal');
  await expect(G.locator('.reveal-screen img')).toHaveCount(1);
  await expect(G.locator('.reveal-screen img').first()).toHaveAttribute('alt', name!);
  await expect(H.locator('.reveal-screen')).toHaveCount(0);
  await expect(H.locator('.fullcard')).toHaveCount(0);
  await G.locator('.reveal-screen').click();
  await expect(H.locator('.ticker-text')).toContainText(`revealed ${name}`);
  await expect(G.locator('.ticker-text')).toContainText(`revealed ${name}`);
  await longPress(H, H.locator('.c52 [data-card]').first());
  await barButton(H, 'Reveal');
  await expect(G.locator('.reveal-screen')).toHaveCount(1);
});
