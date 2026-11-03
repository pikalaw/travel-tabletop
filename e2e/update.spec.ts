import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { switchServer } from './switch-server';

// Two real builds, A and B, served the way Pages serves a deploy (with a 10-minute max-age).
test('the first visit says "Ready to play offline" once; a new build offers Update now on the home screen only', async ({ browser }) => {
  test.setTimeout(120_000);
  const tmp = mkdtempSync(join(tmpdir(), 'tabletop-builds-'));
  const build = (sha: string) => {
    const out = join(tmp, sha);
    execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { env: { ...process.env, GITHUB_SHA: sha }, stdio: 'pipe' });
    return out;
  };
  const a = build('aaaaaaa1111'), b = build('bbbbbbb2222');
  const server = await switchServer(a, 8790 + (test.info().workerIndex % 10));
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${server.url}index.html`);
    await expect(page.locator('.toast', { hasText: 'Ready to play offline' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.foot')).toContainText('build aaaaaaa');
    await page.reload();
    await page.getByRole('button', { name: 'New game' }).waitFor();
    await page.waitForTimeout(1500);
    await expect(page.locator('.toast', { hasText: 'Ready to play offline' })).toHaveCount(0); // never again

    // Pages starts serving build B; the app finds it when it checks for an update.
    server.use(b);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await expect(page.getByText('A new version is ready.')).toBeVisible({ timeout: 15_000 });

    // In a game the prompt is not shown.
    await page.getByRole('button', { name: 'New game' }).click();
    await page.getByRole('button', { name: 'Start game' }).click();
    await page.waitForSelector('.board');
    await expect(page.getByText('A new version is ready.')).toHaveCount(0);
    await page.locator('.bar [aria-label="Menu"]').click();
    await page.getByText('Leave to home screen').click();

    // Update now: the waiting worker takes over, the page reloads, and build B is running.
    await page.getByRole('button', { name: 'Update now' }).click();
    await expect(page.locator('.foot')).toContainText('build bbbbbbb', { timeout: 15_000 });
    await expect(page.getByText('A new version is ready.')).toHaveCount(0);
    await expect(page.locator('.toast', { hasText: 'Ready to play offline' })).toHaveCount(0);
  } finally {
    await context.close();
    await server.close();
  }
});
