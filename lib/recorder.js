// Drives Playwright Codegen for the dashboard's Recorder page.
// One recording at a time. Codegen writes its code to a file as you click; we watch
// that file and broadcast each change (raw code + plain-English steps) to the UI.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeRecording, findLeftoverSecrets } = require('./recording');
const { parseSteps } = require('./steps');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const BROWSERS = ['chromium', 'firefox', 'webkit'];
const DEVICES = ['', 'iPhone 13', 'Pixel 7', 'iPad Mini'];

function recordingsDir() {
  return process.env.RECORDINGS_DIR || path.join(__dirname, '..', 'playwright', 'recorded');
}

function fileFor(name) {
  if (!NAME_RE.test(name)) throw Object.assign(new Error('Invalid name'), { status: 400 });
  return path.join(recordingsDir(), `${name}.spec.js`);
}

class Recorder extends EventEmitter {
  constructor() {
    super();
    this.session = null; // { name, url, browser, device, state, raw, cleaned, report, warnings, startedAt }
    this.child = null;
  }

  snapshot() {
    if (!this.session) return { state: 'idle' };
    const s = this.session;
    const code = s.state === 'finished' ? s.cleaned : s.raw;
    return {
      state: s.state,
      name: s.name,
      url: s.url,
      browser: s.browser,
      device: s.device || null,
      startedAt: s.startedAt,
      raw: s.raw,
      cleaned: s.cleaned || null,
      report: s.report || [],
      warnings: s.warnings || [],
      error: s.error || null,
      steps: parseSteps(code || ''),
    };
  }

  broadcast() {
    this.emit('update', this.snapshot());
  }

  start({ name, url, browser = 'chromium', device = '' }) {
    if (this.session && this.session.state === 'recording') {
      throw Object.assign(new Error('A recording is already in progress'), { status: 409 });
    }
    if (!name || !NAME_RE.test(name)) {
      throw Object.assign(new Error('Name must be kebab-case: lowercase letters, numbers and dashes'), { status: 400 });
    }
    if (!BROWSERS.includes(browser)) throw Object.assign(new Error('Unknown browser'), { status: 400 });
    if (!DEVICES.includes(device)) throw Object.assign(new Error('Unknown device'), { status: 400 });
    if (!url || !/^https?:\/\//.test(url)) {
      throw Object.assign(new Error('Set BANK_URL in .env, or enter a URL starting with http:// or https://'), { status: 400 });
    }

    const rawFile = path.join(os.tmpdir(), `testbench-recording-${process.pid}-${Date.now()}.js`);
    const args = [
      '--target=playwright-test',
      '--test-id-attribute=data-testid',
      `--browser=${browser}`,
      '-o', rawFile,
    ];
    if (device) args.push(`--device=${device}`);
    args.push(url);

    // RECORDER_FAKE_CODEGEN lets automated tests swap in a scripted stand-in for the real,
    // interactive Codegen window (which needs a person clicking).
    const fake = process.env.RECORDER_FAKE_CODEGEN;
    const [cmd, cmdArgs] = fake
      ? [process.execPath, [fake, ...args]]
      : ['npx', ['playwright', 'codegen', ...args]];

    this.session = { name, url, browser, device, state: 'recording', raw: '', rawFile, startedAt: new Date().toISOString() };
    this.child = spawn(cmd, cmdArgs, { stdio: 'ignore', shell: process.platform === 'win32' });

    const readRaw = () => {
      try {
        const raw = fs.readFileSync(rawFile, 'utf8');
        if (this.session && raw !== this.session.raw) {
          this.session.raw = raw;
          this.broadcast();
        }
      } catch {
        /* Codegen hasn't written the file yet */
      }
    };
    this.poll = setInterval(readRaw, 300);

    this.child.on('error', (err) => this.finish(`Could not start Codegen: ${err.message}`));
    this.child.on('exit', () => {
      readRaw();
      this.finish();
    });

    this.broadcast();
    return this.snapshot();
  }

  finish(error) {
    clearInterval(this.poll);
    const s = this.session;
    if (!s || s.state !== 'recording') return;
    this.child = null;
    try { fs.unlinkSync(s.rawFile); } catch { /* already gone */ }

    if (error || !s.raw.trim()) {
      s.state = 'error';
      s.error = error || 'Nothing was recorded. Click through the app before closing the browser.';
    } else {
      // If BANK_URL isn't configured, the page you started on becomes the BANK_URL placeholder.
      const env = { ...process.env, BANK_URL: process.env.BANK_URL || s.url };
      const { code, report } = sanitizeRecording(s.raw, { name: s.name, env });
      s.cleaned = code;
      s.report = report;
      s.warnings = findLeftoverSecrets(code, process.env).map((k) => `${k} still appears in the code`);
      s.state = 'finished';
    }
    this.broadcast();
  }

  stop() {
    if (!this.session || this.session.state !== 'recording') {
      throw Object.assign(new Error('Nothing is recording'), { status: 409 });
    }
    if (this.child) this.child.kill('SIGTERM');
    else this.finish();
  }

  save({ code, overwrite = false } = {}) {
    const s = this.session;
    if (!s || s.state !== 'finished') throw Object.assign(new Error('No finished recording to save'), { status: 409 });
    const file = fileFor(s.name);
    if (fs.existsSync(file) && !overwrite) {
      throw Object.assign(new Error(`A test named "${s.name}" already exists`), { status: 409 });
    }
    const body = typeof code === 'string' && code.trim() ? code : s.cleaned;
    fs.mkdirSync(recordingsDir(), { recursive: true });
    fs.writeFileSync(file, body.endsWith('\n') ? body : body + '\n');
    const saved = s.name;
    this.session = null;
    this.broadcast();
    return { name: saved };
  }

  discard() {
    if (this.session && this.session.state === 'recording') this.stop();
    this.session = null;
    this.broadcast();
  }
}

function listRecordings() {
  const dir = recordingsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.spec.js') && NAME_RE.test(f.slice(0, -'.spec.js'.length)))
    .map((f) => {
      const full = path.join(dir, f);
      const code = fs.readFileSync(full, 'utf8');
      return {
        name: f.slice(0, -'.spec.js'.length),
        steps: parseSteps(code).length,
        updatedAt: fs.statSync(full).mtime.toISOString(),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readRecording(name) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) throw Object.assign(new Error('Recording not found'), { status: 404 });
  const code = fs.readFileSync(file, 'utf8');
  return { name, code, steps: parseSteps(code) };
}

function deleteRecording(name) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) throw Object.assign(new Error('Recording not found'), { status: 404 });
  fs.unlinkSync(file);
}

module.exports = { Recorder, listRecordings, readRecording, deleteRecording, fileFor, recordingsDir, BROWSERS, DEVICES };
