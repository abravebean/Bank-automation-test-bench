// Page Object for the dashboard's Recorder page (public/recorder.html).
import { expect, type Locator, type Page } from '@playwright/test';

export class RecorderPage {
  readonly nameField: Locator;
  readonly urlField: Locator;
  readonly startButton: Locator;
  readonly stopButton: Locator;
  readonly formError: Locator;
  readonly session: Locator;
  readonly recordingStamp: Locator;
  readonly finishedStamp: Locator;
  readonly steps: Locator;
  readonly code: Locator;
  readonly cleanupReport: Locator;
  readonly saveButton: Locator;
  readonly discardButton: Locator;

  constructor(readonly page: Page) {
    this.nameField = page.getByLabel('Test name');
    this.urlField = page.getByLabel('Start page');
    this.startButton = page.getByRole('button', { name: 'Start recording' });
    this.stopButton = page.getByRole('button', { name: 'Stop recording' });
    this.formError = page.locator('#rec-form-error');
    this.session = page.locator('#rec-session');
    this.recordingStamp = page.getByLabel('Recording', { exact: true });
    this.finishedStamp = page.getByLabel('Ready to review', { exact: true });
    this.steps = page.locator('#rec-steps li');
    this.code = page.locator('#rec-code');
    this.cleanupReport = page.locator('#rec-report');
    this.saveButton = page.getByRole('button', { name: 'Save test' });
    this.discardButton = page.getByRole('button', { name: 'Discard' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/recorder.html');
    await expect(this.startButton).toBeVisible();
  }

  async startRecording(name: string, url?: string): Promise<void> {
    await this.nameField.fill(name);
    if (url) await this.urlField.fill(url);
    await this.startButton.click();
  }

  async waitUntilFinished(): Promise<void> {
    await expect(this.finishedStamp).toBeVisible({ timeout: 15_000 });
  }

  savedItem(name: string): Locator {
    return this.page.locator('.saved-item', { hasText: name });
  }

  async deleteSaved(name: string): Promise<void> {
    this.page.once('dialog', (dialog) => dialog.accept());
    await this.savedItem(name).getByRole('button', { name: `Delete ${name}` }).click();
  }
}
