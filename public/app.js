// Test Bench dashboard: lists the tests, runs them with live step logs, and
// summarizes results (plus pass-rate history when PostgreSQL run history is on).
const testList = document.getElementById('test-list');
const runAllBtn = document.getElementById('run-all');
const $ = (id) => document.getElementById(id);

const HISTORY_LENGTH = 10;
const AREA_ORDER = ['Login', 'Banking'];

let tests = [];
let filter = 'all';
let historyOn = false;
let runsByTest = new Map(); // name -> runs, newest first (from PostgreSQL)
let statsByTest = new Map(); // name -> stats (from PostgreSQL)
const sessionResults = new Map(); // name -> latest result in this browser session

// ---------------------------------------------------------------- helpers

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const percent = (n) => `${Math.round(n * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function rowFor(name) {
  return testList.querySelector(`.test-row[data-name="${CSS.escape(name)}"]`);
}

/** Most recent known result for a test: this session's run, else run history. */
function latestResult(name) {
  return sessionResults.get(name) ?? runsByTest.get(name)?.[0] ?? null;
}

// ---------------------------------------------------------------- rendering

function renderTests() {
  if (!tests.length) {
    testList.innerHTML = '<p class="loading">No tests found in /tests.</p>';
    return;
  }
  testList.innerHTML = '';
  const areas = [...new Set(tests.map((t) => t.area))].sort(
    (a, b) => (AREA_ORDER.indexOf(a) + 1 || 99) - (AREA_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b)
  );

  for (const area of areas) {
    const group = el('section', { class: 'area', 'aria-labelledby': `area-${area}` });
    const inArea = tests.filter((t) => t.area === area);
    const head = el('div', { class: 'area-head' });
    head.append(el('h2', { id: `area-${area}` }, area), el('span', { class: 'area-count' }, plural(inArea.length, 'test')));
    group.appendChild(head);

    for (const t of inArea) {
      const row = el('article', { class: 'test-row', dataset: { name: t.name, engine: t.engine } });
      const title = el('div', { class: 'test-name' }, t.name);
      title.appendChild(el('span', { class: `engine engine-${t.engine}` }, t.engine));
      const btn = el('button', { class: 'test-run-btn', type: 'button', 'aria-label': `Run ${t.name}` }, 'Run');
      btn.addEventListener('click', () => runOne(t.name));
      row.append(
        title,
        btn,
        el('div', { class: 'test-desc' }, t.description || ''),
        el('div', { class: 'test-meta' }),
        el('div', { class: 'log-lines', 'aria-live': 'polite' }),
        el('div', { class: 'status', role: 'status' })
      );
      group.appendChild(row);
    }
    testList.appendChild(group);
  }
  applyFilter();
  renderMeta();
}

/** Per-test line: last 10 runs as ✓/✗ marks, pass rate and average duration. */
function renderMeta() {
  for (const t of tests) {
    const row = rowFor(t.name);
    if (!row) continue;
    const meta = row.querySelector('.test-meta');
    meta.innerHTML = '';
    const runs = (runsByTest.get(t.name) ?? []).slice(0, HISTORY_LENGTH).reverse(); // oldest -> newest
    const stats = statsByTest.get(t.name);

    if (!historyOn) {
      const last = sessionResults.get(t.name);
      meta.textContent = last ? `Last run ${last.passed ? 'passed' : 'failed'} in ${seconds(last.durationMs)}` : 'Not run yet';
      continue;
    }
    if (!runs.length) {
      meta.textContent = 'Not run yet';
      continue;
    }
    const passed = runs.filter((r) => r.passed).length;
    const strip = el('span', {
      class: 'runs-strip',
      role: 'img',
      'aria-label': `Last ${plural(runs.length, 'run')}, oldest first: ${passed} passed, ${runs.length - passed} failed`,
    });
    for (const r of runs) {
      strip.appendChild(
        el('span', {
          class: `mark ${r.passed ? 'mark-pass' : 'mark-fail'}`,
          title: `${r.passed ? 'Passed' : 'Failed'} · ${new Date(r.startedAt).toLocaleString()} · ${seconds(r.durationMs)}`,
        }, r.passed ? '✓' : '✗')
      );
    }
    meta.appendChild(strip);
    if (stats) {
      meta.appendChild(el('span', {}, `${percent(stats.passRate)} of ${plural(stats.totalRuns, 'run')} passed`));
      meta.appendChild(el('span', {}, `avg ${seconds(stats.avgDurationMs)}`));
      if (stats.flaky) meta.appendChild(el('span', { class: 'flaky-tag' }, '⚠ flaky'));
    }
  }
}

function renderKpis() {
  const engines = new Set(tests.map((t) => t.engine));
  $('kpi-tests').textContent = tests.length;
  $('kpi-tests-note').textContent = `${plural(new Set(tests.map((t) => t.area)).size, 'area')}, ${engines.size === 2 ? 'Selenium and Playwright' : [...engines].join(', ')}`;

  const known = tests.map((t) => latestResult(t.name)).filter(Boolean);
  const passing = known.filter((r) => r.passed).length;
  const latest = $('kpi-latest');
  if (!known.length) {
    latest.textContent = '–';
    latest.className = 'kpi-value';
    $('kpi-latest-note').textContent = 'Run the suite to see results';
  } else {
    const allOk = passing === known.length;
    latest.textContent = `${allOk ? '✓' : '✗'} ${passing}/${known.length}`;
    latest.className = `kpi-value ${allOk ? 'is-pass' : 'is-fail'}`;
    $('kpi-latest-note').textContent = allOk ? 'passing on their latest run' : `${known.length - passing} failing on their latest run`;
  }

  if (!historyOn) {
    $('kpi-rate').textContent = '–';
    $('kpi-rate-note').textContent = 'Turn on run history (DATABASE_URL) to track this';
    $('kpi-flaky').textContent = '–';
    $('kpi-flaky-note').textContent = 'Needs run history';
    return;
  }
  const all = [...statsByTest.values()];
  const total = all.reduce((n, s) => n + s.totalRuns, 0);
  const passed = all.reduce((n, s) => n + s.passedRuns, 0);
  $('kpi-rate').textContent = total ? percent(passed / total) : '–';
  $('kpi-rate-note').textContent = total ? `${passed} of ${plural(total, 'run')}` : 'No runs recorded yet';
  const flaky = all.filter((s) => s.flaky);
  const flakyEl = $('kpi-flaky');
  flakyEl.textContent = flaky.length;
  flakyEl.className = `kpi-value ${flaky.length ? 'is-warn' : ''}`;
  $('kpi-flaky-note').textContent = flaky.length ? flaky.map((s) => s.name).join(', ') : 'No test has both passed and failed';
}

function applyFilter() {
  for (const row of testList.querySelectorAll('.test-row')) {
    row.hidden = filter !== 'all' && row.dataset.engine !== filter;
  }
  for (const group of testList.querySelectorAll('.area')) {
    group.hidden = ![...group.querySelectorAll('.test-row')].some((r) => !r.hidden);
  }
}

document.querySelectorAll('.filter button').forEach((btn) => {
  btn.addEventListener('click', () => {
    filter = btn.dataset.engine;
    document.querySelectorAll('.filter button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    applyFilter();
  });
});

// ---------------------------------------------------------------- running

/** Clears a row before a run. Tests in a "Run all" start as Queued: the server runs them one at a time. */
function resetRow(name, state = 'Running…') {
  const row = rowFor(name);
  if (!row) return;
  row.querySelector('.log-lines').innerHTML = '';
  const status = row.querySelector('.status');
  status.className = 'status visible pending';
  status.textContent = state;
  row.querySelector('.test-run-btn').disabled = true;
  row.classList.toggle('is-running', state === 'Running…');
}

function appendLog(name, message) {
  const row = rowFor(name);
  if (!row) return;
  if (!row.classList.contains('is-running')) {
    // First step from a queued test: it has started.
    row.classList.add('is-running');
    row.querySelector('.status').textContent = 'Running…';
  }
  const logEl = row.querySelector('.log-lines');
  logEl.appendChild(el('div', { class: 'log-line' }, `› ${message}`));
  logEl.scrollTop = logEl.scrollHeight;
}

function setResult(result) {
  sessionResults.set(result.name, result);
  const row = rowFor(result.name);
  if (!row) return;
  const status = row.querySelector('.status');
  status.className = `status visible ${result.passed ? 'pass' : 'fail'}`;
  status.textContent = `${result.passed ? '✓ PASS' : '✗ FAIL'} (${(result.durationMs / 1000).toFixed(1)}s) — ${result.message}`;
  row.querySelector('.test-run-btn').disabled = false;
  row.classList.remove('is-running');
  renderKpis();
}

async function streamRun(url, onResult) {
  const res = await fetch(url, { method: 'POST' });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === 'log') appendLog(event.test, event.message);
      else if (event.type === 'result') {
        setResult(event);
        onResult?.(event);
      }
    }
  }
}

async function runOne(name) {
  resetRow(name);
  await streamRun(`/api/tests/${encodeURIComponent(name)}/run`);
  await refreshHistory();
}

function setProgress(done, total, passed, failed) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('progress-fill').style.width = `${pct}%`;
  const bar = $('progress-bar');
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(done));
  $('progress-text').textContent =
    done < total
      ? `Running ${done + 1} of ${total}… ${passed} passed${failed ? `, ${failed} failed` : ''}`
      : `Finished: ${passed} passed${failed ? `, ${failed} failed` : ''} out of ${total}`;
  $('progress').classList.toggle('has-failures', failed > 0);
}

async function runAll() {
  runAllBtn.disabled = true;
  tests.forEach((t) => resetRow(t.name, 'Queued'));
  let done = 0;
  let passed = 0;
  let failed = 0;
  $('progress').hidden = false;
  setProgress(0, tests.length, 0, 0);
  try {
    await streamRun('/api/tests/run-all', (r) => {
      done += 1;
      r.passed ? passed++ : failed++;
      setProgress(done, tests.length, passed, failed);
    });
  } finally {
    runAllBtn.disabled = false;
    await refreshHistory();
  }
}

runAllBtn.addEventListener('click', runAll);

// ---------------------------------------------------------------- run history (PostgreSQL)

async function refreshHistory() {
  try {
    const [runsRes, statsRes] = await Promise.all([fetch('/api/runs?limit=100'), fetch('/api/stats')]);
    historyOn = runsRes.ok && statsRes.ok;
    if (historyOn) {
      const runs = await runsRes.json();
      runsByTest = new Map();
      for (const r of runs) {
        if (!runsByTest.has(r.name)) runsByTest.set(r.name, []);
        runsByTest.get(r.name).push(r);
      }
      statsByTest = new Map((await statsRes.json()).map((s) => [s.name, s]));
      renderRecentRuns(runs.slice(0, 10));
    }
  } catch {
    historyOn = false;
  }
  renderMeta();
  renderKpis();
}

function renderRecentRuns(runs) {
  const section = $('history');
  section.hidden = false;
  const body = section.querySelector('tbody');
  body.innerHTML = '';
  if (!runs.length) {
    body.innerHTML = '<tr><td colspan="4">No runs yet.</td></tr>';
    return;
  }
  for (const r of runs) {
    const tr = document.createElement('tr');
    tr.append(
      el('td', {}, new Date(r.startedAt).toLocaleTimeString()),
      el('td', {}, r.name),
      el('td', { class: r.passed ? 'pass' : 'fail' }, r.passed ? '✓ Pass' : '✗ Fail'),
      el('td', { class: 'num' }, seconds(r.durationMs))
    );
    body.appendChild(tr);
  }
}

// ---------------------------------------------------------------- start-up

async function init() {
  const res = await fetch('/api/tests');
  tests = await res.json();
  renderTests();
  renderKpis();
  await refreshHistory();
}

init();
