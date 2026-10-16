// End-to-end tests for the Recorder page.
// The real Codegen window needs a person clicking, so the server runs with
// RECORDER_FAKE_CODEGEN (playwright/fixtures/fake-codegen.js): a stand-in that writes
// Codegen-style output a few lines at a time, exactly like a live recording.
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { RecordingSummary } from '../support/api-types';
import { captureEvidence } from '../support/evidence';

// The recorder handles one recording at a time, so these tests must not overlap.
test.describe.configure({ mode: 'serial' });

const FAKE_URL = 'https://demo-bank.example.com/login';
const unique = (base: string): string => `${base}-${Date.now().toString(36)}`;

test.beforeEach(async ({ request }) => {
  await request.post('/api/recorder/discard');
});

test.afterAll(async ({ request }) => {
  // Remove anything these tests saved.
  const list: RecordingSummary[] = await (await request.get('/api/recordings')).json();
  for (const r of list.filter((r) => /^(ui|api)-/.test(r.name))) {
    await request.delete(`/api/recordings/${r.name}`);
  }
});

test.describe('Recorder page', () => {
  test('records live, shows the clean-up, saves, runs and deletes a test', { tag: '@R14' }, async ({ page }, testInfo) => {
    const name = unique('ui-invalid-login');
    await page.goto('/recorder.html');

    await page.getByLabel('Test name').fill(name);
    await page.getByLabel('Start page').fill(FAKE_URL);
    await page.getByRole('button', { name: 'Start recording' }).click();

    // While recording: the REC stamp, a Stop button, and steps arriving one by one.
    await expect(page.getByLabel('Recording', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await expect(page.getByLabel('Test name')).toBeDisabled();
    const steps = page.locator('#rec-steps li');
    await expect(steps.first()).toHaveText(`Open "${FAKE_URL}"`);

    // When Codegen exits, the recording is cleaned and the Cleaned tab opens.
    await expect(page.getByLabel('Ready to review', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Cleaned' })).toHaveAttribute('aria-selected', 'true');
    await expect(steps).toHaveText([
      'Open $BANK_URL',
      /^Fill "input-username" with /,
      'Click text "Login"',
      'Check "alert-error" is visible',
    ]);
    await expect(page.locator('#rec-code')).toContainText('page.goto(process.env.BANK_URL)');
    await expect(page.locator('#rec-code')).not.toContainText(FAKE_URL);
    await expect(page.locator('#rec-report')).toContainText('Moved BANK_URL to .env (1 place)');
    await expect(page.locator('#rec-report')).toContainText('Removed 1 extra click before typing');
    await captureEvidence(page, testInfo, 'Cleaned recording: secrets moved to .env');

    // The raw tab still shows exactly what Codegen wrote.
    await page.getByRole('tab', { name: 'As recorded' }).click();
    await expect(page.locator('#rec-code')).toContainText(FAKE_URL);

    // Edit the cleaned code before saving.
    await page.getByRole('tab', { name: 'Cleaned' }).click();
    await page.getByRole('button', { name: 'Edit' }).click();
    const editor = page.getByLabel('Edit test code');
    await editor.fill((await editor.inputValue()).replace('// Review before committing', '// Reviewed in the UI'));
    await page.getByRole('button', { name: 'Save test' }).click();

    // Saved: the session closes and the test is listed.
    await expect(page.locator('#rec-session')).toBeHidden();
    const item = page.locator('.saved-item', { hasText: name });
    await expect(item).toBeVisible();
    await expect(item).toContainText('4 steps');

    await item.getByRole('button', { name: `View code for ${name}` }).click();
    await expect(item.locator('.saved-code')).toContainText('// Reviewed in the UI');

    // Run it from the dashboard: output streams in and ends in a stamped result.
    await item.getByRole('button', { name: `Run ${name}` }).click();
    await expect(item.locator('.status')).toHaveText(/PASS|SKIP|FAIL/, { timeout: 60_000 });
    await expect(item.locator('.log-lines .log-line').first()).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await item.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(item).toBeHidden();
  });

  test('Stop ends a recording early and keeps what was captured', { tag: '@R14' }, async ({ page }) => {
    await page.goto('/recorder.html');
    await page.getByLabel('Test name').fill(unique('ui-stopped'));
    await page.getByLabel('Start page').fill(FAKE_URL);
    await page.getByRole('button', { name: 'Start recording' }).click();

    await expect(page.locator('#rec-steps li').first()).toBeVisible();
    await page.getByRole('button', { name: 'Stop recording' }).click();

    await expect(page.getByLabel('Ready to review', { exact: true })).toBeVisible();
    const count = await page.locator('#rec-steps li').count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(4); // stopped before the fake finished all four steps

    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('#rec-session')).toBeHidden();
    await expect(page.getByLabel('Test name')).toBeEnabled();
  });

  test('explains what to fix when the name is invalid', { tag: ['@R14', '@R15'] }, async ({ page }) => {
    await page.goto('/recorder.html');
    await page.getByLabel('Test name').fill('My Test!');
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByRole('alert')).toContainText('lowercase letters, numbers and dashes');
    await expect(page.locator('#rec-session')).toBeHidden();
  });

  test('finished recording view has no WCAG 2.1 A/AA violations', { tag: ['@R12', '@R14'] }, async ({ page }) => {
    await page.goto('/recorder.html');
    await page.getByLabel('Test name').fill(unique('ui-a11y'));
    await page.getByLabel('Start page').fill(FAKE_URL);
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByLabel('Ready to review', { exact: true })).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} element(s)`);
    expect(summary, summary.join('\n')).toEqual([]);
  });
});

test.describe('Recorder API', { tag: '@R15' }, () => {
  test('rejects bad input with 400 and a reason', async ({ request }) => {
    const bad = [
      { name: '../../server', url: FAKE_URL },
      { name: 'Has Spaces', url: FAKE_URL },
      { name: 'ok-name', url: 'javascript:alert(1)' },
      { name: 'ok-name', url: FAKE_URL, browser: 'netscape' },
      { name: 'ok-name', url: FAKE_URL, device: 'Nokia 3310' },
    ];
    for (const body of bad) {
      const res = await request.post('/api/recorder/start', { data: body });
      expect(res.status(), JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
  });

  test('only one recording runs at a time (409)', async ({ request }) => {
    const first = await request.post('/api/recorder/start', { data: { name: unique('api-one'), url: FAKE_URL } });
    expect(first.status()).toBe(201);
    const second = await request.post('/api/recorder/start', { data: { name: unique('api-two'), url: FAKE_URL } });
    expect(second.status()).toBe(409);
    await request.post('/api/recorder/discard');
  });

  test('cannot save when nothing is finished, or stop when nothing is recording', async ({ request }) => {
    expect((await request.post('/api/recorder/save', { data: {} })).status()).toBe(409);
    expect((await request.post('/api/recorder/stop')).status()).toBe(409);
  });

  test('saved recordings reject path traversal and unknown names', async ({ request }) => {
    for (const name of ['..%2F..%2Fserver', '%2Fetc%2Fpasswd', 'UPPER']) {
      const res = await request.get(`/api/recordings/${name}`);
      expect([400, 404]).toContain(res.status());
    }
    expect((await request.get('/api/recordings/does-not-exist')).status()).toBe(404);
    expect((await request.delete('/api/recordings/does-not-exist')).status()).toBe(404);
  });
});
