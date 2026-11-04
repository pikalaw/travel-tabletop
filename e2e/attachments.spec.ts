import { test, expect } from '@playwright/test';
import { longPress, startOneDevice, playFromHand, idsIn, barButton, answerDialog, watchErrors } from './helpers';

test('attachments: attach, redirect to the host, viewer, tap, fan, detach, follow the host, undo', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const bf = page.locator('[data-drop="p1.battlefield"]');
  const p2bf = page.locator('[data-drop="p2.battlefield"]');
  const ticker = page.locator('.ticker-text');
  await playFromHand(page, 'p1.battlefield', 2);
  const [host, second] = await idsIn(page, 'p1.battlefield');

  // attach a hand card to the first battlefield card
  await longPress(page, page.locator('[data-drop="p1.hand"] [data-card]').first());
  await barButton(page, 'Attach');
  await expect(page.locator('.bar').first()).toContainText('tap the card to attach it to');
  await page.locator(`[data-card="${host}"]`).click();
  await expect(ticker).toContainText(/Player 1 attached .+ to .+/);
  await expect(bf.locator('.card.tucked')).toHaveCount(1);
  await expect(bf.locator('.att-count')).toHaveText(['+1']);

  // attaching onto a tucked strip goes to its host
  await longPress(page, page.locator(`[data-card="${second}"]`));
  await barButton(page, 'Attach');
  const strip = (await bf.locator('.card.tucked').first().boundingBox())!;
  await page.mouse.click(strip.x + 6, strip.y + strip.height / 2);
  await expect(bf.locator('.att-count')).toHaveText(['+2']);
  await expect(bf.locator('.card.tucked')).toHaveCount(2);

  // the group viewer: host plus two attachments; an attachment offers Detach
  await longPress(page, page.locator(`[data-card="${host}"]`));
  await expect(page.locator('.full-thumbs .thumb')).toHaveCount(3);
  await expect(page.locator('.fullcard-meta')).toContainText('2 attached');
  await page.locator('.full-thumbs .thumb').nth(1).click();
  await expect(page.locator('.bar').first().getByRole('button', { name: 'Detach', exact: true })).toHaveCount(1);
  await expect(page.locator('.fullcard-meta')).toContainText('Attached to');
  // the host's thumb goes back to the host (swipes step between groups; see full-view.spec)
  await page.locator('.full-thumbs .thumb').nth(0).click();
  await expect(page.locator('.full-thumbs .thumb').nth(0)).toHaveClass(/\bon\b/);
  await barButton(page, 'Close');

  // tapping a strip taps the host
  const s2 = (await bf.locator('.card.tucked').first().boundingBox())!;
  await page.mouse.click(s2.x + 6, s2.y + s2.height / 2);
  await expect(ticker).toContainText(/Player 1 tapped /);

  // tapping the slot's "tap to open" strip (top right, above the cards) fans the group; Close slot folds it
  const fb = (await bf.boundingBox())!;
  await page.mouse.click(fb.x + fb.width - 10, fb.y + 4);
  await expect(bf).toHaveAttribute('data-fanned', /.+/);
  await expect(bf.locator('.card.tucked')).toHaveCount(0);
  await expect(bf.locator('.link-bar')).toHaveCount(2); // a gold bar joins each attached card to the next
  await barButton(page, 'Close slot');
  await expect(bf.locator('.link-bar')).toHaveCount(0);
  await expect(bf).not.toHaveAttribute('data-fanned', /.*/);

  // detach from the viewer
  await longPress(page, page.locator(`[data-card="${host}"]`));
  await page.locator('.full-thumbs .thumb').nth(1).click();
  await barButton(page, 'Detach');
  await expect(ticker).toContainText(/Player 1 detached /);
  await expect(bf.locator('.att-count')).toHaveText(['+1']);
  await barButton(page, 'Close');

  // grabbing the attached card's strip drags the whole group; it stays attached
  const lands = page.locator('[data-drop="p1.lands"]');
  const strip2 = (await bf.locator('.card.tucked').first().boundingBox())!;
  const lb = (await lands.boundingBox())!;
  await page.mouse.move(strip2.x + 6, strip2.y + strip2.height / 2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(strip2.x + 6 + (lb.x + lb.width / 2 - strip2.x - 6) * i / 12, strip2.y + strip2.height / 2 + (lb.y + lb.height / 2 - strip2.y - strip2.height / 2) * i / 12);
    await page.waitForTimeout(10);
    if (i === 6) await expect(page.locator('.drag-ghost.group > *')).toHaveCount(2);
  }
  await page.mouse.up(); await page.waitForTimeout(250);
  await expect(lands.locator('[data-card]')).toHaveCount(2);
  await expect(lands.locator('.card.tucked')).toHaveCount(1);
  await expect(lands.locator(`[data-card="${host}"] .att-count`)).toHaveText('+1');

  // moving the host (grabbed by its own face, left of the strips) takes its attachment along
  const dragFrom = async (to: string) => {
    const t = (await page.locator(to).boundingBox())!;
    const from = (await page.locator(`[data-card="${host}"]`).boundingBox())!;
    const a = { x: from.x + 40, y: from.y + from.height / 2 };
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(a.x + (t.x + t.width / 2 - a.x) * i / 12, a.y + (t.y + t.height / 2 - a.y) * i / 12);
      await page.waitForTimeout(10);
      // the whole group follows the finger: the card and its attachment
      if (i === 6) await expect(page.locator('.drag-ghost.group > *')).toHaveCount(2);
    }
    await page.mouse.up(); await page.waitForTimeout(250);
  };
  await dragFrom('[data-drop="p2.battlefield"]');
  await expect(p2bf.locator('[data-card]')).toHaveCount(2);
  await expect(p2bf.locator('.card.tucked')).toHaveCount(1);
  // the host to a graveyard: the attachment stays, detached
  await dragFrom('.pile[data-drop="p2.graveyard"]');
  await expect(p2bf.locator('[data-card]')).toHaveCount(1);
  await expect(p2bf.locator('.card.tucked')).toHaveCount(0);
  await expect(ticker).toContainText('→ Player 2\'s graveyard');
  await barButton(page, 'Undo');
  await expect(p2bf.locator('.card.tucked')).toHaveCount(1);
  errs.expectNone();
});

