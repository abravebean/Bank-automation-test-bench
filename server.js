require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TESTS_DIR = path.join(__dirname, 'tests');
const TEST_TIMEOUT_MS = 45000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
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

app.get('/api/tests', (req, res) => {
  const tests = loadTests().map(({ name, description, engine }) => ({
    name,
    description,
    engine: engine || 'selenium',
  }));
  res.json(tests);
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

  try {
    const message = await withTimeout(test.run(log), TEST_TIMEOUT_MS);
    writeEvent(res, {
      type: 'result',
      name: test.name,
      passed: true,
      message: message || 'Passed',
      durationMs: Date.now() - start,
    });
  } catch (err) {
    writeEvent(res, {
      type: 'result',
      name: test.name,
      passed: false,
      message: err.message,
      durationMs: Date.now() - start,
    });
  }
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

app.listen(PORT, () => {
  console.log(`Test dashboard running at http://localhost:${PORT}`);
});