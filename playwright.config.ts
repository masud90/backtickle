import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.WD_UI_PORT ?? 1420);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/ui',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    // WebKit is the default: it is the same engine family as the macOS app.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // Plain Vite dev server: the page runs on the in-memory mock platform.
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
