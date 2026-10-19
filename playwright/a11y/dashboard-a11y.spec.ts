// Accessibility tests for the dashboard, using axe-core against WCAG 2.1 A/AA rules,
// plus a keyboard-only check that every control can be reached without a mouse.
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { captureEvidence } from '../support/evidence';

test.describe('Dashboard accessibility', { tag: '@R12' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait until the test list has rendered so axe scans the real page, not the loading state.
    await expect(page.locator('.test-row').first()).toBeVisible();
  });

  test('has no WCAG 2.1 A/AA violations', async ({ page }, testInfo) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    await testInfo.attach('axe-results.json', {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });

    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} element(s)`);
    await captureEvidence(page, testInfo, `Tests page scanned: ${results.passes.length} rules passed, ${results.violations.length} violations`);
    expect(summary, summary.join('\n')).toEqual([]);
  });

  test('every Run button is reachable and has an accessible name', async ({ page }) => {
    const buttons = page.locator('.test-run-btn');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    // Each per-test button needs a unique name, or a screen reader just hears "Run, Run, Run".
    const names = [];
    for (let i = 0; i < count; i++) names.push(await buttons.nth(i).getAttribute('aria-label'));
    expect(names.every((n) => n && n.startsWith('Run '))).toBe(true);
    expect(new Set(names).size).toBe(count);

    // Tab from the top of the page and record which buttons receive focus.
    const focused = new Set();
    // Enough presses to pass the nav, Run all and the filter, then every Run button.
    for (let i = 0; i < count * 2 + 20; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (label) focused.add(label);
    }
    for (const name of names) {
      expect(focused, `"${name}" was never focused with Tab`).toContain(name);
    }
  });
});

test.describe('Recorder page accessibility', { tag: '@R12' }, () => {
  test('has no WCAG 2.1 A/AA violations before a recording starts', async ({ page }, testInfo) => {
    await page.goto('/recorder.html');
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} element(s)`);
    await captureEvidence(page, testInfo, `Recorder page scanned: ${results.passes.length} rules passed, ${results.violations.length} violations`);
    expect(summary, summary.join('\n')).toEqual([]);
  });
});
