import { test, expect, type Page } from '@playwright/test';
import { inOpenRow, point, longPress, startOneDevice, playFromHand, idsIn, barButton, answerDialog, watchErrors } from './helpers';

/** Swipe across the full view's card: dx < 0 goes to the next card or group, dx > 0 to the previous one. */
async function swipe(page: Page, dx: number) {
  const r = (await page.locator('.fullcard-inner').boundingBox())!;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 6 }); await page.mouse.up();
}

test('full view: swipes step through the slot, one stop per group; arrows are signs; arrow keys too', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 3);
  const [a, b, c] = await idsIn(page, 'p1.battlefield');

  // attach a hand card to the first card, so the slot holds: [a + attachment], b, c
  await longPress(page, page.locator('[data-drop="p1.hand"] [data-card]').first());
  await barButton(page, 'Attach');
  await inOpenRow(page, 'p1.battlefield', async () => {
      const pa = await point(page, `.board [data-card="${a}"]`, 0.15, 0.5);
      await page.mouse.click(pa.x, pa.y);
  });
  await expect(page.locator('[data-drop="p1.battlefield"] .card.tucked')).toHaveCount(1);

  const shown = page.locator('.fullcard-inner');
  const prev = page.locator('.full-step.prev'), next = page.locator('.full-step.next');

  await longPress(page, page.locator(`[data-card="${c}"]`));
  await expect(shown).toHaveAttribute('data-card-target', c!);
  // the arrows are signs, not buttons; a missing neighbour hides its arrow
  await expect(page.locator('.fullcard').getByRole('button', { name: /card in this slot/ })).toHaveCount(0);
  await expect(next).toHaveClass(/\boff\b/);
  await expect(prev).not.toHaveClass(/\boff\b/);
  await swipe(page, 120);
  await expect(shown).toHaveAttribute('data-card-target', b!);
  await swipe(page, 120);
  // the group counts once, and opens on its host with the group row
  await expect(shown).toHaveAttribute('data-card-target', a!);
  await expect(page.locator('.fullcard-meta')).toContainText('1 attached');
  await expect(prev).toHaveClass(/\boff\b/);
  await swipe(page, 120); // nothing before the first group
  await expect(shown).toHaveAttribute('data-card-target', a!);
  // from the attachment, a swipe goes past the whole group
  await page.locator('.full-thumbs .thumb').nth(1).click();
  await expect(page.locator('.fullcard-meta')).toContainText('Attached to');
  await swipe(page, -120);
  await expect(shown).toHaveAttribute('data-card-target', b!);
  await page.keyboard.press('ArrowRight');
  await expect(shown).toHaveAttribute('data-card-target', c!);
  await page.keyboard.press('ArrowLeft');
  await expect(shown).toHaveAttribute('data-card-target', b!);
  await barButton(page, 'Close');

  // the opponent's hand is hidden, so stepping through your own hand stays in your hand
  const hand = await idsIn(page, 'p1.hand');
  await longPress(page, page.locator(`[data-card="${hand[0]}"]`));
  await expect(prev).toHaveClass(/\boff\b/);
  await swipe(page, -120);
  await expect(shown).toHaveAttribute('data-card-target', hand[1]!);
  await barButton(page, 'Close');
  errs.expectNone();
});

test('full view: dragging the card up carries its whole group back to the board; a swipe down only closes', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 2);
  const [a] = await idsIn(page, 'p1.battlefield');
  await longPress(page, page.locator('[data-drop="p1.hand"] [data-card]').first());
  await barButton(page, 'Attach');
  await inOpenRow(page, 'p1.battlefield', async () => {
      const pa = await point(page, `.board [data-card="${a}"]`, 0.15, 0.5);
      await page.mouse.click(pa.x, pa.y);
  });
  const group = await idsIn(page, 'p1.battlefield');
  const attached = await page.locator(`[data-drop="p1.battlefield"] [data-attached-to="${a}"]`).getAttribute('data-card');

  // open the attachment, drag up off the card, then onto the lands row
  await longPress(page, page.locator(`[data-card="${a}"]`));
  await page.locator('.full-thumbs .thumb').nth(1).click();
  const r = (await page.locator('.fullcard-inner').boundingBox())!;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx, cy - 80, { steps: 6 });
  await expect(page.locator('.fullcard')).toHaveCount(0);
  await expect(page.locator('.drag-ghost.group')).toHaveCount(1);
  const lands = (await page.locator('[data-drop="p1.lands"]').boundingBox())!;
  await page.mouse.move(lands.x + lands.width / 2, lands.y + lands.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => idsIn(page, 'p1.lands')).toEqual(expect.arrayContaining([a!, attached!]));
  expect(await idsIn(page, 'p1.battlefield')).toHaveLength(group.length - 2);

  // a swipe down only closes the view: nothing moves
  const [rest] = await idsIn(page, 'p1.battlefield');
  await longPress(page, page.locator(`[data-card="${rest}"]`));
  const r2 = (await page.locator('.fullcard-inner').boundingBox())!;
  await page.mouse.move(r2.x + r2.width / 2, r2.y + r2.height / 3); await page.mouse.down();
  await page.mouse.move(r2.x + r2.width / 2, r2.y + r2.height / 3 + 90, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('.fullcard')).toHaveCount(0);
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  expect(await idsIn(page, 'p1.battlefield')).toContain(rest!);
  errs.expectNone();
});

