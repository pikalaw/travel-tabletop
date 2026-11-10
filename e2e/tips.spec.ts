import { test, expect, type CDPSession, type Locator, type Page } from '@playwright/test';
import { point, startOneDevice, touchSwipe, watchErrors } from './helpers';

/** Press and hold a finger on `l` long enough for its tip; the finger stays down. */
async function hold(cdp: CDPSession, page: Page, l: Locator) {
  await l.scrollIntoViewIfNeeded();
  const p = await point(page, l);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await page.waitForTimeout(700);
  return p;
}
async function slide(cdp: CDPSession, page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }] });
    await page.waitForTimeout(16);
  }
}
async function lift(cdp: CDPSession, page: Page) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
}

test('a long press on a button or tag only shows its tip; lifting hides it and nothing else happens', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 840 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  const cdp = await ctx.newCDPSession(page);
  await startOneDevice(page);
  const bar = page.locator('.bar').first();
  const tip = page.locator('.tip-bubble');

  // a button: the tip while held; lifting hides it and the button is not pressed
  const dice = bar.getByRole('button', { name: 'Dice', exact: true });
  await hold(cdp, page, dice);
  await expect(tip).toHaveText('Dice, a coin flip, or a random card.');
  await lift(cdp, page);
  await expect(tip).toHaveCount(0);
  await expect(page.locator('.sheet')).toHaveCount(0);
  // a toggle isn't pressed either
  const pointBtn = bar.getByRole('button', { name: 'Point', exact: true });
  await hold(cdp, page, pointBtn); await lift(cdp, page);
  await expect(pointBtn).toHaveAttribute('aria-pressed', 'false');
  // a quick tap still presses at once, with no tip
  await dice.tap();
  await expect(tip).toHaveCount(0);
  await expect(page.locator('.sheet')).toHaveCount(1);
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).first().click();

  // a tag: held, its tip; lifted, nothing (no rename box for the labeled tag)
  await hold(cdp, page, bar.locator('[data-counter="label"]'));
  await expect(tip).toContainText('tap to rename it');
  await lift(cdp, page);
  await expect(tip).toHaveCount(0);
  await expect(page.locator('.confirm-box')).toHaveCount(0);

  // a held tag moved onto a card does not drag: the hold was the whole gesture
  const bf = page.locator('[data-drop="p1.battlefield"]');
  const h = await point(page, page.locator('[data-drop="p1.hand"] [data-card]').first()), b = await point(page, bf);
  await touchSwipe(cdp, page, h.x, h.y, b.x, b.y, { steps: 14 });
  const card = await point(page, bf.locator('[data-card]').first());
  const plus = bar.locator('[data-counter="plus"]');
  const q = await hold(cdp, page, plus);
  await slide(cdp, page, q, card);
  await lift(cdp, page);
  await expect(tip).toHaveCount(0);
  await expect(bf.locator('[data-badge="plus"]')).toHaveCount(0);
  // a fresh drag of the same tag works as usual
  const q2 = await point(page, plus);
  await touchSwipe(cdp, page, q2.x, q2.y, card.x, card.y, { steps: 14 });
  await expect(bf.locator('[data-badge="plus"]')).toHaveCount(1);
  errs.expectNone();
  await ctx.close();
});
