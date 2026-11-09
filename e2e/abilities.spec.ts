import { test, expect } from '@playwright/test';
import { mockScryfall, importDeck, pickDecks, unblind, longPress, barButton, drag, idsIn, playFromHand, watchErrors } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

const ELF = '{T}: Add {G}.\nWhen this creature enters, choose one —\n• Draw a card.\n• Scry 2.';

test('abilities: the full view lists them; a tap or Custom… puts one on the stack; dragging it off removes it', async ({ page }) => {
  const errs = watchErrors(page);
  await mockScryfall(page, { oracle: { 'Elf Test': ELF } });
  await importDeck(page, 'Elves', '20 Elf Test');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await page.getByText('← Decks').click();
  await page.getByText('← Home').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Elves'], ['Elves']]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');
  await playFromHand(page, 'p1.battlefield', 1);
  const [elf] = await idsIn(page, 'p1.battlefield');
  // the pile draws only its top card; its label counts them all
  const stackCount = page.locator('[data-drop="stack"] .slot-label b');

  // one button per Oracle paragraph (the modes join their line), then Custom…
  await longPress(page, page.locator(`.board [data-card="${elf}"]`));
  const list = page.locator('.abilities .ability');
  await expect(list).toHaveText(['{T}: Add {G}.', 'When this creature enters, choose one —\n• Draw a card.\n• Scry 2.', 'Custom…']);
  await list.nth(1).click();
  await expect(page.locator('.ticker-text')).toContainText('put an ability of Elf Test on the stack');
  await expect(stackCount).toHaveText('1');
  // the source card in play is marked as changed
  await expect(page.locator(`.board [data-card="${elf}"] .changed-bar`)).toHaveCount(1);

  // Custom… asks for any text
  await page.locator('.abilities .ability.custom').click();
  await page.locator('.dialog-input').fill('Draw a card at the next end step');
  await page.locator('.confirm-box .btn.yes').click();
  await expect(stackCount).toHaveText('2');
  await barButton(page, 'Close');

  // the pile shows the newest item: the source's picture with an ability band
  const top = page.locator('[data-drop="stack"] [data-card]').first();
  await expect(top.locator('.ability-band')).toContainText('Draw a card at the next end step');

  // resolving an ability: drag it off the stack; it is removed, and its source stays put
  const grave = (await idsIn(page, 'p1.graveyard')).length;
  await drag(page, top, page.locator('[data-drop="p1.graveyard"]'));
  await expect(stackCount).toHaveText('1');
  expect((await idsIn(page, 'p1.graveyard')).length).toBe(grave);
  expect(await idsIn(page, 'p1.battlefield')).toEqual([elf]);
  errs.expectNone();
});

test('a card with no rules text offers only Custom…; an ability item shows its own text', async ({ page }) => {
  await mockScryfall(page, { oracle: { 'Elf Test': ELF } });
  await importDeck(page, 'Mixed', '10 Elf Test\n10 Bear Test');
  await expect(page.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await page.getByText('← Decks').click();
  await page.getByText('← Home').click();
  await page.getByRole('button', { name: 'New game' }).click();
  await pickDecks(page, [['Mixed'], ['Mixed']]);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.waitForSelector('.board');
  await unblind(page, 'Player 1');
  const hand = page.locator('[data-drop="p1.hand"] [data-card]');
  // find a Bear in hand (no text) and an Elf
  let bear = -1, elf = -1;
  for (let i = 0; i < 7; i++) {
    const alt = await hand.nth(i).locator('img').getAttribute('alt');
    if (alt === 'Bear Test' && bear < 0) bear = i;
    if (alt === 'Elf Test' && elf < 0) elf = i;
  }
  test.skip(bear < 0 || elf < 0, 'the opening hand lacks one of the two cards');
  await longPress(page, hand.nth(bear));
  await expect(page.locator('.abilities .ability')).toHaveText(['Custom…']);
  await barButton(page, 'Close');
  // an ability from a card in hand (cycling, say)
  await longPress(page, hand.nth(elf));
  await page.locator('.abilities .ability').first().click();
  await barButton(page, 'Close');
  await page.locator('[data-drop="stack"]').click(); // the stack opens in the full view
  await expect(page.locator('.fullcard-meta b')).toHaveText('Ability of Elf Test');
  await expect(page.locator('.fullcard-meta .ability-text')).toHaveText('{T}: Add {G}.');
  await expect(page.locator('.abilities')).toHaveCount(0);
});
