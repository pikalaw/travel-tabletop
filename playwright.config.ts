import { defineConfig, devices } from '@playwright/test';

// Browser scenarios. They target whatever E2E_BASE_URL serves; by default a static server
// on the repository root (v1). From the v2 scaffold on, the web server becomes `vite preview`.
const port = Number(process.env.E2E_PORT || 8768);
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${port}/`;

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
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `python3 -m http.server ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
