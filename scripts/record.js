#!/usr/bin/env node
// Record a new test by clicking through the app.
//
//   npm run record -- <test-name> [--device "iPhone 13"] [--browser firefox] [--force]
//
// Opens a browser plus the Playwright Inspector. Every click and keystroke is
// written as Playwright code. Close the browser to finish; the recording is then
// cleaned up (secrets -> env vars, redundant clicks removed, test renamed) and
// saved to playwright/recorded/<test-name>.spec.js.
require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sanitizeRecording, findLeftoverSecrets } = require('../lib/recording');

function parseArgs(argv) {
  const args = { name: null, device: null, browser: 'chromium', force: false, url: process.env.BANK_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--device') args.device = argv[++i];
    else if (a === '--browser') args.browser = argv[++i];
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--force') args.force = true;
    else if (!args.name) args.name = a;
  }
  return args;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (!args.name || !/^[a-z0-9][a-z0-9-]*$/.test(args.name)) {
  fail('Give the test a name in kebab-case, e.g.  npm run record -- login-happy-path');
}
if (!args.url) {
  fail('No URL to record against. Set BANK_URL in .env or pass --url <url>.');
}

const outDir = path.join(__dirname, '..', 'playwright', 'recorded');
const outFile = path.join(outDir, `${args.name}.spec.js`);
const rawFile = path.join(outDir, `.${args.name}.raw.js`);

if (fs.existsSync(outFile) && !args.force) {
  fail(`${path.relative(process.cwd(), outFile)} already exists. Pick another name or add --force.`);
}
fs.mkdirSync(outDir, { recursive: true });

const codegenArgs = [
  'playwright', 'codegen',
  '--target=playwright-test',
  '--test-id-attribute=data-testid', // prefer the app's data-testid attributes, like LoginPage.js does
  `--browser=${args.browser}`,
  '-o', rawFile,
];
if (args.device) codegenArgs.push(`--device=${args.device}`);
codegenArgs.push(args.url);

console.log(`\n● Recording "${args.name}" against ${args.url}`);
console.log('  Click through the flow in the browser. Use the Inspector toolbar to add assertions.');
console.log('  Close the browser window when you are done.\n');

const result = spawnSync('npx', codegenArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) fail('Codegen exited with an error.');
if (!fs.existsSync(rawFile)) fail('Nothing was recorded.');

const raw = fs.readFileSync(rawFile, 'utf8');
fs.unlinkSync(rawFile);

const { code, report } = sanitizeRecording(raw, { name: args.name, env: process.env });
fs.writeFileSync(outFile, code);

console.log(`✓ Saved ${path.relative(process.cwd(), outFile)}`);
for (const line of report) console.log(`  • ${line}`);

const leftovers = findLeftoverSecrets(code, process.env);
if (leftovers.length) {
  console.warn(`\n⚠ ${leftovers.join(', ')} still appears in the file. Check it before committing.`);
}
console.log(`\nRun it:  npx playwright test playwright/recorded/${args.name}.spec.js --project=recorded --headed\n`);
