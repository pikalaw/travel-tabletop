import { test, expect, type Page } from '@playwright/test';
import { inOpenRow, OPEN, drag, point, startOneDevice, playFromHand, idsIn, tapCard, resetBar, barButton, answerDialog, watchErrors } from './helpers';

const marks = (page: Page, id: string) => page.locator(`.board [data-card="${id}"] > .marks`);
const ticker = (page: Page) => page.locator('.ticker-text');

async function deal(page: Page, mine: number, theirs: number) {
  await playFromHand(page, 'p1.battlefield', mine);
  await playFromHand(page, 'p2.battlefield', theirs);
  return { a: await idsIn(page, 'p1.battlefield'), d: await idsIn(page, 'p2.battlefield') };
}

async function dragXY(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12); await page.waitForTimeout(10); }
  await page.mouse.up(); await page.waitForTimeout(250);
}

async function holdOn(page: Page, id: string) {
  const p = await point(page, `.board [data-card="${id}"]`, 0.4, 0.6);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(300);
}

test('combat mode: attackers, blockers, double block, no tapping; End combat, undo, pass turn clears', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const { a, d } = await deal(page, 2, 2);
  await resetBar(page); await barButton(page, 'Combat');
  await inOpenRow(page, 'p1.battlefield', async () => {
    await inOpenRow(page, 'p2.battlefield', async () => {
        await tapCard(page, a[0]!); await tapCard(page, a[1]!);
        await expect(marks(page, a[0]!)).toContainText('⚔');
        await expect(marks(page, a[1]!)).toContainText('⚔');
        await tapCard(page, d[0]!);
        await expect(page.locator(`[data-card="${d[0]}"].selected`)).toHaveCount(1);
        await expect(page.locator('.attach-hint')).toBeVisible();
        await tapCard(page, a[0]!);
        await expect(marks(page, d[0]!)).toContainText('🛡');
        await tapCard(page, d[1]!); await tapCard(page, a[0]!); await tapCard(page, d[1]!); await tapCard(page, a[1]!);
        await expect(marks(page, d[1]!).locator('.mark.blk')).toHaveCount(2);
    });
  });
  await expect(page.locator('.card.tapped')).toHaveCount(0);
  // both combat-bar buttons fit on screen
  const vw = await page.evaluate(() => innerWidth);
  for (const t of ['End combat', 'Done']) {
    const r = (await page.locator('.bar').first().getByRole('button', { name: t, exact: true }).boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(vw);
  }
  await barButton(page, 'Done');
  await resetBar(page);
  await expect(page.locator('.bar').first().getByRole('button', { name: 'End combat' })).toHaveCount(1);
  // outside combat the collapsed row needs a tap to open; then a tap taps, and keeps the marks
  await expect(page.locator('[data-drop="p1.battlefield"]')).toHaveAttribute('data-collapsed', /.+/);
  await tapCard(page, a[0]!);
  await expect(page.locator('[data-drop="p1.battlefield"]')).toHaveClass(OPEN);
  await tapCard(page, a[0]!);
  await expect(page.locator(`[data-card="${a[0]}"].tapped`)).toHaveCount(1);
  await expect(marks(page, a[0]!)).toContainText('⚔');
  // full view of a defending card offers Block, not Attack
  await holdOn(page, d[0]!);
  await expect(page.locator('.bar').first().getByRole('button', { name: 'Block', exact: true })).toHaveCount(1);
  await barButton(page, 'Close');

  await resetBar(page); await barButton(page, 'End combat');
  await answerDialog(page, true);
  for (const id of [...a, ...d]) await expect(page.locator(`.board [data-card="${id}"] .mark.atk, .board [data-card="${id}"] .mark.blk`)).toHaveCount(0);
  await barButton(page, 'Undo');
  await expect(marks(page, d[1]!).locator('.mark.blk')).toHaveCount(2);
  await resetBar(page); await barButton(page, 'Pass turn');
  await answerDialog(page, true);
  await expect(page.locator('.board .mark.atk, .board .mark.blk')).toHaveCount(0);
  errs.expectNone();
});

