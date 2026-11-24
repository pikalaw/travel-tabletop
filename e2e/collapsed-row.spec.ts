import { test, expect } from '@playwright/test';
import { playFromHand, startOneDevice, tapCard, watchErrors } from './helpers';

test('a collapsed row of tapped cards still shows a good part of each card, not one card over the others', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 3);
  const row = page.locator('.row[data-drop="p1.battlefield"]');
  const untapped = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.row[data-drop="p1.battlefield"] [data-card]:not(.tapped)')].map((c) => c.dataset.card!));
  for (let left = await untapped(); left.length; left = await untapped()) await tapCard(page, left[0]!);
  // tapping a card in a collapsed row opens it: close it again
  if (/(^|\s)open(\s|$)/.test((await row.getAttribute('class')) ?? '')) {
    const b = (await row.boundingBox())!;
    await page.mouse.click(b.x + b.width - 12, b.y + 4);
  }
  await expect(row).toHaveAttribute('data-collapsed', '1');
  await page.waitForTimeout(500); // the slide animation
  const boxes = await row.evaluate((r) => [...r.querySelectorAll('.row-cards > .card.tapped')].map((c) => { const b = c.getBoundingClientRect(); return { left: b.left, width: b.width }; }));
  expect(boxes).toHaveLength(3);
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left - boxes[i - 1]!.left).toBeGreaterThanOrEqual(0.29 * boxes[i - 1]!.width);
  errs.expectNone();
});
