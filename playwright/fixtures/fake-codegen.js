// Test double for `npx playwright codegen`, used when RECORDER_FAKE_CODEGEN is set.
// Real Codegen opens a browser and waits for a person to click. This writes the same
// kind of output to the -o file a few lines at a time, then exits like a closed browser.
const fs = require('fs');

const args = process.argv.slice(2);
const out = args[args.indexOf('-o') + 1];
const url = args[args.length - 1];
const user = process.env.BANK_USERNAME || 'demo_user';

const lines = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('test', async ({ page }) => {",
  `  await page.goto('${url}');`,
  "  await page.getByTestId('input-username').click();",
  `  await page.getByTestId('input-username').fill('${user}');`,
  "  await page.getByText('Login', { exact: true }).click();",
  "  await expect(page.getByTestId('alert-error')).toBeVisible();",
  '});',
];

let shown = 4; // header + goto
const write = () => fs.writeFileSync(out, lines.slice(0, shown).join('\n') + '\n' + (shown < lines.length ? '});\n' : ''));
write();

const STEP_MS = Number(process.env.FAKE_CODEGEN_STEP_MS || 250);
const timer = setInterval(() => {
  shown++;
  if (shown >= lines.length) {
    shown = lines.length;
    fs.writeFileSync(out, lines.join('\n') + '\n');
    clearInterval(timer);
    // Stay "open" until killed if FAKE_CODEGEN_HOLD is set (to test the Stop button).
    if (!process.env.FAKE_CODEGEN_HOLD) process.exit(0);
    return;
  }
  write();
}, STEP_MS);

process.on('SIGTERM', () => process.exit(0));
