import { test, expect, type Page } from '@playwright/test';
import { startOneDevice, playFromHand, idsIn, tapCard, barButton, resetBar, answerDialog, unblind, watchErrors } from './helpers';

const box = (page: Page) => page.locator('.confirm-box.plain');

test('the browser never shows its own dialog', async ({ page }) => {
  const native: string[] = [];
  page.on('dialog', (d) => { native.push(d.message()); void d.dismiss(); });
  const errs = watchErrors(page);
  await startOneDevice(page);
  await playFromHand(page, 'p1.battlefield');
  const [a] = await idsIn(page, 'p1.battlefield');

  // End combat: counts the marks; Keep fighting keeps them, Clear marks clears them
  await barButton(page, 'Combat'); await tapCard(page, a!); await barButton(page, 'Pause');
  await resetBar(page); await barButton(page, 'End combat');
  await expect(box(page)).toContainText('End combat?');
  await expect(box(page)).toContainText('This clears 1 attacker.');
  await box(page).getByRole('button', { name: 'Keep fighting' }).click();
  await expect(page.locator('.board .mark.atk')).toHaveCount(1);
  await resetBar(page); await barButton(page, 'End combat');
  await box(page).getByRole('button', { name: 'Clear marks' }).click();
  await expect(page.locator('.board .mark.atk')).toHaveCount(0);

  // Pass turn: a tap outside cancels, Enter confirms
  await resetBar(page); await barButton(page, 'Pass turn');
  await expect(box(page)).toContainText('End Player 1’s turn?');
  await expect(box(page).getByRole('button', { name: 'Pass to Player 2' })).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(box(page)).toHaveCount(0);
  await expect(page.locator('.turn-label')).toContainText('Turn 1', { ignoreCase: true });
  await resetBar(page); await barButton(page, 'Pass turn');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(page.locator('.turn-label')).toContainText('Turn 2', { ignoreCase: true });

  // Labeled counter name
  await page.locator('[data-counter="label"]').scrollIntoViewIfNeeded();
  await page.locator('[data-counter="label"]').click();
  await expect(page.locator('.dialog-input')).toHaveValue('loyalty');
  await page.locator('.dialog-input').fill('lore');
  await box(page).getByRole('button', { name: 'Use' }).click();
  await expect(page.locator('[data-counter="label"]')).toHaveText('lore');

  // Typing a player counter value (numeric keypad)
  await page.locator('.counters-cell').click();
  await page.locator('.ctr-val').first().click();
  await expect(page.locator('.dialog-input')).toHaveAttribute('inputmode', 'numeric');
  await page.locator('.dialog-input').fill('17');
  await page.keyboard.press('Enter');
  await expect(page.locator('.counters-cell')).toContainText('17');
  await page.locator('.sheet').getByRole('button', { name: 'Done' }).click();

  // Concede: red button; Escape cancels
  await resetBar(page);
  await page.locator('.bar [aria-label="Menu"]').scrollIntoViewIfNeeded();
  await page.locator('.bar [aria-label="Menu"]').click();
  await page.getByText('Player 1 concedes').click();
  await expect(box(page)).toContainText('Player 1 concedes?');
  await expect(page.locator('.confirm-box.plain.danger')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.result-banner')).toHaveCount(0);

  expect(native).toEqual([]);
  errs.expectNone();
});

test('home and deck dialogs: delete a game, rename and delete a deck', async ({ page }) => {
  const native: string[] = [];
  page.on('dialog', (d) => { native.push(d.message()); void d.dismiss(); });
  await startOneDevice(page);
  await resetBar(page);
  await page.locator('.bar [aria-label="Menu"]').scrollIntoViewIfNeeded();
  await page.locator('.bar [aria-label="Menu"]').click();
  await page.getByText('Leave to home screen').click();
  await page.locator('.page').getByRole('button', { name: 'Delete' }).click();
  await expect(box(page)).toContainText('Delete this game?');
  await answerDialog(page, true);
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Decks' }).click();
  await page.getByText('Sample: Grove (green)').click();
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('.dialog-input')).toHaveValue('Sample: Grove (green)');
  await page.locator('.dialog-input').fill('Grove Test');
  await answerDialog(page, true);
  await expect(page.locator('h1, h2').first()).toHaveText('Grove Test');
  await page.locator('.page').getByRole('button', { name: 'Delete' }).click();
  await expect(box(page)).toContainText('Delete “Grove Test”?');
  await answerDialog(page, false);
  expect(native).toEqual([]);
});

test('Unblind opens a chooser: whose turn it is on top in red, the other below in blue; reload blinds', async ({ page }) => {
  await startOneDevice(page, { unblindTo: null });
  const bg = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
  const unblindBtn = page.getByRole('button', { name: 'Unblind', exact: true });
  await unblindBtn.click();
  const picks = page.locator('.chooser .btn.pick');
  await expect(picks).toHaveCount(2);
  await expect(picks.nth(0)).toContainText('Player 1'); await expect(picks.nth(0)).toContainText('Taking turn 1');
  await expect(picks.nth(1)).toContainText('Player 2'); await expect(picks.nth(1)).toContainText('Defending');
  expect(await bg('.chooser .btn.pick.atk')).toBe('rgb(255, 123, 95)');
  expect(await bg('.chooser .btn.pick.def')).toBe('rgb(122, 167, 255)');
  await page.screenshot({ path: 'test-results/chooser.png' });
  await page.locator('.chooser').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.c52 .slot-label')).toContainText('(HIDDEN)', { ignoreCase: true });

  await unblind(page, 'Player 2');
  await expect(page.locator('.c52 .slot-label')).toContainText('Player 2');
  await expect(page.locator('.c52 .slot-label')).not.toContainText('hidden', { ignoreCase: true });

  // a reload resumes the game blinded
  await page.reload(); await page.waitForSelector('.board');
  await expect(page.locator('.c52 .slot-label')).toContainText('hidden', { ignoreCase: true });
  // a tap outside the dialog cancels
  await unblindBtn.click();
  await page.mouse.click(10, 10);
  await expect(page.locator('.chooser')).toHaveCount(0);
  await expect(page.locator('.c52 .slot-label')).toContainText('hidden', { ignoreCase: true });
});
