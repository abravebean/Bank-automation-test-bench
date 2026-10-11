const testList = document.getElementById('test-list');
const runAllBtn = document.getElementById('run-all');

let tests = [];

function renderTests() {
  if (!tests.length) {
    testList.innerHTML = '<p class="loading">No tests found in /tests.</p>';
    return;
  }

  testList.innerHTML = tests
    .map(
      (t) => `
    <div class="test-row" data-name="${t.name}">
      <div class="test-name">${t.name} <span class="engine engine-${t.engine}">${t.engine}</span></div>
      <button class="test-run-btn">Run</button>
      <div class="test-desc">${t.description || ''}</div>
      <div class="log-lines"></div>
      <div class="status"></div>
    </div>
  `
    )
    .join('');

  testList.querySelectorAll('.test-row').forEach((row) => {
    const btn = row.querySelector('.test-run-btn');
    btn.addEventListener('click', () => runOne(row.dataset.name));
  });
}

function resetRow(name) {
  const row = testList.querySelector(`.test-row[data-name="${name}"]`);
  row.querySelector('.log-lines').innerHTML = '';
  const status = row.querySelector('.status');
  status.className = 'status';
  status.textContent = '';
  row.querySelector('.test-run-btn').disabled = true;
}

function appendLog(name, message) {
  const row = testList.querySelector(`.test-row[data-name="${name}"]`);
  if (!row) return;
  const logEl = row.querySelector('.log-lines');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = `› ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setResult(result) {
  const row = testList.querySelector(`.test-row[data-name="${result.name}"]`);
  if (!row) return;
  const status = row.querySelector('.status');
  const icon = result.passed ? '✓ PASS' : '✗ FAIL';
  const time = (result.durationMs / 1000).toFixed(1);
  status.className = `status visible ${result.passed ? 'pass' : 'fail'}`;
  status.textContent = `${icon} (${time}s) — ${result.message}`;
  row.querySelector('.test-run-btn').disabled = false;
}

async function streamRun(url) {
  const res = await fetch(url, { method: 'POST' });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      const event = JSON.parse(line);
      if (event.type === 'log') {
        appendLog(event.test, event.message);
      } else if (event.type === 'result') {
        setResult(event);
      }
    }
  }
}

async function runOne(name) {
  resetRow(name);
  await streamRun(`/api/tests/${encodeURIComponent(name)}/run`);
}

async function runAll() {
  runAllBtn.disabled = true;
  tests.forEach((t) => resetRow(t.name));
  try {
    await streamRun('/api/tests/run-all');
  } finally {
    runAllBtn.disabled = false;
  }
}

async function init() {
  const res = await fetch('/api/tests');
  tests = await res.json();
  renderTests();
}

runAllBtn.addEventListener('click', runAll);
init();