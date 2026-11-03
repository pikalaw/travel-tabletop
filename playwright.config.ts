import { defineConfig, devices } from '@playwright/test';

// Browser scenarios. By default they build the app and run against `vite preview`, served
// under the same /travel-tabletop/ path as GitHub Pages. Set E2E_BASE_URL to aim them at
// any other server instead, e.g. v1 (tag `v1`) checked out and served as static files.
const port = Number(process.env.E2E_PORT || 8768);
const external = process.env.E2E_BASE_URL;
const baseURL = external || `http://localhost:${port}/travel-tabletop/`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    viewport: { width: 412, height: 840 },
    deviceScaleFactor: 2,
    trace: 'retain-on-failure',
  },
  // WebRTC between two browser contexts on one machine needs real local candidates, not mDNS names.
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'], viewport: { width: 412, height: 840 }, deviceScaleFactor: 2,
      launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] },
    },
  }],
  ...(external ? {} : {
    webServer: {
      command: `npx vite build && npx vite preview --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  }),
});
