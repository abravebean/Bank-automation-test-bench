// Post-processing for tests recorded with Playwright Codegen.
// Codegen writes exactly what you did, including the URL and any username or
// password you typed. This turns that raw recording into a test that is safe
// to commit and fits the rest of the suite.

function quote(value) {
  // Codegen writes strings in single quotes and escapes \ and '.
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function replaceLiteral(code, value, replacement) {
  if (!value || String(value).length < 3) return { code, count: 0 }; // too short to replace safely
  const parts = code.split(quote(value));
  return { code: parts.join(replacement), count: parts.length - 1 };
}

/**
 * @param {string} raw   Codegen output (--target=playwright-test)
 * @param {object} opts
 * @param {string} opts.name      test name to use instead of Codegen's default 'test'
 * @param {object} [opts.env]     values to swap for environment variables
 * @returns {{ code: string, report: string[] }}
 */
function sanitizeRecording(raw, { name, env = {} }) {
  let code = raw.replace(/\r\n/g, '\n');
  const report = [];

  // 1. CommonJS, to match the rest of the project.
  code = code.replace(
    /^import \{ test, expect \} from '@playwright\/test';$/m,
    "const { test, expect } = require('@playwright/test');"
  );

  // 2. Secrets and environment-specific values come from .env, never source code.
  const swaps = [
    ['BANK_URL', env.BANK_URL],
    ['BANK_USERNAME', env.BANK_USERNAME],
    ['BANK_PASSWORD', env.BANK_PASSWORD],
  ];
  for (const [key, value] of swaps) {
    const result = replaceLiteral(code, value, `process.env.${key}`);
    code = result.code;
    if (result.count) report.push(`Replaced ${result.count} hard-coded ${key} value(s) with process.env.${key}`);
  }

  // 3. Codegen records a click before every fill. fill() already focuses the field, so drop the click.
  const lines = code.split('\n');
  const kept = [];
  let removedClicks = 0;
  for (let i = 0; i < lines.length; i++) {
    const click = lines[i].match(/^(\s*)await (page\..+)\.click\(\);$/);
    const next = lines[i + 1] && lines[i + 1].match(/^\s*await (page\..+)\.fill\(/);
    if (click && next && click[2] === next[1]) {
      removedClicks++;
      continue;
    }
    kept.push(lines[i]);
  }
  code = kept.join('\n');
  if (removedClicks) report.push(`Removed ${removedClicks} redundant click(s) before fill()`);

  // 4. A real test name instead of Codegen's default, and a skip when the environment isn't set up.
  code = code.replace(
    /test\('test', async \(\{ page \}\) => \{\n/,
    `test(${quote(name)}, async ({ page }) => {\n` +
      "  test.skip(!process.env.BANK_URL, 'BANK_URL is not set');\n"
  );

  const header =
    `// Recorded with Playwright Codegen (npm run record -- ${name}) and cleaned up by scripts/record.js.\n` +
    '// Review before committing: add assertions, and move reusable steps into a Page Object.\n';
  code = header + code.trimEnd() + '\n';

  return { code, report };
}

/** Warn if anything that still looks like a secret survived. */
function findLeftoverSecrets(code, env = {}) {
  return ['BANK_USERNAME', 'BANK_PASSWORD'].filter((k) => env[k] && code.includes(env[k]));
}

module.exports = { sanitizeRecording, findLeftoverSecrets };
