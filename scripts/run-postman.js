#!/usr/bin/env node
// Runs the Postman collections with Newman.
//
//   npm run test:postman                          start the dashboard on a spare port, test it, stop it
//   npm run test:postman -- --base-url <url>      test an already-running, containerized or deployed copy
//
// The Recorder only answers requests from the same machine. The runner asks the
// server first and skips the Recorder folder when it isn't available (Docker, AWS).
//
// Reports: CLI output, plus JUnit XML and an HTML report in reports/newman/.
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const newman = require('newman');

const ROOT = path.join(__dirname, '..');
const POSTMAN = path.join(ROOT, 'postman');
const REPORTS = path.join(ROOT, 'reports', 'newman');
const PORT = Number(process.env.POSTMAN_PORT || 3299);

const argIndex = process.argv.indexOf('--base-url');
const externalUrl = argIndex > -1 ? process.argv[argIndex + 1] : null;
const baseUrl = (externalUrl || `http://localhost:${PORT}`).replace(/\/$/, '');
const ALL_FOLDERS = ['Health and discovery', 'Run a test', 'Run history', 'Negative and security', 'Recorder (local only)'];

/** True when this server lets us use the Recorder (it returns 403 to anything not on the same machine). */
async function recorderAvailable() {
  try {
    return (await fetch(`${baseUrl}/api/recorder`)).status === 200;
  } catch {
    return false;
  }
}

function run(options) {
  return new Promise((resolve, reject) => {
    newman.run(
      {
        environment: path.join(POSTMAN, 'local.postman_environment.json'),
        envVar: [{ key: 'baseUrl', value: baseUrl }],
        reporters: ['cli', 'junit', 'htmlextra'],
        timeoutRequest: 60_000,
        ...options,
      },
      (err, summary) => (err ? reject(err) : resolve(summary.run.failures.length))
    );
  });
}

async function waitForServer(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Dashboard did not start at ${url}`);
}

(async () => {
  fs.mkdirSync(REPORTS, { recursive: true });
  let server = null;
  if (!externalUrl) {
    server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }

  let failures = 0;
  try {
    await waitForServer(baseUrl);
    const withRecorder = await recorderAvailable();
    console.log(`\nTesting ${baseUrl}${withRecorder ? '' : ' (Recorder not available here: skipping its folder)'}\n`);

    failures += await run({
      collection: path.join(POSTMAN, 'bank-test-bench.postman_collection.json'),
      folder: withRecorder ? undefined : ALL_FOLDERS.filter((f) => !f.startsWith('Recorder')),
      reporter: {
        junit: { export: path.join(REPORTS, 'api.xml') },
        htmlextra: { export: path.join(REPORTS, 'api.html'), title: 'Bank Test Bench API', browserTitle: 'API tests' },
      },
    });

    failures += await run({
      collection: path.join(POSTMAN, 'malicious-input.postman_collection.json'),
      iterationData: path.join(POSTMAN, 'data', 'malicious-names.csv'),
      reporter: {
        junit: { export: path.join(REPORTS, 'malicious-input.xml') },
        htmlextra: { export: path.join(REPORTS, 'malicious-input.html'), title: 'Malicious input (data-driven)', browserTitle: 'Security tests' },
      },
    });
  } catch (err) {
    console.error(err.message);
    failures += 1;
  } finally {
    if (server) server.kill();
  }

  console.log(failures ? `\n✗ ${failures} Postman assertion(s) failed` : '\n✓ All Postman tests passed');
  console.log(`  Reports: ${path.relative(process.cwd(), REPORTS)}/\n`);
  process.exit(failures ? 1 : 0);
})();
