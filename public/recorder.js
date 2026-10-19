// Recorder page: start Codegen, watch steps and code arrive live, review the
// clean-up, then save, run or delete recordings.
const $ = (id) => document.getElementById(id);

const els = {
  blocked: $('rec-blocked'), form: $('rec-form'), name: $('rec-name'), url: $('rec-url'),
  browser: $('rec-browser'), device: $('rec-device'), start: $('rec-start'), formError: $('rec-form-error'),
  session: $('rec-session'), stamp: $('rec-stamp'), title: $('rec-title'), meta: $('rec-meta'), stop: $('rec-stop'),
  hint: $('rec-hint'), steps: $('rec-steps'), stepsEmpty: $('rec-steps-empty'),
  tabRaw: $('tab-raw'), tabClean: $('tab-clean'), edit: $('code-edit'), code: $('rec-code').firstElementChild,
  pre: $('rec-code'), editor: $('rec-editor'), review: $('rec-review'), report: $('rec-report'),
  save: $('rec-save'), discard: $('rec-discard'), saveMsg: $('rec-save-msg'), saved: $('saved-list'),
};

let snap = { state: 'idle' };
let view = 'raw';           // which code tab is showing
let editing = false;
let editedCode = null;      // user's edits to the cleaned code, if any
let lastStepCount = 0;
let clock = null;

// ---------- small helpers ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal JS highlighter: comments, strings, keywords, process.env.*
function highlight(code) {
  const re = /(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|`[^`]*`)|\b(await|async|const|require|test|expect)\b|(process\.env\.\w+)/g;
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += escapeHtml(code.slice(last, m.index));
    const cls = m[1] ? 'tok-com' : m[2] ? 'tok-str' : m[3] ? 'tok-kw' : 'tok-env';
    out += `<span class="${cls}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(code.slice(last));
}

function elapsed(fromIso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(fromIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

// ---------- rendering ----------

const STAMPS = {
  recording: ['REC', 'Recording'],
  finished: ['Cleaned', 'Ready to review'],
  error: ['Stopped', 'Something went wrong'],
};

function render() {
  const s = snap;
  const active = s.state !== 'idle';
  els.session.hidden = !active;
  els.form.querySelectorAll('input, select, button').forEach((el) => (el.disabled = s.state === 'recording'));
  if (!active) {
    lastStepCount = 0;
    clearInterval(clock);
    return;
  }

  const [stampText, stampLabel] = STAMPS[s.state];
  els.stamp.textContent = stampText;
  els.stamp.className = `rec-stamp rec-stamp-${s.state}`;
  els.stamp.setAttribute('aria-label', stampLabel);
  els.title.textContent = s.name;
  els.stop.hidden = s.state !== 'recording';

  const where = `${s.browser}${s.device ? ` · ${s.device}` : ''}`;
  const tick = () => (els.meta.textContent = `${where} · ${elapsed(s.startedAt)}`);
  clearInterval(clock);
  if (s.state === 'recording') {
    tick();
    clock = setInterval(tick, 1000);
  } else {
    els.meta.textContent = where;
  }

  els.hint.textContent =
    s.state === 'recording'
      ? 'A browser window is open. Click through the flow; use the Inspector toolbar to add checks. Close the window or press Stop when you are done.'
      : s.state === 'error'
        ? s.error
        : 'Review the steps and the cleaned code, edit if needed, then save.';
  els.hint.classList.toggle('rec-hint-error', s.state === 'error');

  // Steps (ledger). New lines get a brief highlight so you can see what was just captured.
  els.steps.innerHTML = '';
  s.steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.className = `step step-${step.kind}${i >= lastStepCount && s.state === 'recording' ? ' step-new' : ''}`;
    li.textContent = step.text;
    els.steps.appendChild(li);
  });
  lastStepCount = s.steps.length;
  els.stepsEmpty.hidden = s.steps.length > 0;
  els.stepsEmpty.textContent = s.state === 'recording' ? 'Waiting for your first click…' : 'No steps were recorded.';

  // Code tabs
  const finished = s.state === 'finished';
  els.tabClean.disabled = !finished;
  if (finished && view === 'raw' && !els.tabClean.dataset.seen) {
    view = 'clean'; // jump to the cleaned version once, when the recording finishes
    els.tabClean.dataset.seen = '1';
  }
  if (!finished) {
    view = 'raw';
    delete els.tabClean.dataset.seen;
  }
  renderCode();

  // Review
  els.review.hidden = !finished;
  if (finished) {
    els.report.innerHTML = '';
    const items = s.report.length ? s.report : ['No secrets or redundant steps found'];
    items.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      els.report.appendChild(li);
    });
    s.warnings.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'warn';
      li.textContent = `Check before saving: ${t}`;
      els.report.appendChild(li);
    });
  }
}

