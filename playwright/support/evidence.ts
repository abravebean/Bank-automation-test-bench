import type { Page, TestInfo } from '@playwright/test';

/**
 * Attach a full-page screenshot as compliance evidence.
 * The compliance reporter picks up every attachment whose name starts with "evidence:"
 * and shows it under the requirement the test is tagged with, pass or fail.
 */
export async function captureEvidence(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  await testInfo.attach(`evidence: ${label}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

/** Read a required environment variable, or undefined if it's missing or empty. */
export function env(name: 'BANK_URL' | 'BANK_USERNAME' | 'BANK_PASSWORD' | 'DATABASE_URL'): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}
