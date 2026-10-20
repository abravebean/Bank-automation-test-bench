// The public results page (site/index.html), as published to GitHub Pages.
//
// The playground runs Ledgerline's real rules engine (lib/demo-bank/bank.js, bundled for the
// browser), so these tests double as a check that the bundle behaves like the server.
// CI results are mocked with page.route, so passing, failing and missing results are each
// tested on purpose instead of depending on whatever the last real run produced.
import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { captureEvidence } from '../support/evidence';

type Outcome = 'passed' | 'failed' | 'skipped';

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'compliance', 'requirements.json'), 'utf8'));

// Every file:line the playground links to, so its "Proven by" lines can show a result.
const ATTACK_TESTS: Record<string, string[]> = {
  R17: ['bank/bank-api.spec.ts:19', 'unit/demo-bank.spec.ts:46', 'bank/bank-ui.spec.ts:80'],
  R18: ['bank/bank-api.spec.ts:34', 'unit/demo-bank.spec.ts:61', 'bank/bank-ui.spec.ts:53', 'bank/bank-api.spec.ts:47', 'unit/demo-bank.spec.ts:69'],
  R19: ['bank/bank-api.spec.ts:100', 'bank/bank-api.spec.ts:90'],
  R20: ['bank/bank-api.spec.ts:132', 'unit/demo-bank.spec.ts:107', 'bank/bank-api.spec.ts:143'],
  R21: ['unit/demo-bank.spec.ts:135', 'bank/bank-api.spec.ts:169'],
  R22: ['bank/bank-api.spec.ts:186', 'bank/bank-api.spec.ts:214'],
};

/** An evidence.json in the shape the compliance reporter writes. */
function evidence({ failing = [] as string[] } = {}) {
  let n = 0;
  const requirements = catalog.requirements.map((req: { id: string }) => {
    const locs = ATTACK_TESTS[req.id] ?? (req.id === 'R16' ? [] : ['unit/demo-bank.spec.ts:1']);
    const tests = locs.map((loc) => {
      const [file, line] = loc.split(':');
      const outcome: Outcome = failing.includes(req.id) ? 'failed' : 'passed';
      return { id: `t${++n}`, title: `Suite › test ${n}`, file, line: Number(line), project: file.startsWith('unit') ? 'unit' : 'bank', requirements: [req.id], outcome, attempts: 1, durationMs: 40 + n, startedAt: null, steps: ['Step one', 'Step two'], error: outcome === 'failed' ? 'Expected 422, received 201' : null, skipReason: null, evidence: [] };
    });
    const status = !tests.length ? 'no-tests' : tests.some((t) => t.outcome === 'failed') ? 'failed' : 'passed';
    return { ...req, tests, status };
  });
  const count = (key: string) => requirements.filter((r: { status: string }) => r.status === key).length;
  return {
    reportVersion: 1,
    generatedAt: '2026-10-19T12:00:00.000Z',
    run: { status: failing.length ? 'failed' : 'passed', startedAt: '2026-10-19T12:00:00.000Z', commit: '0123456789abcdef0123456789abcdef01234567', ciRun: 'https://github.com/abravebean/Bank-automation-test-bench/actions/runs/1' },
    totals: { requirements: Object.fromEntries(['passed', 'failed', 'no-tests'].map((k) => [k, count(k)]).filter(([, v]) => v)), tests: { passed: n } },
    requirements,
    untraced: [],
    unknownTags: [],
  };
}

const LOAD_SUMMARY = {
  passed: true, requests: 12345, users: 25, seconds: 61, rps: 202.4, errorRatePct: 0,
  labels: [{ label: 'Transfer $1.00', count: 4000, errors: 0, p50: 4, p95: 9, p99: 15, max: 40, budget: 400, ok: true }],
  money: { mismatches: 0, totalAfter: 500, expected: 500, created: 25 }, failures: [],
};
const JUNIT = '<testsuites><testsuite><testcase name="a"/><testcase name="b"/></testsuite></testsuites>';