test('one device: passing the turn blinds the hand', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await barButton(page, 'Pass turn');
  await answerDialog(page, true);
  await expect(page.locator('.turn-label')).toContainText('Turn 2', { ignoreCase: true });
  await expect(page.getByRole('button', { name: 'Unblind to Player 2' })).toBeVisible();
  await expect(page.locator('.board')).toContainText('hand (hidden)');
  errs.expectNone();
});

test('make lead: an attached card becomes the group\'s lead card; new attachments go to the far left', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 2);
  const [a, b] = await idsIn(page, 'p1.battlefield');
  // attach b onto a, then a hand card onto a: the newest goes farthest left
  await longPress(page, page.locator(`[data-card="${b}"]`), 0.7, 0.3);
  await barButton(page, 'Attach');
  await inOpenRow(page, 'p1.battlefield', async () => {
      const pa = await point(page, `.board [data-card="${a}"]`, 0.15, 0.5);
      await page.mouse.click(pa.x, pa.y);
  });
  await longPress(page, page.locator('[data-drop="p1.hand"] [data-card]').first(), 0.15, 0.5);
  await barButton(page, 'Attach');
  await inOpenRow(page, 'p1.battlefield', async () => {
      const pa2 = await point(page, `.board [data-card="${a}"]`, 0.5, 0.5);
      await page.mouse.click(pa2.x, pa2.y);
  });
  await expect.poll(async () => (await idsIn(page, 'p1.battlefield')).length).toBe(3);
  const [handCard, ...rest] = await idsIn(page, 'p1.battlefield');
  expect(rest).toEqual([b, a]);

  // the lead card offers no Make lead; an attached card does
  await longPress(page, page.locator(`[data-card="${a}"]`));
  await expect(page.locator('.bar').first().getByRole('button', { name: 'Make lead' })).toHaveCount(0);
  await page.locator('.full-thumbs .thumb').nth(2).click(); // thumbnails: lead, then closest first → b, handCard
  await barButton(page, 'Make lead');
  await expect(page.locator('.ticker-text')).toContainText('the lead card of its group');
  await barButton(page, 'Close');
  await expect.poll(() => idsIn(page, 'p1.battlefield')).toEqual([a, b, handCard]);
  const bf = page.locator('[data-drop="p1.battlefield"]');
  await expect(bf.locator(`[data-card="${a}"]`)).toHaveAttribute('data-attached-to', handCard!);
  await expect(bf.locator(`[data-card="${b}"]`)).toHaveAttribute('data-attached-to', handCard!);
  errs.expectNone();
});

test('full view: a tap on the card taps or untaps it; a tapped card stays upright with a Tapped badge', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 1);
  const [a] = await idsIn(page, 'p1.battlefield');
  await longPress(page, page.locator(`[data-card="${a}"]`));
  const inner = page.locator('.fullcard-inner');
  const badge = page.locator('.full-badges .badge.tap');
  await expect(badge).toHaveCount(0);
  await inner.click();
  await expect(page.locator(`.board [data-card="${a}"].tapped`)).toHaveCount(1);
  await expect(badge).toHaveText(/Tapped/);
  // the picture is not turned: still taller than wide
  const img = (await page.locator('.fullcard-inner img').boundingBox())!;
  expect(img.height).toBeGreaterThan(img.width);
  await inner.click();
  await expect(page.locator(`.board [data-card="${a}"].tapped`)).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await barButton(page, 'Close');
  // a hand card has no tapped state: a tap on it changes nothing
  const h = (await idsIn(page, 'p1.hand'))[0]!;
  await longPress(page, page.locator(`[data-card="${h}"]`), 0.15, 0.5);
  await expect(page.locator('.fullcard-meta')).not.toContainText('Tap the card to tap');
  await page.locator('.fullcard-inner').click();
  await expect(page.locator('.fullcard-meta')).not.toContainText('tapped');
  errs.expectNone();
});
