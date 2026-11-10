import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { unblind } from './helpers';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 840 } });

async function swipe(cdp: CDPSession, page: Page, x0: number, y0: number, x1: number, y1: number, steps = 12, hold = 0) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
    if (i < steps) await page.waitForTimeout(16); // a fling lifts the finger right after the last move
  }
  if (hold) await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
}

test('touch: swipes scroll bars and rows without pressing; taps press; drag up plays a card', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('index.html');
  await page.getByRole('button', { name: 'New game' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');

  const bar = page.locator('.bar').first();
  const bb = (await bar.boundingBox())!;
  const y = bb.y + bb.height / 2;
  const ticker = page.locator('.ticker-text');
  const tick0 = await ticker.innerText();

  // a slow swipe scrolls the main bar and presses nothing
  await swipe(cdp, page, 300, y, 60, y, 12, 150);
  expect(await bar.evaluate((e) => e.scrollLeft)).toBeGreaterThan(100);
  await expect(page.locator('.sheet')).toHaveCount(0);
  expect(await ticker.innerText()).toBe(tick0);

  // a quick fling carries on past the finger
  await bar.evaluate((e) => { e.scrollLeft = 0; });
  await swipe(cdp, page, 300, y, 150, y, 2);
  expect(await bar.evaluate((e) => e.scrollLeft)).toBeGreaterThan(150);

  // a tap still presses a button
  await bar.evaluate((e) => { e.scrollLeft = 0; });
  await bar.getByRole('button', { name: 'Dice', exact: true }).tap();
  await expect(page.locator('.sheet')).toHaveCount(1);
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).first().tap();
  await expect(page.locator('.sheet')).toHaveCount(0);

  // the library bar scrolls without drawing
  const handCards = page.locator('.row[data-drop="p1.hand"] [data-card]');
  await page.locator('.pile[data-drop="p1.library"]').tap();
  await page.waitForTimeout(300);
  const n0 = await handCards.count();
  await swipe(cdp, page, 330, y, 40, y, 12, 150);
  expect(await bar.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  await expect(handCards).toHaveCount(n0);
  await bar.getByText('Done').tap();

  // an open hand row scrolls; the card order is unchanged
  const hand = page.locator('.row[data-drop="p1.hand"]');
  const hb = (await hand.boundingBox())!;
  const hy = hb.y + hb.height / 2;
  await page.mouse.click(hb.x + hb.width - 20, hy);
  await page.waitForTimeout(300);
  const order = () => hand.evaluate((e) => [...e.querySelectorAll('[data-card]')].map((c) => (c as HTMLElement).dataset.card).join());
  const o0 = await order();
  await swipe(cdp, page, hb.x + hb.width - 30, hy, hb.x + 30, hy, 12, 150);
  expect(await hand.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  expect(await order()).toBe(o0);

  // a drag up moves a card to the battlefield
  // (pick a card that is on screen after the scroll)
  const boxes = await hand.locator('[data-card]').evaluateAll((cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  const cb = boxes.find((r) => r.x > hb.x + 10 && r.x + r.width < hb.x + hb.width - 10)!;
  await swipe(cdp, page, cb.x + cb.width / 2, cb.y + cb.height / 2, cb.x + cb.width / 2 + 10, cb.y - 300, 15);
  await expect(page.locator('[data-drop="p1.battlefield"] [data-card]')).toHaveCount(1);

  // a tap on a hand card does not open the full view
  await hand.locator('[data-card]').first().tap();
  await page.waitForTimeout(400);
  await expect(page.locator('.fullcard')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(1); // still the main footer
  expect(errors).toEqual([]);
});
