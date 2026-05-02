import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — boots Vite dev server, hits the real Django backend.
 * The auth/checkout/editor flows must exercise the contract end-to-end;
 * mocking would defeat the point. See the playwright-frontend-test skill.
 *
 * The Django backend is NOT booted by this config — assume the user
 * runs `make up` in the backend repo before running e2e specs. Adding a
 * second webServer entry is possible but requires a clean way to detect
 * "already running" on the backend side. Keeping it manual for now.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Add Firefox / WebKit on CI when the matrix matters.
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
