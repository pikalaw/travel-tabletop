import { test, expect, type Page } from '@playwright/test';
import { drag, longPress, point, startOneDevice, playFromHand, resetBar, barButton, answerDialog, unblind, watchErrors } from './helpers';

const HOT = 'rgb(255, 123, 95)', COOL = 'rgb(122, 167, 255)';

test('labels: hand, counters, opponent hand, ticker; whose turn; only the active player attacks', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page, { unblindTo: null });
  await expect(page.locator('.my-hand .slot-label')).toHaveText(/Player 1’s hand \(hidden\)\s*7/i);
  await unblind(page, 'Player 1');
  await expect(page.locator('.my-hand .slot-label')).toHaveText(/Player 1’s hand\s*7/i);
  // each player's stats beside their battlefield; "Turn N" on the active player's
  await expect(page.locator('.my-stats .counters-cell')).toHaveText(/Turn 1\s*Player 1\s*♥ 20/i);
  await expect(page.locator('.opp-stats .counters-cell')).toHaveText(/^Player 2\s*♥ 20$/i);
  await expect(page.locator('.opp-lands .hand-label')).toHaveText(/Player 2: 7 in hand/i);
  await expect(page.locator('.ticker')).toContainText('Turn 1 · Player 1');
  await expect(page.locator('.board')).toHaveClass(/\bmy-turn\b/);

  await playFromHand(page, 'p1.battlefield');
  await playFromHand(page, 'p2.battlefield');
  // the full view's ⚔ Attack chip, dropped on the other player's creature, is refused
  await longPress(page, page.locator('[data-drop="p2.battlefield"] [data-card]').first());
  await page.locator('[data-counter="attack"]').scrollIntoViewIfNeeded();
  await drag(page, page.locator('[data-counter="attack"]'), page.locator('.card-frame-pic'));
  await barButton(page, 'Close');
  await expect(page.locator('[data-drop="p2.battlefield"] .mark.atk')).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Only Player 1’s creatures can attack this turn.' })).toHaveCount(1);

  await resetBar(page); await barButton(page, 'Combat');
  const c = await point(page, page.locator('[data-drop="p1.battlefield"] [data-card]').first(), 0.4, 0.6);
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(200);
  await expect(page.locator('[data-drop="p1.battlefield"] .mark.atk')).toHaveCount(1);
  await barButton(page, 'Pause');
  await resetBar(page); await barButton(page, 'Pass turn');
  await answerDialog(page, true);
  // blinded by the pass, the board faces the next player; Player 1 then looks during Player 2's turn
  await expect(page.locator('.board')).toHaveClass(/\bpersp-p2\b.*\bmy-turn\b|\bmy-turn\b.*\bpersp-p2\b/);
  await unblind(page, 'Player 1');
  await expect(page.locator('.board')).toHaveClass(/\btheir-turn\b/);
  await expect(page.locator('.counters-cell.role-atk')).toHaveText(/Turn 2\s*Player 2\s*♥ 20/i);
  await expect(page.locator('.counters-cell.role-def')).toHaveText(/^Player 1\s*♥ 20$/i);
  errs.expectNone();
});

async function roleColours(page: Page) {
  // Each name, and the turn label, as "<cell>:<text>=<hot|cool>"; a stats box colours its own name and turn label.
  return page.evaluate(([hot, cool]) => [...document.querySelectorAll('.board .role-atk:not(.counters-cell), .board .role-def:not(.counters-cell), .board .counters-cell .ctr-name, .board .counters-cell .turn-label')]
    .map((e) => {
      const c = getComputedStyle(e).color;
      return `${e.closest('.cell')!.className.split(' ')[2]}:${(e as HTMLElement).innerText.toUpperCase()}=${c === hot ? 'hot' : c === cool ? 'cool' : c}`;
    }), [HOT, COOL]);
}

