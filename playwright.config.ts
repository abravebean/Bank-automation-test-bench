// Playwright Test configuration.
//   npm run test:pw    -> UI tests on Chromium, Firefox, WebKit + API tests
//   npm run test:api   -> API, data-integrity and performance tests (no bank credentials needed)
//   npm run test:a11y  -> accessibility tests on the dashboard
//   npm run record -- <name> -> record a new test with Codegen (see scripts/record.js)
import 'dotenv/config';
import path from 'path';
import os from 'os';
import { defineConfig, devices } from '@playwright/test';
import { defineBddProject } from 'playwright-bdd';

// The API tests start the dashboard server on its own port so they never
// collide with a copy you already have running on 3000.
const API_PORT = process.env.API_TEST_PORT || 3199;

export default defineConfig({
  testDir: './playwright',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { open: process.env.CI ? 'never' : 'on-failure' }],
    // Audit-ready evidence: requirement -> tests -> steps -> screenshots (compliance-report/index.html)
    ['./playwright/reporters/compliance-reporter.ts', { outputDir: 'compliance-report' }],
    ...(process.env.CI
      ? ([
          ['junit', { outputFile: 'test-results/junit.xml' }],
          // Raw results, merged across CI jobs into one compliance report (see .github/workflows).
          ['blob', { fileName: `report-${process.env.CI_JOB_ID ?? 'local'}.zip` }],
        ] as const)
      : []),
  ],
  use: {
    headless: process.env.HEADLESS !== 'false',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    url: `http://localhost:${API_PORT}/api/tests`,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      // The Recorder tests use a scripted stand-in for the interactive Codegen window,
      // and save into a temp folder so they never touch playwright/recorded/.
      RECORDER_FAKE_CODEGEN: path.join(__dirname, 'playwright', 'fixtures', 'fake-codegen.js'),
      FAKE_CODEGEN_STEP_MS: '400',
      RECORDINGS_DIR: path.join(os.tmpdir(), `testbench-recordings-${API_PORT}`),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    // Fast unit tests for helper code (no browser, no server needed).
    { name: 'unit', testMatch: 'unit/**/*.spec.ts' },
    // Tests recorded with `npm run record` (Playwright Codegen).
    {
      name: 'recorded',
      testMatch: 'recorded/**/*.spec.{ts,js}',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    {
      name: 'api',
      testMatch: 'api/**/*.spec.ts',
      use: { baseURL: `http://localhost:${API_PORT}` },
    },
    {
      name: 'a11y',
      testMatch: 'a11y/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${API_PORT}`,
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    {
      name: 'dashboard',
      testMatch: 'dashboard/**/*.spec.ts',
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${API_PORT}`,
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    // BDD: Gherkin feature files in features/, step definitions in features/steps/.
    // `npx bddgen` turns each scenario into a Playwright test (in .features-gen/) before a run.
    {
      ...defineBddProject({ name: 'bdd-login', features: 'features/login.feature', steps: 'features/steps/*.ts' }),
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    {
      ...defineBddProject({ name: 'bdd-recorder', features: 'features/recorder.feature', steps: 'features/steps/*.ts' }),
      // The recorder handles one recording at a time, so wait for the other Recorder tests to finish.
      dependencies: ['dashboard'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${API_PORT}`,
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    {
      name: 'chromium',
      testMatch: 'specs/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Optional: point at a system Chromium (e.g. in Docker) instead of Playwright's download.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
    { name: 'firefox', testMatch: 'specs/**/*.spec.ts', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testMatch: 'specs/**/*.spec.ts', use: { ...devices['Desktop Safari'] } },
  ],
});