test('Detach all asks first, then frees the whole group in one step; Undo brings it back', async ({ page }) => {
  await startOneDevice(page);
  const bf = page.locator('[data-drop="p1.battlefield"]');
  await playFromHand(page, 'p1.battlefield', 1);
  const [host] = await idsIn(page, 'p1.battlefield');
  for (let i = 0; i < 2; i++) {
    await longPress(page, page.locator('[data-drop="p1.hand"] [data-card]').first());
    await barButton(page, 'Attach');
    const h = (await page.locator(`[data-card="${host}"]`).boundingBox())!;
    await page.mouse.click(h.x + h.width * 0.7, h.y + h.height * 0.6);
    await page.waitForTimeout(250);
  }
  await expect(bf.locator('.att-count')).toHaveText(['+2']);
  // from an attached card's view too: open the strip
  const strip = (await bf.locator('.card.tucked').first().boundingBox())!;
  await page.mouse.move(strip.x + 6, strip.y + strip.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await expect(page.locator('.fullcard-meta')).toContainText('Attached to');
  await barButton(page, 'Detach all');
  await expect(page.locator('.confirm-box.plain')).toContainText('This detaches all 2 cards attached to');
  await answerDialog(page, false);
  await expect(bf.locator('.card.tucked')).toHaveCount(2);
  await barButton(page, 'Detach all');
  await answerDialog(page, true);
  await expect(bf.locator('.card.tucked')).toHaveCount(0);
  await expect(bf.locator('.att-count')).toHaveCount(0);
  await expect(page.locator('.ticker-text')).toContainText(/detached 2 cards from/);
  await expect(page.locator('.bar').first().getByRole('button', { name: 'Detach all' })).toHaveCount(0);
  await barButton(page, 'Close');
  await barButton(page, 'Undo');
  await expect(bf.locator('.att-count')).toHaveText(['+2']);
});
