import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { mockScryfall, importDeck, pickDecks, unblind, longPress, playFromHand, idsIn } from './helpers';

// A phone held upright: the abilities list sits under the card and scrolls.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

const LONG = Array.from({ length: 8 }, (_, i) => `Ability number ${i + 1}: a long line of rules text that wraps onto a second line on a phone.`).join('\n');

/** A touch path through the given points. */
async function touchPath(cdp: CDPSession, page: Page, pts: { x: number; y: number }[]) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]!] });
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!, b = pts[k]!;
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }] });
      await page.waitForTimeout(16);
    }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
}

test('touch: a vertical swipe scrolls the abilities list; a sideways pull picks one up for the Stack', async ({ page, context }) => {
  await mockScryfall(page, { oracle: { 'Long Test': LONG } });
  await importDeck(page, 'Long', '20 Long Test');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await page.getByText('← Decks').click();
  await page.getByText('← Home').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Long'], ['Long']]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');
  await playFromHand(page, 'p1.battlefield', 1);
  const [card] = await idsIn(page, 'p1.battlefield');
  await longPress(page, page.locator(`.board [data-card="${card}"]`));
  const cdp = await context.newCDPSession(page);
  const meta = page.locator('.fullcard-meta');
  const line = page.locator('.abilities .ability.line').nth(1);

  // swiping up on a line scrolls the list, and picks nothing up
  const r = (await line.boundingBox())!;
  await touchPath(cdp, page, [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }, { x: r.x + r.width / 2, y: r.y - 60 }]);
  expect(await meta.evaluate((e) => e.scrollTop)).toBeGreaterThan(20);
  await expect(page.locator('.fullcard')).toHaveCount(1);

  // pulled sideways, the line comes along; dropped on the Stack, it goes there
  const l2 = (await page.locator('.abilities .ability.line').nth(2).boundingBox())!;
  const stack = (await page.locator('[data-drop="stack"]').boundingBox())!;
  const start = { x: l2.x + l2.width / 2, y: l2.y + l2.height / 2 };
  await touchPath(cdp, page, [start, { x: start.x - 90, y: start.y }, { x: stack.x + stack.width / 2, y: stack.y + stack.height / 2 }]);
  await expect(page.locator('.fullcard')).toHaveCount(0);
  await expect(page.locator('[data-drop="stack"] .slot-label b')).toHaveText('1');
  await expect(page.locator('.ticker-text')).toContainText('Ability number 3');
});
