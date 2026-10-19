import { expect } from '@playwright/test';
import { Given, When, Then } from './fixtures';
import { captureEvidence } from '../../playwright/support/evidence';

Given('I open the Recorder', async ({ recorderPage, request }) => {
  await request.post('/api/recorder/discard'); // start from a clean state
  await recorderPage.goto();
});

When('I record a test named {string} from the configured start page', async ({ recorderPage, ctx }, name: string) => {
  ctx.recordingName = `${name}-${Date.now().toString(36)}`;
  ctx.startUrl = await recorderPage.urlField.inputValue(); // prefilled from BANK_URL
  await recorderPage.startRecording(ctx.recordingName);
  await expect(recorderPage.recordingStamp).toBeVisible();
});

When('I record a test named {string} starting at {string}', async ({ recorderPage, ctx }, name: string, url: string) => {
  // A unique suffix keeps reruns from colliding with a test saved by an earlier run.
  ctx.recordingName = `${name}-${Date.now().toString(36)}`;
  await recorderPage.startRecording(ctx.recordingName, url);
  await expect(recorderPage.recordingStamp).toBeVisible();
});

When('I try to record a test named {string}', async ({ recorderPage }, name: string) => {
  await recorderPage.startRecording(name);
});

Then('each step appears as I click', async ({ recorderPage }) => {
  await expect(recorderPage.steps.first()).toBeVisible();
  await recorderPage.waitUntilFinished();
  await expect(recorderPage.steps).toHaveText([
    'Open $BANK_URL',
    /^Fill "input-username" with /,
    'Click text "Login"',
    'Check "alert-error" is visible',
  ]);
});

Then('the finished code reads the start page from {string} instead of hard-coding it', async ({ recorderPage, page, ctx, $testInfo }, file: string) => {
  await expect(recorderPage.code).toContainText('page.goto(process.env.BANK_URL)');
  await expect(recorderPage.code).not.toContainText(ctx.startUrl!);
  await expect(recorderPage.cleanupReport).toContainText(`Moved BANK_URL to ${file}`);
  await captureEvidence(page, $testInfo, 'Cleaned recording ready to save');
});

When('I save the test', async ({ recorderPage }) => {
  await recorderPage.saveButton.click();
  await expect(recorderPage.session).toBeHidden();
});

Then('the test is listed under saved recordings', async ({ recorderPage, ctx }) => {
  await expect(recorderPage.savedItem(ctx.recordingName!)).toContainText('4 steps');
});

Then('I can delete it', async ({ recorderPage, ctx }) => {
  await recorderPage.deleteSaved(ctx.recordingName!);
  await expect(recorderPage.savedItem(ctx.recordingName!)).toBeHidden();
});

When('I stop the recording after the first step', async ({ recorderPage }) => {
  await expect(recorderPage.steps.first()).toBeVisible();
  await recorderPage.stopButton.click();
});

Then('the recording finishes with fewer than {int} steps', async ({ recorderPage }, max: number) => {
  await recorderPage.waitUntilFinished();
  const count = await recorderPage.steps.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(max);
});

When('I discard the recording', async ({ recorderPage }) => {
  await recorderPage.discardButton.click();
  await expect(recorderPage.session).toBeHidden();
});

Then('I can start a new recording', async ({ recorderPage }) => {
  await expect(recorderPage.nameField).toBeEnabled();
  await expect(recorderPage.startButton).toBeEnabled();
});

Then('I am told to use lowercase letters, numbers and dashes', async ({ recorderPage }) => {
  await expect(recorderPage.formError).toContainText('lowercase letters, numbers and dashes');
});

Then('no recording starts', async ({ recorderPage }) => {
  await expect(recorderPage.session).toBeHidden();
});