async function mockResults(page: Page, body: object | null) {
  await page.route('**/compliance/evidence.json', (route) =>
    body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, body: 'Not found' })
  );
  await page.route('**/api/*.xml', (route) => route.fulfill({ contentType: 'application/xml', body: JUNIT }));
  await page.route('**/load/summary.json', (route) => route.fulfill({ json: LOAD_SUMMARY }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
}

async function runAttack(page: Page, id: string) {
  await page.locator(`#attack-${id}`).click();
  await expect(page.locator(`#attack-${id}`)).toHaveAttribute('aria-disabled', 'false', { timeout: 20_000 });
}

const stamp = (page: Page) => page.getByTestId('stamp');

test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('Live results page', { tag: '@R25' }, () => {
  test.beforeEach(async ({ page }) => {
    await mockResults(page, evidence());
  });

  test('every playground attack is blocked by the real bank engine', async ({ page }, testInfo) => {
    await page.goto('/');
    const attacks = await page.locator('.attack').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id!));
    expect(attacks).toHaveLength(9);

    for (const id of attacks) {
      await test.step(`attack: ${id}`, async () => {
        await runAttack(page, id);
        await expect(stamp(page)).toHaveText(/BLOCKED/);
        await expect(page.locator('#tape-body .ln.bad')).toHaveCount(0);
        await expect(page.locator(`#res-${id}`)).toHaveText('BLOCKED');
      });
    }

    await expect(page.locator('#tried')).toHaveText('9');
    await expect(page.locator('#through')).toHaveText('0');
    await expect(page.locator('#victory')).toContainText('Ledgerline held against all 9 attacks');
    await captureEvidence(page, testInfo, 'All nine attacks blocked');
  });

  test('race attack: 20 simultaneous $100 transfers from $1,000, exactly 10 succeed', async ({ page }) => {
    await page.goto('/');
    await runAttack(page, 'race');
    await expect(page.locator('.race i.ok')).toHaveCount(10);
    await expect(page.locator('.race i.no')).toHaveCount(10);
    await expect(page.locator('#tape-body')).toContainText('Balance ended at $0.00, never below zero');
  });

  test('attacks on Alex leave his balances exactly right', async ({ page }) => {
    await page.goto('/');
    const checking = page.getByTestId('balance-checking');
    await expect(checking).toHaveText('$3,250.00');
    await runAttack(page, 'overdraft');
    await expect(checking).toHaveText('$3,250.00');
    await runAttack(page, 'double'); // $25.00 sent twice with one Idempotency-Key
    await expect(checking).toHaveText('$3,225.00');
    await expect(page.locator('#limit-text')).toHaveText('Transferred today: $25.00 of $2,500.00');
  });

  test('free play: refusals and approvals name the requirement that covers them', async ({ page }) => {
    await page.goto('/');
    const amount = page.getByLabel('Amount ($)');
    const send = page.getByRole('button', { name: 'Transfer', exact: true });

    for (const [value, reqId] of [['0', 'R17'], ['12.345', 'R17'], ['99999', 'R18']]) {
      await amount.fill(value);
      await send.click();
      await expect(stamp(page)).toContainText('REFUSED');
      await expect(page.locator('#tape-body .req-pill')).toHaveText(reqId);
    }

    await amount.fill('40');
    await send.click();
    await expect(stamp(page)).toContainText('APPROVED');
    await expect(page.getByTestId('balance-checking')).toHaveText('$3,210.00');
    await expect(page.getByTestId('balance-savings')).toHaveText('$12,440.00');
  });

  test('"Proven by" links go to the exact test and show its latest result', async ({ page }) => {
    await page.goto('/');
    await runAttack(page, 'idor');
    const first = page.locator('#tape-body .proof li a').first();
    await expect(first).toHaveAttribute('href', 'https://github.com/abravebean/Bank-automation-test-bench/blob/main/playwright/bank/bank-api.spec.ts#L100');
    await expect(first).toContainText('passed in CI');
    await expect(page.locator('#tape-body .proof')).toContainText('AuthorizationTest');
  });

  test('shows the latest CI run: verdict, commit and requirement counts', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#verdict')).toHaveText('✓ ALL PASSING');
    await expect(page.locator('#run-meta a').first()).toHaveAttribute('href', /commit\/0123456789abcdef/);
    await expect(page.locator('#reqlegend')).toContainText(`${catalog.requirements.length - 1} passed`);
    await expect(page.locator('#reqlegend')).toContainText('1 no tests yet');
    await expect(page.locator('#r-api')).toHaveText('2 checks passed');
    await expect(page.locator('#r-load')).toHaveText('passed · 202.4 req/s');
    await expect(page.locator('#r-load-desc')).toContainText('transfers p95 9 ms. Money conserved: yes.');
  });

  test('a failing requirement turns the verdict red and is listed as failed', async ({ page }) => {
    await page.unroute('**/compliance/evidence.json');
    await mockResults(page, evidence({ failing: ['R19'] }));
    await page.goto('/');
    await expect(page.locator('#verdict')).toHaveText('✗ 1 FAILING');
    await page.getByRole('button', { name: /^Failed/ }).click();
    await expect(page.locator('.req-tile:not([hidden])')).toHaveCount(1);
    await page.locator('.req-tile[data-req="R19"]').click();
    await expect(page.getByRole('dialog')).toContainText('Expected 422, received 201');
  });

  test('without CI results, requirements still load and the playground still works', async ({ page }) => {
    await page.unroute('**/compliance/evidence.json');
    await mockResults(page, null);
    await page.goto('/');
    await expect(page.locator('#verdict')).toHaveText('NO RESULTS YET');
    await expect(page.locator('.req-tile')).toHaveCount(catalog.requirements.length);
    await runAttack(page, 'overdraft');
    await expect(stamp(page)).toHaveText(/BLOCKED/);
  });

  test('requirements explorer: filter, open a requirement, close and return focus', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^No tests \(gap\)/ }).click();
    await expect(page.locator('.req-tile:not([hidden])')).toHaveCount(1);

    const tile = page.locator('.req-tile[data-req="R16"]');
    await tile.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Known gap');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(tile).toBeFocused();

    await page.getByRole('button', { name: /^All/ }).click();
    await page.locator('.req-tile[data-req="R22"]').click();
    await expect(dialog.locator('.t-list > li')).toHaveCount(ATTACK_TESTS.R22.length);
    await expect(dialog.locator('.t-sub a').first()).toHaveAttribute('href', /bank-api\.spec\.ts#L186$/);
  });

  test('test layers: each layer shows a real excerpt from its tests', async ({ page }) => {
    await page.goto('/');
    for (const id of ['unit', 'api', 'ui', 'java', 'infra']) {
      await page.locator(`#layer-legend [data-l="${id}"]`).click();
      const excerpt = await page.locator('#layer-detail pre').innerText();
      const source = await page.locator(`script[data-code="${id}"]`).evaluate((el) => el.textContent!.trim());
      expect(excerpt.trim()).toBe(source);
    }
    // The unit excerpt must still exist, word for word, in the test file it names.
    const unit = await page.locator('script[data-code="unit"]').evaluate((el) => el.textContent!.trim().split('\n').slice(1).join('\n'));
    const file = fs.readFileSync(path.join(__dirname, '..', 'unit', 'demo-bank.spec.ts'), 'utf8');
    expect(file.replace(/^ {2}/gm, '')).toContain(unit);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no WCAG 2.1 A/AA violations (${colorScheme})`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      await runAttack(page, 'race');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      await testInfo.attach(`axe-${colorScheme}.json`, { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
      if (colorScheme === 'dark') await captureEvidence(page, testInfo, 'Dark mode after the race attack');
    });
  }

  test('fits a phone: no horizontal scrolling at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');
    await runAttack(page, 'race');
    await page.locator('.req-tile').first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Live results page with animations on', { tag: '@R25' }, () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('race attack lands exactly 10 of 20 with real, random request timing', async ({ page }) => {
    await mockResults(page, evidence());
    await page.goto('/');
    await runAttack(page, 'race');
    await expect(page.locator('.race i.ok')).toHaveCount(10);
    await expect(page.locator('.race i.no')).toHaveCount(10);
    await expect(stamp(page)).toHaveText(/BLOCKED/);
  });
});