test('the attacking player’s name is hot and the defending player’s cool, and they swap with the turn', async ({ page }) => {
  await startOneDevice(page);
  const p1 = await roleColours(page);
  expect(p1).toEqual(expect.arrayContaining(['opp-lands:PLAYER 2=cool', 'opp-field:PLAYER 2=cool', 'opp-stats:PLAYER 2=cool',
    'my-field:PLAYER 1=hot', 'my-lands:PLAYER 1=hot', 'my-stats:TURN 1=hot', 'my-stats:PLAYER 1=hot', 'my-hand:PLAYER 1=hot']));
  expect(p1.filter((s) => !/=(hot|cool)$/.test(s))).toEqual([]);
  await resetBar(page); await barButton(page, 'Pass turn');
  await answerDialog(page, true);
  await unblind(page, 'Player 1'); // the pass turned the board to Player 2; look from Player 1's side
  const p2 = await roleColours(page);
  expect(p2).toEqual(expect.arrayContaining(['opp-lands:PLAYER 2=hot', 'opp-field:PLAYER 2=hot', 'opp-stats:TURN 2=hot', 'opp-stats:PLAYER 2=hot',
    'my-field:PLAYER 1=cool', 'my-lands:PLAYER 1=cool', 'my-stats:PLAYER 1=cool', 'my-hand:PLAYER 1=cool']));
});

const pseudo = (page: Page, sel: string, which: '::before' | '::after') => page.locator(sel).first().evaluate((e, w) => getComputedStyle(e, w).content, which);

test('"tap to open" shows on a collapsed row and on a single attached group; "tap to close" on an open row', async ({ page }) => {
  await startOneDevice(page);
  const hand = page.locator('[data-drop="p1.hand"]');
  const me = page.locator('[data-drop="p1.battlefield"]');
  await expect.poll(() => pseudo(page, '[data-drop="p1.hand"]', '::after')).toBe('"tap to open"');
  const hb = (await hand.boundingBox())!;
  await page.mouse.click(hb.x + hb.width - 6, hb.y + hb.height - 4); await page.waitForTimeout(300);
  expect(await pseudo(page, '.row-box:has([data-drop="p1.hand"])', '::before')).toBe('"tap to close"');
  expect(await pseudo(page, '[data-drop="p1.hand"]', '::after')).toBe('none');
  // a tap still closes after the row has scrolled
  await hand.evaluate((e) => { e.scrollLeft = 200; }); await page.waitForTimeout(200);
  await page.mouse.click(hb.x + hb.width - 6, hb.y + hb.height - 4); await page.waitForTimeout(300);
  await expect(hand).toHaveAttribute('data-collapsed', '1');

  // one card on the battlefield: no hint; one card with an attachment: "tap to open"
  await playFromHand(page, 'p1.battlefield');
  expect(await pseudo(page, '[data-drop="p1.battlefield"]', '::after')).toBe('none');
  await longPress(page, hand.locator('[data-card]').first(), 0.4, 0.4);
  await barButton(page, 'Attach');
  const c = await point(page, me.locator('[data-card]').first(), 0.6, 0.6);
  await page.mouse.click(c.x, c.y); await page.waitForTimeout(300);
  expect(await pseudo(page, '[data-drop="p1.battlefield"]', '::after')).toBe('"tap to open"');
  const mb = (await me.boundingBox())!;
  await page.mouse.click(mb.x + mb.width - 10, mb.y + mb.height - 6); await page.waitForTimeout(300);
  expect(await pseudo(page, '[data-drop="p1.battlefield"]', '::after')).toBe('none');
  expect(await pseudo(page, '.row-box:has([data-drop="p1.battlefield"])', '::before')).toBe('"tap to close"');
});

test('a narrow side slot shortens its name, never its count', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await startOneDevice(page);
  for (const zone of ['p1.library', 'p2.library', 'p1.graveyard', 'p1.exile']) {
    const label = page.locator(`[data-drop="${zone}"] .slot-label`);
    const box = (await label.boundingBox())!, count = (await label.locator('b').boundingBox())!;
    await expect(label.locator('b')).toBeVisible();
    expect(count.x + count.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  await page.screenshot({ path: 'test-results/narrow-labels.png' });
});
