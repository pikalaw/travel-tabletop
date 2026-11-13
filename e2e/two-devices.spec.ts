import { test, expect } from '@playwright/test';
import { drag, startTwoDevices, pairByText, barButton, watchErrors } from './helpers';

test.use({ viewport: { width: 844, height: 390 } });

test('two devices: pair by text, play, alerts, pointing, undo, dice', async ({ browser }) => {
  const H = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  const G = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  const eh = watchErrors(H), eg = watchErrors(G);
  const { offer, answer } = await startTwoDevices(H, G);
  expect(offer.startsWith('MTG1o')).toBe(true);
  expect(answer.startsWith('MTG1a')).toBe(true);
  await expect(H.locator('.status')).toHaveText('Connected');
  await expect(G.locator('.status')).toHaveText('Connected');
  await expect(G.locator('.c52 [data-card]')).toHaveCount(7);
  await expect(H.locator('.c12 .opp-hand')).toContainText('7 in hand', { ignoreCase: true });

  // the guest plays a card; the host sees it
  await drag(G, G.locator('.c52 [data-card]').first(), G.locator('.c32 .row'), { fy: 0.8 });
  await expect(H.locator('.c22 [data-card]')).toHaveCount(1);

  // the host looks at its library: the guest gets an alert
  await H.locator('.c33 .pile').click();
  await H.getByText('Look at top 1').click();
  await expect(G.locator('.toast', { hasText: 'looking at the top 1' })).toHaveCount(1);
  await H.locator('.sheet').getByRole('button', { name: 'Done' }).click();
  await barButton(H, 'Done');

  // the host points at the guest's card: the guest sees the ring
  await barButton(H, 'Point');
  await H.locator('.c22 [data-card]').first().click();
  await expect(G.locator('.pointer-ring')).toHaveCount(1);

  // the guest undoes its move
  await G.getByRole('button', { name: 'Undo' }).click();
  await expect(H.locator('.c22 [data-card]')).toHaveCount(0);
  // both devices offer Redo, named after the move; the host's Redo brings it back; the guest undoes again
  for (const pg of [H, G]) await expect(pg.locator('.bar').first().getByRole('button', { name: 'Redo', exact: true })).toHaveAttribute('data-tip', /^Redo: Claire: /);
  await H.locator('.bar').first().getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(H.locator('.c22 [data-card]')).toHaveCount(1);
  await expect(G.locator('.bar').first().getByRole('button', { name: 'Redo', exact: true })).toHaveCount(0);
  await G.getByRole('button', { name: 'Undo' }).click();
  await expect(H.locator('.c22 [data-card]')).toHaveCount(0);

  // dice results show on both devices
  await barButton(G, 'Dice');
  await G.getByText('d20').click();
  await expect(H.locator('.toast', { hasText: 'rolled a d20' })).toHaveCount(1);
  eh.expectNone(); eg.expectNone();
});

test('two devices: the guest leaves and reconnects; the host resumes after a reload; log export', async ({ browser }) => {
  test.setTimeout(90_000);
  const gc = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const H = await (await browser.newContext({ viewport: { width: 844, height: 390 }, acceptDownloads: true })).newPage();
  let G = await gc.newPage();
  await startTwoDevices(H, G);
  await drag(G, G.locator('.c52 [data-card]').first(), G.locator('.c32 .row'), { fy: 0.8 });
  await expect(H.locator('.c22 [data-card]')).toHaveCount(1);

  // the guest closes the app; the host notices and keeps playing
  await G.close();
  await expect(H.locator('.status')).toContainText('disconnected', { ignoreCase: true, timeout: 15_000 });
  await drag(H, H.locator('.c52 [data-card]').first(), H.locator('.c42 .row'), { fy: 0.8 });
  await expect(H.locator('.c42 [data-card]')).toHaveCount(1);

  // the guest reopens the app and reconnects
  G = await gc.newPage();
  await G.goto('index.html');
  await expect(G.getByText('Joined game')).toBeVisible();
  await H.locator('.status').click();
  await H.waitForSelector('.sheet');
  await pairByText(H, G, async () => { await G.getByRole('button', { name: /^Reconnect to/ }).click(); });
  await G.waitForSelector('.board', { timeout: 20_000 });
  await expect(G.locator('.c12 [data-card]')).toHaveCount(1); // the host's land
  await expect(G.locator('.c32 [data-card]')).toHaveCount(1); // its own card
  await expect(H.locator('.status')).toHaveText('Connected');

  // the host reloads: the game link reopens the saved game, with its undo history
  await H.reload();
  await H.waitForSelector('.board');
  await expect(H.locator('.c42 [data-card]')).toHaveCount(1);
  await expect(H.locator('.c22 [data-card]')).toHaveCount(1);
  await H.getByRole('button', { name: 'Undo' }).click();
  await expect(H.locator('.c42 [data-card]')).toHaveCount(0);

  // export the action log
  await H.locator('.bar [aria-label="Menu"]').scrollIntoViewIfNeeded();
  await H.locator('.bar [aria-label="Menu"]').click();
  const dl = H.waitForEvent('download');
  await H.getByText('Export action log').click();
  const text = await (await (await dl).createReadStream()).toArray();
  const lines = Buffer.concat(text).toString().trim().split('\n').map((l) => JSON.parse(l));
  expect(lines[0].kind).toBe('manifest');
  const kinds = new Set(lines.map((l) => l.kind));
  for (const k of ['command', 'snapshot', 'undo']) expect(kinds.has(k)).toBe(true);
});

test('two devices: the host can let the guest go first', async ({ browser }) => {
  const H = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  const G = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
  const eh = watchErrors(H), eg = watchErrors(G);
  await startTwoDevices(H, G, { guestFirst: true });
  for (const pg of [H, G]) await expect(pg.locator('.turn-label')).toContainText('Claire', { ignoreCase: true });
  // the guest has Pass turn; the host doesn't
  await expect(G.locator('.bar').first().getByRole('button', { name: 'Pass turn', exact: true })).toHaveCount(1);
  await expect(H.locator('.bar').first().getByRole('button', { name: 'Pass turn', exact: true })).toHaveCount(0);
  eh.expectNone(); eg.expectNone();
});
