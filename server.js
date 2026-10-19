require('dotenv').config();
// Lets the dashboard tests in /tests load the TypeScript Page Object (playwright/pages/LoginPage.ts).
require('tsx/cjs');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('./lib/db');
const { createBankRouter } = require('./lib/demo-bank/router');
const { Recorder, listRecordings, readRecording, deleteRecording, existingFileFor, recordingsDir, BROWSERS, DEVICES } = require('./lib/recorder');

const PORT = process.env.PORT || 3000;

// The built-in Ledgerline demo bank, always on this server (used by the Banking dashboard tests).
process.env.LEDGERLINE_URL = `http://localhost:${PORT}/bank/`;

// No bank configured? Point the dashboard's tests at the built-in Ledgerline demo bank,
// so a fresh clone works with no setup. A BANK_URL in .env always wins.
if (!process.env.BANK_URL) {
  process.env.BANK_URL = `http://localhost:${PORT}/bank/`;
  process.env.BANK_USERNAME = 'demo_user';
  process.env.BANK_PASSWORD = 'demo_pass';
}
const TESTS_DIR = path.join(__dirname, 'tests');
const TEST_TIMEOUT_MS = 45000;

const app = express();

// Ledgerline: the fictional demo bank used as the system under test (http://localhost:3000/bank/).
app.use('/bank', createBankRouter());

app.use(express.static(path.join(__dirname, 'public')));

