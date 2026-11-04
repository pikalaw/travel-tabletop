import { test, expect } from '@playwright/test';
import { point, longPress, startOneDevice, playFromHand, idsIn, barButton, answerDialog, watchErrors } from './helpers';

test('full view: ← and → step through the slot, one stop per group; arrow keys too', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 3);
  const [a, b, c] = await idsIn(page, 'p1.battlefield');

  // attach a hand card to the first card, so the slot holds: [a + attachment], b, c
  await longPress(page, page.locator('[data-drop="p1.hand"] [data-card]').first());
  await barButton(page, 'Attach');
  const pa = await point(page, `.board [data-card="${a}"]`, 0.15, 0.5);
  await page.mouse.click(pa.x, pa.y);
  await expect(page.locator('[data-drop="p1.battlefield"] .card.tucked')).toHaveCount(1);

  const shown = page.locator('.fullcard-inner');
  const prev = page.getByRole('button', { name: 'Previous card in this slot' });
  const next = page.getByRole('button', { name: 'Next card in this slot' });

  await longPress(page, page.locator(`[data-card="${c}"]`));
  await expect(shown).toHaveAttribute('data-card-target', c!);
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(shown).toHaveAttribute('data-card-target', b!);
  await prev.click();
  // the group counts once, and opens on its host with the group row
  await expect(shown).toHaveAttribute('data-card-target', a!);
  await expect(page.locator('.fullcard-meta')).toContainText('1 attached');
  await expect(prev).toBeDisabled();
  // from the attachment, → goes past the whole group
  await page.locator('.full-thumbs .thumb').nth(1).click();
  await expect(page.locator('.fullcard-meta')).toContainText('Attached to');
  await next.click();
  await expect(shown).toHaveAttribute('data-card-target', b!);
  await page.keyboard.press('ArrowRight');
  await expect(shown).toHaveAttribute('data-card-target', c!);
  await page.keyboard.press('ArrowLeft');
  await expect(shown).toHaveAttribute('data-card-target', b!);
  await barButton(page, 'Close');

  // the opponent's hand is hidden, so stepping through your own hand stays in your hand
  const hand = await idsIn(page, 'p1.hand');
  await longPress(page, page.locator(`[data-card="${hand[0]}"]`));
  await expect(prev).toBeDisabled();
  await next.click();
  await expect(shown).toHaveAttribute('data-card-target', hand[1]!);
  await barButton(page, 'Close');
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
