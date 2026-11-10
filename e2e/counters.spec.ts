import { test, expect, type Page } from '@playwright/test';
import { OPEN, drag, longPress, point, startOneDevice, playFromHand, resetBar, barButton, unblind, touchSwipe, tapCard } from './helpers';

async function dragXY(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12); await page.waitForTimeout(10); }
  await page.mouse.up(); await page.waitForTimeout(250);
}

test('counter badges: add by chip, remove by dragging off (other slot, gap, blank), open slot, enlarged grab area', async ({ page }) => {
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield');
  const bf = page.locator('[data-drop="p1.battlefield"]');
  const card = bf.locator('[data-card]').first();
  const badge = card.locator('.badge.plus');
  await resetBar(page);
  for (let i = 0; i < 3; i++) await drag(page, '[data-counter="plus"]', card);
  await expect(page.locator('.ticker-text')).toContainText(/added a \+1\/\+1 counter on/);
  await expect(badge).toHaveText('+3');

  await drag(page, badge, '[data-drop="p2.battlefield"]');
  await expect(badge).toHaveText('+2');
  const board = (await page.locator('.board').boundingBox())!;
  const b0 = await point(page, badge);
  await dragXY(page, b0, { x: b0.x, y: board.y + 1.5 });
  await expect(badge).toHaveText('+1');

  // in the full view, dragging the badge to blank space removes it
  await longPress(page, card);
  const fb = page.locator('.full-badges .badge.plus');
  await dragXY(page, await point(page, fb), { x: 20, y: 60 });
  await expect(fb).toHaveCount(0);
  await expect(page.locator('.ticker-text')).toContainText(/removed a \+1\/\+1 counter from/);
  await barButton(page, 'Close');

  // an open (scrolling) slot: a sideways badge drag removes, it does not pan
  await playFromHand(page, 'p1.battlefield', 4);
  const bb = (await bf.boundingBox())!;
  await page.mouse.click(bb.x + bb.width - 8, bb.y + bb.height - 6);
  await expect(bf).toHaveClass(OPEN);
  await bf.evaluate((e) => { e.scrollLeft = 0; });
  await resetBar(page);
  for (let i = 0; i < 3; i++) await drag(page, '[data-counter="plus"]', card);
  await expect(badge).toHaveText('+3');
  const b1 = await point(page, badge);
  await dragXY(page, b1, { x: b1.x + 150, y: b1.y + 5 });
  await expect(badge).toHaveText('+2');
  // grabbing 5px above the badge still takes the badge, not the card
  const r = (await badge.boundingBox())!;
  await dragXY(page, { x: r.x + r.width / 2, y: r.y - 5 }, { x: 30, y: 30 });
  await expect(badge).toHaveText('+1');
  await expect(card).toHaveCount(1);
});