// Latest compliance evidence report (created by any Playwright run: npm run test:compliance).
const COMPLIANCE_DIR = path.join(__dirname, 'compliance-report');
app.use('/compliance', express.static(COMPLIANCE_DIR));
app.get('/compliance', (req, res) => {
  res.status(404).type('html').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Compliance report · Test Bench</title>
    <link rel="stylesheet" href="/style.css"></head><body><div class="wrap"><header>
    <nav class="site-nav" aria-label="Main"><a href="/">Tests</a><a href="/recorder.html">Recorder</a>
    <a href="/compliance/" aria-current="page">Compliance report</a></nav><h1>Compliance report</h1></header>
    <main><p>No report yet. Run <code>npm run test:compliance</code>, then reload this page.</p></main></div></body></html>`);
});
app.use(express.json());

function loadTests() {
  return fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => {
      delete require.cache[require.resolve(path.join(TESTS_DIR, f))];
      const mod = require(path.join(TESTS_DIR, f));
      return { file: f, ...mod };
    });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Test timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', database: await db.ping() });
});

app.get('/api/tests', (req, res) => {
  const tests = loadTests().map(({ name, description, engine, area }) => ({
    name,
    description,
    engine: engine || 'selenium',
    area: area || 'Other',
  }));
  res.json(tests);
});

// Run history (needs DATABASE_URL). 503 tells the client the feature is off, not broken.
function requireDb(req, res, next) {
  if (!db.isEnabled()) {
    return res.status(503).json({ error: 'Run history is disabled: DATABASE_URL is not set' });
  }
  next();
}

app.get('/api/runs', requireDb, async (req, res) => {
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'limit must be an integer from 1 to 100' });
  }
  const testName = typeof req.query.test === 'string' ? req.query.test : undefined;
  try {
    res.json(await db.listRuns({ limit, testName }));
  } catch (err) {
    res.status(500).json({ error: 'Could not read run history' });
  }
});

app.get('/api/stats', requireDb, async (req, res) => {
  try {
    res.json(await db.getStats());
  } catch (err) {
    res.status(500).json({ error: 'Could not compute stats' });
  }
});

// ---------------------------------------------------------------------------
// Recorder: Playwright Codegen driven from the dashboard.
// These routes start processes and write files, so they only answer requests
// from this machine. On a public deployment they return 403.
// ---------------------------------------------------------------------------
const recorder = new Recorder();

function localOnly(req, res, next) {
  const ip = req.socket.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (process.env.RECORDER_ENABLED === 'false' || !isLocal) {
    return res.status(403).json({ error: 'The recorder only runs on your own machine (localhost)' });
  }
  next();
}

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message });
}

app.get('/api/recorder', localOnly, (req, res) => {
  res.json({
    ...recorder.snapshot(),
    defaults: { url: process.env.BANK_URL || '', browsers: BROWSERS, devices: DEVICES.filter(Boolean) },
  });
});

// Server-Sent Events: the page gets every change to the recording as it happens.
app.get('/api/recorder/events', localOnly, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (snap) => res.write(`data: ${JSON.stringify(snap)}\n\n`);
  send(recorder.snapshot());
  recorder.on('update', send);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    recorder.off('update', send);
  });
});

app.post('/api/recorder/start', localOnly, (req, res) => {
  const { name, url, browser, device } = req.body || {};
  try {
    res.status(201).json(recorder.start({ name, url: url || process.env.BANK_URL, browser, device: device || '' }));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/recorder/stop', localOnly, (req, res) => {
  try {
    recorder.stop();
    res.status(202).json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/recorder/save', localOnly, (req, res) => {
  try {
    res.status(201).json(recorder.save(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/recorder/discard', localOnly, (req, res) => {
  recorder.discard();
  res.json({ ok: true });
});

app.get('/api/recordings', localOnly, (req, res) => res.json(listRecordings()));

app.get('/api/recordings/:name', localOnly, (req, res) => {
  try {
    res.json(readRecording(req.params.name));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/recordings/:name', localOnly, (req, res) => {
  try {
    deleteRecording(req.params.name);
    res.status(204).end();
  } catch (err) {
    sendError(res, err);
  }
});

// Run a saved recording with Playwright Test and stream its output, same format as the dashboard tests.
app.post('/api/recordings/:name/run', localOnly, (req, res) => {
  let file;
  try {
    file = readRecording(req.params.name) && existingFileFor(req.params.name);
  } catch (err) {
    return sendError(res, err);
  }
  const name = req.params.name;
  startStream(res);
  const start = Date.now();
  const child = spawn(
    'npx',
    ['playwright', 'test', '-c', path.join(__dirname, 'playwright', 'recorded.config.ts'), path.basename(file), '--reporter=list'],
    { env: { ...process.env, RECORDINGS_DIR: recordingsDir(), FORCE_COLOR: '0' }, shell: process.platform === 'win32' }
  );
  let output = '';
  const onData = (chunk) => {
    output += chunk;
    chunk
      .toString()
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim())
      .forEach((message) => writeEvent(res, { type: 'log', test: name, message }));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    const skipped = /\d+ skipped/.test(output) && !/\d+ passed/.test(output);
    writeEvent(res, {
      type: 'result',
      name,
      passed: code === 0 && !skipped,
      message: code !== 0 ? 'Failed: see the log above' : skipped ? 'Skipped: BANK_URL is not set' : 'Passed',
      durationMs: Date.now() - start,
    });
    res.end();
  });
});

function startStream(res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}

function writeEvent(res, event) {
  res.write(JSON.stringify(event) + '\n');
}

async function runTestStreaming(test, res) {
  const start = Date.now();
  const log = (message) => writeEvent(res, { type: 'log', test: test.name, message });

  let result;
  try {
    const message = await withTimeout(test.run(log), TEST_TIMEOUT_MS);
    result = { name: test.name, passed: true, message: message || 'Passed' };
  } catch (err) {
    result = { name: test.name, passed: false, message: err.message };
  }
  result.durationMs = Date.now() - start;

  // Save to Postgres; a database problem is logged but never fails the test.
  let runId = null;
  try {
    runId = await db.recordRun({ ...result, engine: test.engine || 'selenium' });
  } catch (err) {
    console.error('Could not record run:', err.message);
  }

  writeEvent(res, { type: 'result', ...result, ...(runId ? { runId } : {}) });
}

app.post('/api/tests/:name/run', async (req, res) => {
  const tests = loadTests();
  const test = tests.find((t) => t.name === req.params.name);
  if (!test) {
    return res.status(404).json({ name: req.params.name, passed: false, message: 'Test not found' });
  }

  startStream(res);
  await runTestStreaming(test, res);
  res.end();
});

app.post('/api/tests/run-all', async (req, res) => {
  const tests = loadTests();
  startStream(res);

  for (const test of tests) {
    await runTestStreaming(test, res);
  }

  res.end();
});

// Anything else under /api is a JSON 404, never Express's default HTML page.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.path}` });
});

db.init()
  .then((enabled) => console.log(enabled ? 'Run history: PostgreSQL connected' : 'Run history: disabled (no DATABASE_URL)'))
  .catch((err) => console.error('Database init failed, continuing without run history:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Test dashboard running at http://localhost:${PORT}`);
    });
  });
