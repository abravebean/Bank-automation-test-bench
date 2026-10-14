// Playwright Test configuration.
//   npm run test:pw    -> UI tests on Chromium, Firefox, WebKit + API tests
//   npm run test:api   -> API, data-integrity and performance tests (no bank credentials needed)
//   npm run test:a11y  -> accessibility tests on the dashboard
//   npm run record -- <name> -> record a new test with Codegen (see scripts/record.js)
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

// The API tests start the dashboard server on its own port so they never
// collide with a copy you already have running on 3000.
const API_PORT = process.env.API_TEST_PORT || 3199;

module.exports = defineConfig({
  testDir: './playwright',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    headless: process.env.HEADLESS !== 'false',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    url: `http://localhost:${API_PORT}/api/tests`,
    env: { PORT: String(API_PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    // Fast unit tests for helper code (no browser, no server needed).
    { name: 'unit', testMatch: 'unit/**/*.spec.js' },
    // Tests recorded with `npm run record` (Playwright Codegen).
    {
      name: 'recorded',
      testMatch: 'recorded/**/*.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    {
      name: 'api',
      testMatch: 'api/**/*.spec.js',
      use: { baseURL: `http://localhost:${API_PORT}` },
    },
    {
      name: 'a11y',
      testMatch: 'a11y/**/*.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${API_PORT}`,
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    {
      name: 'chromium',
      testMatch: 'specs/**/*.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        // Optional: point at a system Chromium (e.g. in Docker) instead of Playwright's download.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    { name: 'firefox', testMatch: 'specs/**/*.spec.js', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: 'specs/**/*.spec.js', use: { ...devices['Desktop Safari'] } },
  ],
});
