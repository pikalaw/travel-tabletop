import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { OPEN, startOneDevice, idsIn, watchErrors } from './helpers';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 840 } });

/** Two fingers down around (x, y), then spread apart sideways from 2·d0 to 2·d1 px. */
async function spread(cdp: CDPSession, page: Page, x: number, y: number, d0 = 12, d1 = 70) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - d0, y, id: 1 }] });
  await page.waitForTimeout(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - d0, y, id: 1 }, { x: x + d0, y, id: 2 }] });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const d = d0 + ((d1 - d0) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - d, y, id: 1 }, { x: x + d, y, id: 2 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
}

const centre = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('spread: on a collapsed slot it opens the first card; on an open slot, the card under the fingers', async ({ page, context }) => {
  const errs = watchErrors(page);
  const cdp = await context.newCDPSession(page);
  await startOneDevice(page);
  const handRow = page.locator('[data-drop="p1.hand"]');
  await expect(handRow).toHaveAttribute('data-collapsed', /.+/);
  const hand = await idsIn(page, 'p1.hand');

  // collapsed: wherever the fingers are, the slot's first card opens
  const c = await centre(page, '[data-drop="p1.hand"]');
  await spread(cdp, page, c.x + 40, c.y);
  await expect(page.locator('.fullcard-inner')).toHaveAttribute('data-card-target', hand[0]!);
  // a swipe down closes it
  const r = (await page.locator('.fullcard-inner').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 3 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 3 + 12 * i }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.fullcard')).toHaveCount(0);

  // open the slot with a tap on its "tap to open" strip, then spread on its second card
  const hb = (await handRow.boundingBox())!;
  await page.touchscreen.tap(hb.x + hb.width - 12, hb.y + 4);
  await expect(handRow).toHaveClass(OPEN);
  const second = await centre(page, `[data-drop="p1.hand"] [data-card="${hand[1]}"]`);
  await spread(cdp, page, second.x, second.y + 20, 6, 60);
  await expect(page.locator('.fullcard-inner')).toHaveAttribute('data-card-target', hand[1]!);
  errs.expectNone();
});

test('touch: a dialog opened by a tap stays open; a tap outside it still cancels', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const chip = page.locator('[data-counter="label"]');
  await chip.scrollIntoViewIfNeeded();
  const b = (await chip.boundingBox())!;
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('.dialog-input')).toHaveCount(1);
  await page.waitForTimeout(400);
  await expect(page.locator('.dialog-input')).toHaveCount(1); // the click after the tap did not close it
  await page.touchscreen.tap(10, 10);
  await expect(page.locator('.dialog-input')).toHaveCount(0);
  errs.expectNone();
});

test('spread on a token in the Tokens sheet shows it full screen', async ({ page, context }) => {
  const errs = watchErrors(page);
  const cdp = await context.newCDPSession(page);
  await startOneDevice(page);
  await page.locator('.bar').first().getByRole('button', { name: 'Tokens' }).click();
  const first = page.locator('.sheet .token-item').first();
  const name = await first.getAttribute('data-token-name');
  const c = await centre(page, '.sheet .token-item');
  await spread(cdp, page, c.x, c.y, 6, 40);
  await expect(page.locator('.deck-viewer')).toBeVisible();
  await expect(page.locator('.deck-viewer-name')).toContainText(name!);
  errs.expectNone();
});
