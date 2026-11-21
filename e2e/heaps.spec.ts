import { test, expect, type Page } from '@playwright/test';
import { barButton, drag, startOneDevice, answerDialog, tapCard, inOpenRow, watchErrors } from './helpers';

/** Make `n` Soldier tokens on Player 1's battlefield from the Tokens sheet. */
async function soldiers(page: Page, n: number) {
  await barButton(page, 'Tokens');
  // the list is sorted by name, which arrives with the pictures: wait until the token stops moving
  const item = page.locator('.sheet .token-item[data-token-name="Soldier"]');
  await expect.poll(async () => {
    const a = await item.boundingBox(); await page.waitForTimeout(250); const b = await item.boundingBox();
    return !!a && !!b && a.x === b.x && a.y === b.y;
  }).toBe(true);
  // a mouse that jumps straight from the footer to a press loses the first drag: move over it first
  await item.hover();
  for (let i = 0; i < n; i++) await drag(page, item, page.locator('[data-drop="p1.battlefield"]'));
  await expect(page.locator('.row-box:has([data-drop="p1.battlefield"]) .slot-label b')).toHaveText(String(n));
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).click();
}

const field = (page: Page) => page.locator('[data-drop="p1.battlefield"] .row-cards > .card');
const heapOf = (page: Page) => page.locator('[data-drop="p1.battlefield"] .card.heap');

async function passTurn(page: Page) {
  // On one device a pass blinds the hand; the Pass turn button works blinded too.
  await barButton(page, 'Pass turn');
  await answerDialog(page, true);
}

test('heaps: identical cards are one card with ×N; a tap takes one out; the untap heaps them again', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await soldiers(page, 3);
  await expect(field(page)).toHaveCount(1);
  await expect(heapOf(page).locator('.heap-count')).toHaveText('×3');

  // a tap taps one card: a heap of two and a tapped Soldier
  const first = (await heapOf(page).getAttribute('data-card'))!;
  await tapCard(page, first);
  await expect(field(page)).toHaveCount(2);
  await expect(heapOf(page).locator('.heap-count')).toHaveText('×2');
  await expect(page.locator(`[data-card="${first}"].tapped`)).toHaveCount(1);
  await expect(page.locator('.ticker-text')).toContainText('tapped Soldier');

  // two passes: Player 1's untap, and the borders gone, so all three heap again
  await passTurn(page);
  await passTurn(page);
  await expect(field(page)).toHaveCount(1);
  await expect(heapOf(page).locator('.heap-count')).toHaveText('×3');

  // a hand never heaps
  await expect(page.locator('.hand .heap-count, [data-drop="p1.hand"] .heap-count')).toHaveCount(0);
  errs.expectNone();
});

test('heaps in combat: each attacker marked from a heap is its own card; End combat heaps the attackers again', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await soldiers(page, 4);
  await passTurn(page); await passTurn(page); // no borders, so the four are one heap
  await expect(heapOf(page).locator('.heap-count')).toHaveText('×4');

  await barButton(page, 'Combat');
  await tapCard(page, (await heapOf(page).getAttribute('data-card'))!);
  await expect(heapOf(page).locator('.heap-count')).toHaveText('×3');
  // the attacker turned sideways and widened the row, so mark the next one with the row open
  await inOpenRow(page, 'p1.battlefield', async () => {
    await tapCard(page, (await heapOf(page).getAttribute('data-card'))!);
    await expect(page.locator('[data-drop="p1.battlefield"] .mark.atk')).toHaveText(['⚔1', '⚔2']);
    await expect(heapOf(page).locator('.heap-count')).toHaveText('×2');
    await expect(field(page)).toHaveCount(3);
  });

  await barButton(page, 'End combat');
  await answerDialog(page, true);
  // the two tapped attackers share a border and a tapped state: one heap, apart from the two untapped
  await expect(field(page)).toHaveCount(2);
  await expect(page.locator('[data-drop="p1.battlefield"] .heap-count')).toHaveText(['×2', '×2']);
  errs.expectNone();
});
