// Unit tests for the Codegen clean-up step (lib/recording.js). No browser needed.
import { test, expect } from '@playwright/test';
import { sanitizeRecording, findLeftoverSecrets } from '../../lib/recording';

const env = {
  BANK_URL: 'https://demo-bank.example.com/login',
  BANK_USERNAME: 'demo_user',
  BANK_PASSWORD: "p@ss'word",
};

// What Codegen actually writes for a login recording.
const RAW = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://demo-bank.example.com/login');
  await page.getByTestId('input-username').click();
  await page.getByTestId('input-username').fill('demo_user');
  await page.getByTestId('input-password').click();
  await page.getByTestId('input-password').fill('p@ss\\'word');
  await page.getByText('Login', { exact: true }).click();
  await expect(page.getByRole('heading')).toContainText('Welcome back');
});
`;

test.describe('sanitizeRecording', { tag: '@R13' }, () => {
  const { code, report } = sanitizeRecording(RAW, { name: 'login-happy-path', env });

  test('removes every hard-coded secret and URL', () => {
    expect(code).not.toContain('demo_user');
    expect(code).not.toContain('p@ss');
    expect(code).not.toContain('demo-bank.example.com');
    expect(code).toContain('page.goto(process.env.BANK_URL)');
    expect(code).toContain('.fill(process.env.BANK_USERNAME)');
    expect(code).toContain('.fill(process.env.BANK_PASSWORD)');
    expect(findLeftoverSecrets(code, env)).toEqual([]);
  });

  test('drops the click before each fill but keeps real clicks', () => {
    expect(code.match(/\.click\(\)/g)).toHaveLength(1); // only the Login button
    expect(code).toContain("getByText('Login', { exact: true }).click()");
    expect(report).toContain('Removed 2 extra clicks before typing');
  });

  test('renames the test, adds a skip guard, and keeps the TypeScript import', () => {
    expect(code).toContain("test('login-happy-path', async ({ page }) => {");
    expect(code).toContain("test.skip(!process.env.BANK_URL, 'BANK_URL is not set');");
    expect(code).toContain("import { test, expect } from '@playwright/test';");
    expect(code).not.toContain('require(');
  });

  test('keeps the assertions recorded in the Inspector', () => {
    expect(code).toContain("await expect(page.getByRole('heading')).toContainText('Welcome back');");
  });

  test('reports what it changed', () => {
    expect(report).toEqual(
      expect.arrayContaining([
        'Moved BANK_URL to .env (1 place)',
        'Moved BANK_USERNAME to .env (1 place)',
        'Moved BANK_PASSWORD to .env (1 place)',
      ])
    );
  });
});

test('does not replace short values that could match unrelated strings', { tag: '@R13' }, () => {
  const { code } = sanitizeRecording(
    "test('test', async ({ page }) => {\n  await page.getByText('ab').click();\n});\n",
    { name: 'x-test', env: { BANK_USERNAME: 'ab' } }
  );
  expect(code).toContain("getByText('ab')");
});

test('flags a secret that survived in an unexpected form', { tag: '@R13' }, () => {
  expect(findLeftoverSecrets('await page.keyboard.type("demo_user")', env)).toEqual(['BANK_USERNAME']);
});