test('counter badges in the full view by touch: drag off, + and − buttons', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 840 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const tdrag = async (src: Parameters<typeof point>[1], dst: Parameters<typeof point>[1]) => {
    if (typeof src === 'string') await page.locator(src).scrollIntoViewIfNeeded(); // a footer tag
    const a = await point(page, src), b = await point(page, dst);
    await touchSwipe(cdp, page, a.x, a.y, b.x, b.y, { steps: 14 });
  };
  await startOneDevice(page);
  await resetBar(page);
  const bf = page.locator('[data-drop="p1.battlefield"]');
  await tdrag(page.locator('[data-drop="p1.hand"] [data-card]').first(), bf);
  const c = await point(page, bf.locator('[data-card]').first());
  await touchSwipe(cdp, page, c.x, c.y, c.x, c.y, { steps: 1, holdBefore: 700 });
  await expect(page.locator('.fullcard')).toHaveCount(1);
  const fi = page.locator('.card-frame-pic');
  for (let i = 0; i < 2; i++) await tdrag('[data-counter="minus"]', fi);
  const mb = page.locator('.full-badges .badge.minus');
  await expect(mb).toHaveText('−1/−1 × 2');
  // dragging the badge up onto the card art removes one; off to a corner removes the next
  let m = await point(page, mb);
  await touchSwipe(cdp, page, m.x, m.y, m.x, m.y - 250, { steps: 14 });
  await expect(mb).toHaveText('−1/−1 × 1');
  m = await point(page, mb);
  await touchSwipe(cdp, page, m.x, m.y, 30, 80, { steps: 14 });
  await expect(mb).toHaveCount(0);

  for (let i = 0; i < 2; i++) await tdrag('[data-counter="plus"]', fi);
  const pb = page.locator('.full-badges .badge.plus');
  await expect(pb).toHaveText('+1/+1 × 2');
  const tap = async (sel: string) => { const p = await point(page, sel); await touchSwipe(cdp, page, p.x, p.y, p.x, p.y, { steps: 1 }); };
  await tap('.ctr-group:has(.badge.plus) [aria-label="Add one"]');
  await expect(pb).toHaveText('+1/+1 × 3');
  await tap('.ctr-group:has(.badge.plus) [aria-label="Remove one"]');
  await expect(pb).toHaveText('+1/+1 × 2');
  const p = await point(page, pb);
  await touchSwipe(cdp, page, p.x, p.y, p.x + 40, p.y - 150, { steps: 14 });
  await expect(pb).toHaveText('+1/+1 × 1');
  await ctx.close();
});

for (const [name, vp] of [['portrait', { width: 412, height: 840 }], ['landscape', { width: 840, height: 412 }]] as const) {
  test(`full view, ${name}: counters sit below the card, on screen`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await startOneDevice(page);
    await playFromHand(page, 'p1.battlefield');
    const card = page.locator('[data-drop="p1.battlefield"] [data-card]').first();
    for (const k of ['plus', 'minus']) {
      const chip = page.locator(`[data-counter="${k}"]`);
      await chip.scrollIntoViewIfNeeded();
      await drag(page, chip, card);
    }
    // an attack mark too, from combat mode
    await resetBar(page); await barButton(page, 'Combat');
    await tapCard(page, (await card.getAttribute('data-card'))!);
    await barButton(page, 'Pause');
    // Open the full view with a right-click: in a small landscape card, a long-press point can
    // land on a counter's grab area, which starts a drag instead.
    const c = await point(page, card);
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await expect(page.locator('.fullcard')).toHaveCount(1);
    const img = (await page.locator('.card-frame-pic img').boundingBox())!;
    const badges = (await page.locator('.full-badges').boundingBox())!;
    expect(badges.y).toBeGreaterThanOrEqual(img.y + img.height);
    expect(badges.y + badges.height).toBeLessThanOrEqual(vp.height);
    await ctx.close();
  });
}

test('the attack chip is only in the full view, for the player whose turn it is (or a blinded table)', async ({ page }) => {
  const chip = page.locator('[data-counter="attack"]');
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 1);
  const card = page.locator('[data-drop="p1.battlefield"] [data-card]').first();
  const id = (await card.getAttribute('data-card'))!;
  // the main footer has no chip: attackers are marked in combat mode
  await expect(chip).toHaveCount(0);
  const inFull = async (n: number) => {
    await longPress(page, page.locator(`.board [data-card="${id}"]`));
    await expect(chip).toHaveCount(n);
    await barButton(page, 'Close');
  };
  await inFull(1);
  await resetBar(page); await barButton(page, 'Pass turn');
  await page.locator('.confirm-box .btn.yes').click();
  await inFull(1); // passing the turn blinds the table, which sees the chip
  await unblind(page, 'Player 1');
  await inFull(0);
  await barButton(page, 'Blind my hand');
  await unblind(page, 'Player 2');
  // Player 2 is shown what happened while away, over the half of the board the card is on
  const away = page.locator('.sheet');
  if (await away.count()) await away.getByRole('button', { name: 'Done' }).click();
  await inFull(1);
});
