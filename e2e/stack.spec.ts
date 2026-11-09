import { test, expect, type Page } from '@playwright/test';
import { startOneDevice, playFromHand, idsIn, drag, longPress, barButton, watchErrors } from './helpers';

/** Swipe across the full view's card: dx < 0 goes further down the stack. */
async function swipe(page: Page, dx: number) {
  const r = (await page.locator('.fullcard-inner').boundingBox())!;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 6 }); await page.mouse.up();
}

/** Drag the full view's card up and drop it on a slot. */
async function dragUpTo(page: Page, zone: string) {
  const r = (await page.locator('.fullcard-inner').boundingBox())!;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx, cy - 80, { steps: 6 });
  await expect(page.locator('.fullcard')).toHaveCount(0);
  const to = (await page.locator(`[data-drop="${zone}"]`).boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('the stack in the full view: top first, swipes step down it, any item can be dragged off', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const caption = page.locator('.full-caption');
  const shown = page.locator('.fullcard-inner');

  // an empty stack does nothing
  await page.locator('[data-drop="stack"]').click();
  await expect(page.locator('.fullcard')).toHaveCount(0);

  // three spells, then an ability (Custom…, since sample cards have no rules text) on top
  const spells: string[] = [];
  for (let i = 0; i < 3; i++) {
    await drag(page, page.locator('[data-drop="p1.hand"] [data-card]').last(), page.locator('[data-drop="stack"]'));
    spells.unshift((await idsIn(page, 'stack'))[0]!);
  }
  await playFromHand(page, 'p1.battlefield', 1);
  const [src] = await idsIn(page, 'p1.battlefield');
  await longPress(page, page.locator(`.board [data-card="${src}"]`));
  await expect(page.locator('.abilities .ability')).toHaveText(['Custom…']);
  await page.locator('.abilities .ability.custom').click();
  await page.locator('.dialog-input').fill('Scry 1');
  await page.locator('.confirm-box .btn.yes').click();
  await barButton(page, 'Close');
  const stack = await idsIn(page, 'stack'); // every item is drawn, the top first
  expect(stack.slice(1)).toEqual(spells);

  // a tap on the pile opens its top item: the ability, with nothing to flip, tap or count
  await page.locator('[data-drop="stack"]').click();
  await expect(caption).toHaveText('Stack 1 of 4 · resolves first');
  await expect(page.locator('.fullcard-meta b')).toHaveText(/^Ability of /);
  await expect(page.locator('.fullcard-meta .ability-text')).toHaveText('Scry 1');
  const bar = page.locator('.bar').first();
  await expect(bar.getByRole('button', { name: 'Flip' })).toHaveCount(0);
  await expect(bar.locator('[data-counter]')).toHaveCount(0);

  // swipes step down the stack, and back up
  await swipe(page, -120);
  await expect(caption).toHaveText('Stack 2 of 4');
  await expect(shown).toHaveAttribute('data-card-target', spells[0]!);
  await swipe(page, -120);
  await swipe(page, -120);
  await expect(caption).toHaveText('Stack 4 of 4');
  await expect(page.locator('.full-step.next')).toHaveClass(/off/);
  await swipe(page, 120);
  await expect(caption).toHaveText('Stack 3 of 4');

  // drag an item from the middle up to the graveyard; the view closes, the rest stay in order
  await dragUpTo(page, 'p1.graveyard');
  await expect.poll(() => idsIn(page, 'p1.graveyard')).toContain(spells[1]!);
  expect(await idsIn(page, 'stack')).toEqual([stack[0], spells[0], spells[2]]);

  // resolve the ability: drag it off the stack, and it is gone
  await page.locator('[data-drop="stack"]').click();
  await dragUpTo(page, 'p1.battlefield');
  await expect.poll(() => idsIn(page, 'stack')).toEqual([spells[0], spells[2]]);
  expect(await idsIn(page, 'p1.battlefield')).toEqual([src]);
  errs.expectNone();
});
