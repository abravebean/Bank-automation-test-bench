// Used only by `npx playwright merge-reports` in CI: combines the raw results (blob
// reports) from the API job and the cross-browser UI job into one HTML report and one
// compliance evidence report covering every requirement.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './playwright',
  reporter: [
    ['./playwright/reporters/compliance-reporter.ts', { outputDir: 'compliance-report' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
});