function renderCode() {
  const s = snap;
  const clean = view === 'clean';
  els.tabRaw.setAttribute('aria-selected', String(!clean));
  els.tabClean.setAttribute('aria-selected', String(clean));
  $('code-panel').setAttribute('aria-labelledby', clean ? 'tab-clean' : 'tab-raw');
  els.edit.hidden = !clean;
  els.edit.textContent = editing ? 'Done editing' : 'Edit';

  const code = clean ? editedCode ?? s.cleaned ?? '' : s.raw || '';
  els.editor.hidden = !(clean && editing);
  els.pre.hidden = clean && editing;
  if (clean && editing) {
    if (els.editor.value !== code) els.editor.value = code;
  } else {
    els.code.innerHTML = highlight(code || '// Codegen output appears here as you click…');
    if (snap.state === 'recording') els.pre.scrollTop = els.pre.scrollHeight;
  }
}

// ---------- saved recordings ----------

async function loadSaved() {
  let list;
  try {
    list = await api('GET', '/api/recordings');
  } catch (err) {
    els.saved.innerHTML = `<p class="rec-empty">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!list.length) {
    els.saved.innerHTML = '<p class="rec-empty">No recordings yet. Start one above and it will be listed here once you save it.</p>';
    return;
  }
  els.saved.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'saved-list';
  for (const r of list) {
    const li = document.createElement('li');
    li.className = 'saved-item';
    li.dataset.name = r.name;
    li.innerHTML = `
      <div class="saved-head">
        <span class="saved-name">${escapeHtml(r.name)}</span>
        <span class="saved-meta">${r.steps} step${r.steps === 1 ? '' : 's'} · saved ${new Date(r.updatedAt).toLocaleString()}</span>
        <span class="saved-actions">
          <button type="button" class="test-run-btn" data-act="run" aria-label="Run ${escapeHtml(r.name)}">Run</button>
          <button type="button" class="btn-link" data-act="view" aria-expanded="false" aria-label="View code for ${escapeHtml(r.name)}">View code</button>
          <button type="button" class="btn-link btn-danger" data-act="delete" aria-label="Delete ${escapeHtml(r.name)}">Delete</button>
        </span>
      </div>
      <div class="log-lines" aria-live="polite"></div>
      <div class="status" role="status"></div>
      <pre class="saved-code" tabindex="0" aria-label="Code for ${escapeHtml(r.name)}" hidden><code></code></pre>`;
    ul.appendChild(li);
  }
  els.saved.appendChild(ul);
}

async function runSaved(item) {
  const name = item.dataset.name;
  const btn = item.querySelector('[data-act="run"]');
  const log = item.querySelector('.log-lines');
  const status = item.querySelector('.status');
  btn.disabled = true;
  log.innerHTML = '';
  status.className = 'status visible pending';
  status.textContent = 'Running…';

  const res = await fetch(`/api/recordings/${encodeURIComponent(name)}/run`, { method: 'POST' });
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
      const ev = JSON.parse(line);
      if (ev.type === 'log') {
        const div = document.createElement('div');
        div.className = 'log-line';
        div.textContent = `› ${ev.message}`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
      } else if (ev.type === 'result') {
        const skipped = ev.message.startsWith('Skipped');
        status.className = `status visible ${ev.passed ? 'pass' : skipped ? 'pending' : 'fail'}`;
        status.textContent = `${ev.passed ? '✓ PASS' : skipped ? '– SKIP' : '✗ FAIL'} (${(ev.durationMs / 1000).toFixed(1)}s) — ${ev.message}`;
      }
    }
  }
  btn.disabled = false;
}

els.saved.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const item = btn.closest('.saved-item');
  const name = item.dataset.name;

  if (btn.dataset.act === 'run') runSaved(item);

  if (btn.dataset.act === 'view') {
    const pre = item.querySelector('.saved-code');
    const open = pre.hidden;
    if (open && !pre.dataset.loaded) {
      const { code } = await api('GET', `/api/recordings/${encodeURIComponent(name)}`);
      pre.firstElementChild.innerHTML = highlight(code);
      pre.dataset.loaded = '1';
    }
    pre.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Hide code' : 'View code';
  }

  if (btn.dataset.act === 'delete') {
    if (!confirm(`Delete "${name}"? The test file will be removed.`)) return;
    await api('DELETE', `/api/recordings/${encodeURIComponent(name)}`);
    loadSaved();
  }
});

// ---------- actions ----------

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formError.textContent = '';
  const name = els.name.value.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    els.formError.textContent = 'Give the test a name using lowercase letters, numbers and dashes, like login-happy-path.';
    els.name.focus();
    return;
  }
  editedCode = null;
  editing = false;
  els.saveMsg.textContent = '';
  try {
    snap = await api('POST', '/api/recorder/start', {
      name, url: els.url.value.trim(), browser: els.browser.value, device: els.device.value,
    });
    render();
  } catch (err) {
    els.formError.textContent = err.message;
  }
});

els.stop.addEventListener('click', () => api('POST', '/api/recorder/stop').catch((err) => (els.hint.textContent = err.message)));

els.tabRaw.addEventListener('click', () => { view = 'raw'; renderCode(); });
els.tabClean.addEventListener('click', () => { view = 'clean'; renderCode(); });

els.edit.addEventListener('click', () => {
  if (editing) editedCode = els.editor.value;
  editing = !editing;
  renderCode();
  if (editing) els.editor.focus();
});

els.save.addEventListener('click', async () => {
  if (editing) editedCode = els.editor.value;
  els.saveMsg.textContent = '';
  els.saveMsg.className = 'rec-save-msg';
  const name = snap.name;
  try {
    await api('POST', '/api/recorder/save', { code: editedCode ?? undefined });
    editedCode = null;
    editing = false;
    els.form.reset();
    els.url.value = defaults.url;
    els.formError.textContent = '';
    await loadSaved();
    els.formError.textContent = '';
    flash(`Saved ${name} to playwright/recorded/${name}.spec.ts`);
  } catch (err) {
    els.saveMsg.className = 'rec-save-msg rec-save-err';
    els.saveMsg.textContent = err.message;
  }
});

els.discard.addEventListener('click', async () => {
  await api('POST', '/api/recorder/discard');
  editedCode = null;
  editing = false;
});

function flash(message) {
  const p = document.createElement('p');
  p.className = 'flash';
  p.setAttribute('role', 'status');
  p.textContent = message;
  els.saved.prepend(p);
  setTimeout(() => p.remove(), 6000);
}

// ---------- start-up ----------

let defaults = { url: '' };

async function init() {
  let state;
  try {
    state = await api('GET', '/api/recorder');
  } catch (err) {
    els.blocked.hidden = false;
    els.blocked.textContent = `${err.message}. Start the dashboard with npm start and open it at http://localhost:3000.`;
    els.form.hidden = true;
    els.saved.closest('section').hidden = true;
    return;
  }
  defaults = state.defaults;
  els.url.value = defaults.url;
  els.browser.innerHTML = defaults.browsers.map((b) => `<option>${b}</option>`).join('');
  els.device.innerHTML = '<option value="">Desktop</option>' + defaults.devices.map((d) => `<option>${escapeHtml(d)}</option>`).join('');

  const events = new EventSource('/api/recorder/events');
  events.onmessage = (e) => {
    const prev = snap.state;
    snap = JSON.parse(e.data);
    if (snap.state === 'idle' && prev !== 'idle') {
      editedCode = null;
      editing = false;
    }
    render();
  };

  loadSaved();
}

init();
