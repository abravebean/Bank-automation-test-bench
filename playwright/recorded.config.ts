// Config used when the dashboard runs a saved recording (POST /api/recordings/:name/run).
// Kept separate from playwright.config.js so a run never starts the dashboard server
// or touches the main test-results folder.
import 'dotenv/config';
import os from 'os';
import path from 'path';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: process.env.RECORDINGS_DIR || path.join(__dirname, 'recorded'),
  testMatch: '*.spec.{ts,js}',
  outputDir: path.join(os.tmpdir(), 'testbench-recorded-runs'),
  timeout: 45_000,
  retries: 0,
  use: {
    ...devices['Desktop Chrome'],
    headless: process.env.HEADLESS !== 'false',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
  },
});