test('combat in open slots: attack chip, mark placement on a tapped card, tap on a mark, drag marks off', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const { a, d } = await deal(page, 3, 3);
  const me = page.locator('[data-drop="p1.battlefield"]'), opp = page.locator('[data-drop="p2.battlefield"]');
  await expect(me).toHaveAttribute('data-collapsed', /.+/);
  for (const row of [me, opp]) {
    const r = (await row.boundingBox())!;
    await page.mouse.click(r.x + r.width - 6, r.y + r.height - 4);
    await page.waitForTimeout(250);
  }
  await expect(me).toHaveClass(OPEN); await expect(opp).toHaveClass(OPEN);

  await resetBar(page);
  const chip = page.locator('[data-counter="attack"]');
  await chip.scrollIntoViewIfNeeded();
  await drag(page, chip, page.locator(`[data-card="${a[0]}"]`));
  await expect(marks(page, a[0]!)).toContainText('⚔');
  await tapCard(page, a[0]!);
  await expect(page.locator(`[data-card="${a[0]}"].tapped`)).toHaveCount(1);
  // on a tapped card the mark sits at the top-left of the picture
  const mb = (await page.locator(`[data-card="${a[0]}"] .mark.atk`).boundingBox())!;
  const ib = (await page.locator(`[data-card="${a[0]}"] .card-face`).boundingBox())!;
  expect(Math.abs(mb.x - ib.x)).toBeLessThan(6); expect(Math.abs(mb.y - ib.y)).toBeLessThan(6);

  await resetBar(page); await barButton(page, 'Combat');
  await tapCard(page, a[1]!); await tapCard(page, d[0]!); await tapCard(page, a[0]!); await tapCard(page, d[1]!); await tapCard(page, a[1]!);
  await expect(marks(page, d[0]!)).toContainText('🛡'); await expect(marks(page, d[1]!)).toContainText('🛡');
  await expect(me).toHaveClass(OPEN); await expect(opp).toHaveClass(OPEN);
  // a tap on the ⚔ mark counts as a tap on its card
  await tapCard(page, d[2]!);
  await page.locator(`[data-card="${a[0]}"] .mark.atk`).scrollIntoViewIfNeeded();
  const m = await point(page, `[data-card="${a[0]}"] .mark.atk`);
  await page.mouse.click(m.x, m.y); await page.waitForTimeout(250);
  await expect(marks(page, d[2]!)).toContainText('🛡');
  await barButton(page, 'Done');

  // dragging 🛡 off removes that pair
  const s = await point(page, `[data-card="${d[2]}"] .mark.blk`);
  await dragXY(page, s, { x: s.x, y: s.y + 200 });
  await expect(marks(page, d[2]!).locator('.mark.blk')).toHaveCount(0);
  // full view: dragging ⚔ off the attacker frees its blocker
  const c = await point(page, `[data-card="${a[0]}"]`);
  await page.mouse.move(c.x + 20, c.y); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(300);
  const fb = page.locator('.full-badges .badge.atk');
  await expect(fb).toHaveCount(1);
  const f = await point(page, fb);
  await dragXY(page, f, { x: f.x + 30, y: f.y - 200 });
  await expect(fb).toHaveCount(0);
  await expect(marks(page, d[0]!).locator('.mark.blk')).toHaveCount(0);
  await barButton(page, 'Close');
  errs.expectNone();
});

