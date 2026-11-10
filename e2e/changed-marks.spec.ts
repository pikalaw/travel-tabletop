import { test, expect } from '@playwright/test';
import { OPEN, point, startOneDevice, playFromHand, idsIn, drag, tapCard, barButton, resetBar, answerDialog, unblind, watchErrors } from './helpers';

test('changed marks: a left border in the changer\'s role colour, cleared by the next player\'s first change', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const bar = (id: string) => page.locator(`[data-card="${id}"] > .changed-bar`);

  // Player 1 (active) plays two cards and taps one: red borders, the tapped one too
  await playFromHand(page, 'p1.battlefield', 2);
  const [a, b] = await idsIn(page, 'p1.battlefield');
  const row = page.locator('[data-drop="p1.battlefield"]');
  if (await row.getAttribute('data-collapsed')) await tapCard(page, b!); // the first tap opens a collapsed row
  await tapCard(page, b!);
  await expect(page.locator(`[data-card="${b}"].tapped`)).toHaveCount(1);
  for (const id of [a!, b!]) await expect(bar(id)).toHaveClass(/\batk\b/);
  // on a tapped card the border spans the turned picture, on the left of the frame
  const frame = (await page.locator(`[data-card="${b}"]`).boundingBox())!;
  const tb = (await bar(b!).boundingBox())!;
  expect(Math.abs(tb.x - frame.x)).toBeLessThan(2);
  expect(tb.height).toBeLessThan(frame.height - 10);

  // the pass: Player 1's marks stay, now blue (Player 1 defends)
  await resetBar(page); await barButton(page, 'Pass turn'); await answerDialog(page, true);
  await unblind(page, 'Player 2');
  for (const id of [a!, b!]) await expect(bar(id)).toHaveClass(/\bdef\b/);
  // drawing changes no card in play, so nothing clears
  await page.locator('.c33 .pile').click();
  await page.getByRole('button', { name: 'Draw 1' }).click();
  await barButton(page, 'Done');
  await expect(bar(a!)).toHaveCount(1);
  // Player 2's first change clears them; its own card gets a red border
  await drag(page, page.locator('[data-drop="p2.hand"] [data-card]').first(), page.locator('[data-drop="p2.battlefield"]'));
  const [c] = await idsIn(page, 'p2.battlefield');
  await expect(bar(c!)).toHaveClass(/\batk\b/);
  for (const id of [a!, b!]) await expect(bar(id)).toHaveCount(0);
  // undo brings the previous turn's marks back
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(bar(a!)).toHaveClass(/\bdef\b/);
  errs.expectNone();
});

test('only the active player, or a blinded table, sees Pass turn', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  const pass = page.locator('.bar').first().getByRole('button', { name: 'Pass turn', exact: true });
  await expect(pass).toHaveCount(1); // Player 1 is active
  await resetBar(page); await barButton(page, 'Pass turn'); await answerDialog(page, true);
  // blinded by the pass: the table may pass
  await expect(page.getByRole('button', { name: 'Unblind to Player 2' })).toBeVisible();
  await expect(pass).toHaveCount(1);
  // Player 1 unblinds during Player 2's turn: no Pass turn, in the footer or the menu
  await unblind(page, 'Player 1');
  await expect(pass).toHaveCount(0);
  await page.locator('.bar [aria-label="Menu"]').scrollIntoViewIfNeeded();
  await page.locator('.bar [aria-label="Menu"]').click();
  await expect(page.getByText('Pass the turn')).toHaveCount(0);
  errs.expectNone();
});

test('one device: passing the turn turns the blinded board to the next player; undo turns it back', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page); // Player 1 active and looking
  const board = page.locator('.board');
  await expect(board).toHaveClass(/\bpersp-p1\b/);
  await resetBar(page); await barButton(page, 'Pass turn'); await answerDialog(page, true);
  await expect(board).toHaveClass(/\bpersp-p2\b/); // blinded, facing Player 2
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.turn-label')).toContainText('Turn 1', { ignoreCase: true });
  await expect(board).toHaveClass(/\bpersp-p1\b/);
  errs.expectNone();
});

test('one device: starting combat blinds the hand, so both players can look at the board', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page); // Player 1 is looking, hand face up
  await expect(page.locator('.board')).not.toContainText('hand (hidden)');
  await resetBar(page); await barButton(page, 'Combat');
  await expect(page.locator('.board')).toContainText('hand (hidden)');
  await expect(page.locator('.board')).toHaveClass(/\bpersp-p1\b/); // still the active player's side
  await barButton(page, 'Pause');
  await expect(page.getByRole('button', { name: 'Unblind to Player 1' })).toBeVisible();
  errs.expectNone();
});

test('combat and attach modes: a crowded slot opens first, from its strip or from a card; then taps act on cards', async ({ page }) => {
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield', 3);
  const row = page.locator('[data-drop="p1.battlefield"]');
  await expect(row).toHaveAttribute('data-collapsed', /.+/);
  const ids = await idsIn(page, 'p1.battlefield');
  const strip = async () => { const rb = (await row.boundingBox())!; await page.mouse.click(rb.x + rb.width - 10, rb.y + 4); };

  await resetBar(page); await barButton(page, 'Combat');
  // a tap on a card of the crowded row opens the row and marks nothing
  const p0 = await point(page, `.board [data-card="${ids[0]}"]`, 0.1, 0.6);
  await page.mouse.click(p0.x, p0.y);
  await expect(row).toHaveClass(OPEN);
  await expect(page.locator('[data-drop="p1.battlefield"] .mark.atk')).toHaveCount(0);
  // now a tap marks the card it lands on
  await tapCard(page, ids[1]!);
  await expect(page.locator(`[data-card="${ids[1]}"] .mark.atk`)).toHaveCount(1);
  // the strip closes it, then opens it again, still in combat
  await strip();
  await expect(row).not.toHaveClass(OPEN);
  await strip();
  await expect(row).toHaveClass(OPEN);
  await expect(page.locator('.bar.combat')).toHaveCount(1);
  await strip();
  await barButton(page, 'Pause');

  // attach mode: the strip opens the crowded slot instead of asking for a card
  await unblind(page, 'Player 1');
  const handCard = (await idsIn(page, 'p1.hand'))[0]!;
  await page.locator(`[data-card="${handCard}"]`).first().click({ button: 'right' });
  await barButton(page, 'Attach');
  await strip();
  await expect(row).toHaveClass(OPEN);
  await expect(page.locator('.bar').first()).toContainText('tap the card to attach it to');
  errs.expectNone();
});
