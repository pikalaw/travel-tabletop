import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockScryfall, importDeck, pickDecks, unblind, watchErrors } from './helpers';

test.use({ viewport: { width: 844, height: 700 } });

test('back up a deck with its tokens, restore it offline on another device, play with it', async ({ browser }, info) => {
  // device A: import a deck that makes tokens, back it up
  const A = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 844, height: 700 } })).newPage();
  const errs = watchErrors(A);
  await mockScryfall(A, { tokens: { 'Aang, Air Nomad': ['Ally'] } });
  await importDeck(A, 'My Aang', '2 Aang, Air Nomad\n1 Badgermole\n20 Plains');
  await expect(A.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await A.getByText('← Decks').click();
  await A.getByRole('button', { name: 'Back up' }).click();
  await A.getByText('Select none').click();
  await expect(A.locator('.deck-check', { hasText: 'Sample: Ember' }).locator('input')).toBeDisabled(); // built in
  await A.locator('.deck-check', { hasText: 'My Aang' }).first().click();
  await expect(A.locator('.deck-check', { hasText: 'My Aang · tokens' })).toContainText('included with its decks');
  const dl = A.waitForEvent('download');
  await A.locator('button', { hasText: 'to a file' }).click();
  const path = info.outputPath('my-aang.mtgdecks');
  await (await dl).saveAs(path);
  const head = readFileSync(path).subarray(0, 2).toString('latin1');
  expect(head).toBe('PK'); // a zip

  // device B: empty; restore the file with the network off
  const Bctx = await browser.newContext({ viewport: { width: 844, height: 700 } });
  const B = await Bctx.newPage();
  await B.goto('index.html');
  await B.getByRole('button', { name: 'Decks' }).click();
  await B.getByRole('button', { name: 'Restore', exact: true }).click();
  await B.setInputFiles('input[type=file]', path);
  await expect(B.locator('.status-tag')).toHaveCount(2);
  await expect(B.locator('.status-tag')).toHaveText(['New', 'New']);
  await Bctx.setOffline(true);
  await B.locator('button', { hasText: 'Restore 2' }).click();
  await expect(B.getByText('Restored')).toBeVisible({ timeout: 30_000 });

  // restoring the same file again: every deck is already here, selected to update in place
  await B.getByText('Go to decks').click();
  await B.getByRole('button', { name: 'Restore', exact: true }).click();
  await B.setInputFiles('input[type=file]', path);
  await expect(B.locator('.status-tag').first()).toBeVisible();
  for (const t of await B.locator('.status-tag').allInnerTexts()) expect(t).toBe('Will update');
  await expect(B.locator('.deck-check.on')).toHaveCount(2);
  await B.locator('button', { hasText: 'Restore 2' }).click();
  await expect(B.getByText('0 added, 2 updated')).toBeVisible({ timeout: 30_000 });
  await B.getByText('Go to decks').click();
  await expect(B.locator('.deck-row', { hasText: 'My Aang' })).toHaveCount(2); // the deck and its tokens, no copies

  // play an offline game with the restored deck; its images load
  await B.getByText('← Home').click();
  await B.getByRole('button', { name: 'New game' }).click();
  await pickDecks(B, [['My Aang'], ['My Aang']]);
  await B.getByRole('button', { name: 'Start game' }).click();
  await B.waitForSelector('.board');
  await unblind(B, 'Player 1');
  await expect.poll(() => B.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.c52 img')].filter((i) => i.complete && i.naturalWidth > 0).length)).toBe(7);
  errs.expectNone();
});

test('a deck with the same name shows as a possible duplicate; a damaged file is refused', async ({ browser }, info) => {
  const A = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await mockScryfall(A);
  await importDeck(A, 'Mono White', '20 Plains');
  await expect(A.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await A.getByText('← Decks').click();
  await A.getByRole('button', { name: 'Back up' }).click();
  await A.getByText('Select none').click();
  await A.locator('.deck-check', { hasText: 'Mono White' }).first().click();
  const dl = A.waitForEvent('download');
  await A.locator('button', { hasText: 'to a file' }).click();
  const path = info.outputPath('mono.mtgdecks');
  await (await dl).saveAs(path);

  const C = await (await browser.newContext()).newPage();
  await mockScryfall(C);
  await importDeck(C, 'Mono White', '7 Plains');
  await expect(C.getByText('Imported')).toBeVisible({ timeout: 20_000 });
  await C.getByText('← Decks').click();
  await C.getByRole('button', { name: 'Restore', exact: true }).click();
  await C.setInputFiles('input[type=file]', path);
  await expect(C.locator('.status-tag')).toHaveText(['Possible duplicate: Mono White']);
  await expect(C.locator('.deck-check.on')).toHaveCount(0);

  await C.getByText('← Decks').click();
  await C.getByRole('button', { name: 'Restore', exact: true }).click();
  await C.setInputFiles('input[type=file]', { name: 'bad.mtgdecks', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip') });
  await expect(C.locator('.error')).toBeVisible();
});
