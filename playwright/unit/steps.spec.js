// Unit tests for lib/steps.js: Playwright code -> plain-English steps shown in the Recorder.
const { test, expect } = require('@playwright/test');
const { parseSteps, describeLocator } = require('../../lib/steps');

test.describe('describeLocator', () => {
  const cases = [
    ["page.getByRole('button', { name: 'Log in' })", 'button "Log in"'],
    ["page.getByRole('button', { name: 'Run login', exact: true })", 'button "Run login"'],
    ["page.getByRole('heading')", 'heading'],
    ["page.getByTestId('input-username')", '"input-username"'],
    ["page.getByLabel('Email')", 'field labeled "Email"'],
    ["page.getByPlaceholder('Search')", 'field "Search"'],
    ["page.getByText('Login', { exact: true })", 'text "Login"'],
    ["page.locator('#main > .card')", 'element #main > .card'],
    ["page.getByText('It\\'s here')", 'text "It\'s here"'],
  ];
  for (const [expr, expected] of cases) {
    test(`${expr} -> ${expected}`, () => {
      expect(describeLocator(expr)).toBe(expected);
    });
  }
});

test('parses a full recording into numbered, typed steps', () => {
  const code = [
    "const { test, expect } = require('@playwright/test');",
    "test('x', async ({ page }) => {",
    "  test.skip(!process.env.BANK_URL, 'BANK_URL is not set');",
    '  await page.goto(process.env.BANK_URL);',
    '  await page.getByTestId(\'input-username\').fill(process.env.BANK_USERNAME);',
    "  await page.getByTestId('input-password').press('Enter');",
    "  await page.getByLabel('Account').selectOption('savings');",
    "  await expect(page.getByTestId('alert-error')).toBeVisible();",
    "  await expect(page.getByRole('heading')).not.toContainText('Welcome');",
    '});',
  ].join('\n');

  expect(parseSteps(code)).toEqual([
    { line: 4, kind: 'navigate', text: 'Open $BANK_URL' },
    { line: 5, kind: 'action', text: 'Fill "input-username" with $BANK_USERNAME' },
    { line: 6, kind: 'action', text: 'Press "Enter" in "input-password"' },
    { line: 7, kind: 'action', text: 'Select "savings" in field labeled "Account"' },
    { line: 8, kind: 'assert', text: 'Check "alert-error" is visible' },
    { line: 9, kind: 'assert', text: 'Check heading not contains "Welcome"' },
  ]);
});

test('ignores lines that are not steps', () => {
  expect(parseSteps("// comment\nconst a = 1;\n});\n")).toEqual([]);
  expect(parseSteps('')).toEqual([]);
});
