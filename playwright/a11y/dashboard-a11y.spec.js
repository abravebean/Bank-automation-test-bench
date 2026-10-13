// Accessibility tests for the dashboard, using axe-core against WCAG 2.1 A/AA rules,
// plus a keyboard-only check that every control can be reached without a mouse.
const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');

test.describe('Dashboard accessibility', () => {
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
    for (let i = 0; i < count + 5; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (label) focused.add(label);
    }
    for (const name of names) {
      expect(focused, `"${name}" was never focused with Tab`).toContain(name);
    }
  });
});