test('matchup: the full view row, blocker as main, the board highlight, opponent hand as a drop target', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const { a, d } = await deal(page, 2, 2);
  // d1 attaches to d0
  await holdOn(page, d[1]!);
  await barButton(page, 'Attach');
  await inOpenRow(page, 'p2.battlefield', async () => {
      await tapCard(page, d[0]!);
  });
  expect(await page.locator(`.board [data-card="${d[1]}"]`).getAttribute('data-attached-to')).toBe(d[0]);
  await resetBar(page); await barButton(page, 'Combat');
  await inOpenRow(page, 'p1.battlefield', async () => {
    await inOpenRow(page, 'p2.battlefield', async () => {
      await tapCard(page, a[0]!); await tapCard(page, d[0]!); await tapCard(page, a[0]!);
    });
  });
  await barButton(page, 'Done');

  // attacker full view: the row is the attacker, a divider, then its blocker (whose attachment shows as +1)
  await holdOn(page, a[0]!);
  await expect(page.locator('.fullcard-meta')).toContainText('blocked by 1');
  await expect(page.locator('.full-thumbs .thumb')).toHaveCount(2);
  await expect(page.locator('.full-thumbs .thumb-divider')).toHaveCount(1);
  await expect(page.locator('.full-thumbs .thumb').nth(1)).toContainText('+1');
  const img = (await page.locator('.card-frame-pic img').boundingBox())!;
  const badges = (await page.locator('.full-badges').boundingBox())!;
  expect(badges.y).toBeGreaterThanOrEqual(img.y + img.height - 1);
  // tapping the blocker's thumb makes it the main card; the row stays the same
  await expect(page.locator('.fullcard-meta')).toContainText('Player 1 · Battlefield');
  await page.locator('.full-thumbs .thumb').nth(1).click();
  await expect(page.locator('.fullcard-meta')).toContainText('Player 2 · Battlefield');
  await expect(page.locator('.full-thumbs .thumb')).toHaveCount(2);
  await expect(page.locator('.full-thumbs .thumb').nth(1)).toHaveClass(/\bon\b/);
  await barButton(page, 'Close');
  // closing leaves the matchup highlighted on the board
  const inMatch = () => page.evaluate(() => [...document.querySelectorAll('.board .in-match')].map((e) => (e as HTMLElement).dataset.card).sort());
  expect(await inMatch()).toEqual([a[0], d[0], d[1]].sort());
  // a blocker opened from the board is the main card
  await holdOn(page, d[0]!);
  await expect(page.locator('.fullcard-meta')).toContainText('1 attached · blocking');
  await barButton(page, 'Close');
  // a tap on empty space clears the highlight
  const lands = (await page.locator('[data-drop="p1.lands"]').boundingBox())!;
  await page.mouse.click(lands.x + lands.width - 20, lands.y + lands.height - 10);
  await expect(page.locator('.board .in-match')).toHaveCount(0);

  // the opponent's hand count takes a dropped card
  const before = Number((await page.locator('.opp-hand').innerText()).match(/(\d+) in hand/i)![1]);
  await drag(page, page.locator('[data-drop="p1.hand"] [data-card]').first(), '.opp-hand');
  await expect(page.locator('.opp-hand')).toContainText(`${before + 1} in hand`, { ignoreCase: true });
  await expect(ticker(page)).toContainText(/Player 2's hand/);
  errs.expectNone();
});

test('End combat asks first, from combat mode and from the footer', async ({ page }) => {
  await startOneDevice(page);
  const { a, d } = await deal(page, 2, 1);
  const count = () => page.locator('.board .mark.atk, .board .mark.blk').count();
  await resetBar(page); await barButton(page, 'Combat');
  await inOpenRow(page, 'p1.battlefield', async () => {
    await inOpenRow(page, 'p2.battlefield', async () => {
        await tapCard(page, a[0]!); await tapCard(page, a[1]!); await tapCard(page, d[0]!); await tapCard(page, a[0]!);
    });
  });
  expect(await count()).toBe(3);
  await barButton(page, 'End combat');
  await expect(page.locator('.confirm-box.plain')).toContainText('This clears 2 attackers and 1 block.');
  await answerDialog(page, false);
  expect(await count()).toBe(3);
  await expect(page.locator('.bar.combat')).toHaveCount(1);
  await barButton(page, 'End combat');
  await answerDialog(page, true);
  expect(await count()).toBe(0);
  await expect(page.locator('.bar.combat')).toHaveCount(0);
  await expect(ticker(page)).toContainText(/combat/i);

  await resetBar(page); await barButton(page, 'Combat');
  await inOpenRow(page, 'p1.battlefield', async () => { await tapCard(page, a[0]!); });
  await barButton(page, 'Done');
  await resetBar(page); await barButton(page, 'End combat');
  await expect(page.locator('.confirm-box.plain')).toContainText('This clears 1 attacker.');
  await answerDialog(page, false);
  expect(await count()).toBe(1);
});
