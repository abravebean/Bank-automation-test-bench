// Compliance evidence reporter.
//
// Turns a Playwright run into an audit-ready evidence package:
//   compliance-report/index.html     human-readable report (prints cleanly to PDF)
//   compliance-report/evidence.json  the same data, machine-readable
//   compliance-report/summary.md     short summary (posted to the GitHub Actions run page)
//   compliance-report/evidence/      screenshots, named by their SHA-256 hash
//
// Requirements come from compliance/requirements.json. Tests link to them with tags
// ({ tag: '@R1' }). The report shows, per requirement: the control it maps to, every
// test that proves it, each step, the outcome per browser, and screenshot evidence.
// It also lists the gaps an auditor asks about first: requirements with no tests,
// tests that were skipped or failed, tests that only passed on retry, and tests
// that aren't linked to any requirement.
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

// ---------------------------------------------------------------- types

interface Requirement {
  id: string;
  title: string;
  category: string;
  control: string;
  risk: 'P1' | 'P2' | 'P3';
}

interface Catalog {
  system: string;
  requirements: Requirement[];
}

interface Options {
  outputDir?: string;
  requirementsFile?: string;
}

type Outcome = 'passed' | 'failed' | 'flaky' | 'skipped';
type RequirementStatus = 'passed' | 'failed' | 'not-run' | 'no-tests';

interface Evidence {
  label: string;
  file: string; // relative to the report folder
  sha256: string;
}

interface TestRecord {
  id: string;
  title: string;
  file: string;
  line: number;
  project: string;
  requirements: string[];
  outcome: Outcome;
  attempts: number;
  durationMs: number;
  startedAt: string | null;
  steps: string[];
  error: string | null;
  skipReason: string | null;
  evidence: Evidence[];
}

interface RequirementRecord extends Requirement {
  status: RequirementStatus;
  tests: TestRecord[];
}

// ---------------------------------------------------------------- helpers

// Browser actions worth showing to a reviewer. Internal calls (evaluate, new page,
// screenshot, locator counts) are left out: they describe how the test works, not what it proved.
const ACTION = /^(Navigate|Click|Double click|Fill|Press|Type|Check|Uncheck|Select option|Hover|Set input files|Go back|Reload|Wait for|GET|POST|PUT|PATCH|DELETE)\b/i;
const MAX_STEPS = 25;

/**
 * Secret values this process can see (bank credentials, database password). Step titles
 * include what was typed (Fill "..."), so every secret is blanked out before it reaches
 * the report, which may be published.
 */
function secretValues(): string[] {
  const env = process.env;
  const values = [env.BANK_USERNAME, env.BANK_PASSWORD, env.PGPASSWORD];
  try {
    if (env.DATABASE_URL) values.push(decodeURIComponent(new URL(env.DATABASE_URL).password));
  } catch {
    /* not a URL */
  }
  // Longest first, so a password that contains the username is still fully hidden.
  return values.filter((v): v is string => !!v && v.length >= 4).sort((a, b) => b.length - a.length);
}

const SECRETS = secretValues();
const HIDDEN = '•••••• (hidden)';

export function redact(text: string, secrets: string[] = SECRETS): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(HIDDEN);
  return out;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

function isReadable(step: TestStep): boolean {
  if (step.category === 'test.step') return true;
  if (step.category === 'pw:api') return ACTION.test(step.title);
  // Assertions: keep the standard "Expect ..." titles. A custom expect message becomes the
  // step title and is written as the failure text, so it would read like a failure here.
  if (step.category === 'expect') return step.title.startsWith('Expect ');
  return false;
}

/**
 * The steps a reviewer can read. Tests written with test.step() show those named steps
 * (with the actions inside them); other tests show their actions and assertions.
 * Repeats are collapsed: Press "Tab" ×9.
 */
function readableSteps(steps: TestStep[]): string[] {
  const named = steps.some((s) => s.category === 'test.step');
  const flat: { text: string; depth: number }[] = [];
  for (const step of steps) {
    if (named && step.category !== 'test.step') continue;
    if (!isReadable(step)) continue;
    flat.push({ text: `${step.title}${step.error ? '  ✗' : ''}`, depth: 0 });
    if (step.category === 'test.step') {
      for (const inner of step.steps) if (isReadable(inner)) flat.push({ text: `${inner.title}${inner.error ? '  ✗' : ''}`, depth: 1 });
    }
  }
  const out: string[] = [];
  for (let i = 0; i < flat.length && out.length < MAX_STEPS; ) {
    let n = 1;
    while (i + n < flat.length && flat[i + n]!.text === flat[i]!.text && flat[i + n]!.depth === flat[i]!.depth) n++;
    out.push(`${'  '.repeat(flat[i]!.depth)}${flat[i]!.text}${n > 1 ? ` ×${n}` : ''}`);
    i += n;
  }
  return out;
}

const STATUS_TEXT: Record<RequirementStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  'not-run': 'Not run',
  'no-tests': 'No tests',
};

const OUTCOME_TEXT: Record<Outcome, string> = {
  passed: 'Passed',
  failed: 'Failed',
  flaky: 'Passed on retry',
  skipped: 'Skipped',
};

// ---------------------------------------------------------------- reporter

export default class ComplianceReporter implements Reporter {
  private readonly outputDir: string;
  private readonly requirementsFile: string;
  private config!: FullConfig;
  private suite!: Suite;
  private startedAt = new Date();
  private readonly results = new Map<string, TestResult[]>();

  constructor(options: Options = {}) {
    this.outputDir = path.resolve(options.outputDir ?? 'compliance-report');
    this.requirementsFile = path.resolve(options.requirementsFile ?? 'compliance/requirements.json');
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config;
    this.suite = suite;
    this.startedAt = new Date();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const list = this.results.get(test.id) ?? [];
    list.push(result);
    this.results.set(test.id, list);
  }

  async onEnd(result: FullResult): Promise<void> {
    const catalog: Catalog = JSON.parse(fs.readFileSync(this.requirementsFile, 'utf8'));
    const known = new Set(catalog.requirements.map((r) => r.id));

    fs.rmSync(this.outputDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(this.outputDir, 'evidence'), { recursive: true });

    const tests = this.suite.allTests().map((t) => this.toRecord(t));
    const unknownTags = [...new Set(tests.flatMap((t) => t.requirements).filter((id) => !known.has(id)))];

    const requirements: RequirementRecord[] = catalog.requirements.map((req) => {
      const linked = tests.filter((t) => t.requirements.includes(req.id));
      return { ...req, tests: linked, status: statusOf(linked) };
    });
    const untraced = tests.filter((t) => t.requirements.length === 0);

    const meta = this.runMetadata(result);
    const model = {
      reportVersion: 1,
      system: catalog.system,
      generatedAt: new Date().toISOString(),
      run: meta,
      totals: {
        requirements: countBy(requirements.map((r) => r.status)),
        tests: countBy(tests.map((t) => t.outcome)),
      },
      requirements,
      untraced,
      unknownTags,
    };

    const json = JSON.stringify(model, null, 2);
    const jsonHash = sha256(json);
    fs.writeFileSync(path.join(this.outputDir, 'evidence.json'), json);
    fs.writeFileSync(path.join(this.outputDir, 'evidence.json.sha256'), `${jsonHash}  evidence.json\n`);
    fs.writeFileSync(path.join(this.outputDir, 'index.html'), renderHtml(model, jsonHash));
    fs.writeFileSync(path.join(this.outputDir, 'summary.md'), renderMarkdown(model));

    const t = model.totals.requirements;
    console.log(
      `\nCompliance report: ${t.passed ?? 0} passed, ${t.failed ?? 0} failed, ${t['not-run'] ?? 0} not run, ` +
        `${t['no-tests'] ?? 0} without tests → ${path.relative(process.cwd(), path.join(this.outputDir, 'index.html'))}`
    );
  }

  // -------------------------------------------------------------- per test

  private toRecord(test: TestCase): TestRecord {
    const results = this.results.get(test.id) ?? [];
    const last = results[results.length - 1];
    const outcomeMap: Record<ReturnType<TestCase['outcome']>, Outcome> = {
      expected: 'passed',
      unexpected: 'failed',
      flaky: 'flaky',
      skipped: 'skipped',
    };
    const outcome = results.length ? outcomeMap[test.outcome()] : 'skipped';

    const skip = [...test.annotations, ...(last?.annotations ?? [])].find((a) => a.type === 'skip');
    const skipReason = outcome === 'skipped' ? redact(skip?.description ?? (results.length ? 'Skipped' : 'Not executed in this run')) : null;

    const error = last?.errors.length ? redact(stripAnsi(last.errors.map((e) => e.message ?? '').join('\n')).split('\n').slice(0, 6).join('\n')) : null;

    return {
      id: test.id,
      title: redact(test.titlePath().slice(3).join(' › ')),
      file: path.relative(this.config.rootDir, test.location.file),
      line: test.location.line,
      project: test.parent.project()?.name ?? '',
      requirements: test.tags.filter((tag) => /^@R\d+$/.test(tag)).map((tag) => tag.slice(1)),
      outcome,
      attempts: results.length,
      durationMs: results.reduce((sum, r) => sum + r.duration, 0),
      startedAt: results[0]?.startTime.toISOString() ?? null,
      steps: last ? readableSteps(last.steps).map((step) => redact(step)) : [],
      error,
      skipReason,
      evidence: last ? this.collectEvidence(last) : [],
    };
  }

  /** Copies screenshots into the report, named by content hash so any change is detectable. */
  private collectEvidence(result: TestResult): Evidence[] {
    const out: Evidence[] = [];
    for (const a of result.attachments) {
      const isEvidence = a.name.startsWith('evidence:');
      const isFailureShot = a.name === 'screenshot' && result.status !== 'passed';
      if (!(isEvidence || isFailureShot) || a.contentType !== 'image/png') continue;

      let data: Buffer | null = null;
      if (a.body) data = a.body;
      else if (a.path && fs.existsSync(a.path)) data = fs.readFileSync(a.path);
      if (!data) continue;

      const hash = sha256(data);
      const file = `evidence/${hash}.png`;
      fs.writeFileSync(path.join(this.outputDir, file), data);
      out.push({ label: isEvidence ? a.name.slice('evidence:'.length).trim() : 'Screenshot at failure', file, sha256: hash });
    }
    return out;
  }

  // -------------------------------------------------------------- run metadata

  runMetadata(result: FullResult) {
    const env = process.env;
    let target: string | null = null;
    try {
      target = env.BANK_URL ? new URL(env.BANK_URL).host : null; // host only, never credentials
    } catch {
      target = null;
    }
    const ciRun =
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null;
    return {
      status: result.status,
      startedAt: result.startTime?.toISOString?.() ?? this.startedAt.toISOString(),
      durationMs: Math.round(result.duration ?? Date.now() - this.startedAt.getTime()),
      commit: env.GITHUB_SHA ?? git('rev-parse HEAD'),
      branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD'),
      ciRun,
      projects: [...new Set(this.config.projects.map((p) => p.name))],
      target,
      playwright: this.config.version,
      node: process.version,
    };
  }
}

// ---------------------------------------------------------------- status logic

function statusOf(tests: TestRecord[]): RequirementStatus {
  if (!tests.length) return 'no-tests';
  if (tests.some((t) => t.outcome === 'failed')) return 'failed';
  if (tests.some((t) => t.outcome === 'passed' || t.outcome === 'flaky')) return 'passed';
  return 'not-run';
}

function countBy<T extends string>(values: T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

type Model = {
  system: string;
  generatedAt: string;
  run: ReturnType<ComplianceReporter['runMetadata']>;
  totals: { requirements: Partial<Record<RequirementStatus, number>>; tests: Partial<Record<Outcome, number>> };
  requirements: RequirementRecord[];
  untraced: TestRecord[];
  unknownTags: string[];
};

// ---------------------------------------------------------------- markdown (CI summary)

function renderMarkdown(m: Model): string {
  const icon: Record<RequirementStatus, string> = { passed: '✅', failed: '❌', 'not-run': '⏭️', 'no-tests': '⚠️' };
  const r = m.totals.requirements;
  const lines = [
    `## Compliance evidence: ${m.system}`,
    '',
    `**${r.passed ?? 0}** passed · **${r.failed ?? 0}** failed · **${r['not-run'] ?? 0}** not run · **${r['no-tests'] ?? 0}** without tests`,
    '',
    '| Req | Requirement | Control | Risk | Tests | Result |',
    '| --- | --- | --- | --- | --- | --- |',
    ...m.requirements.map(
      (q) => `| ${q.id} | ${q.title} | ${q.control} | ${q.risk} | ${q.tests.length} | ${icon[q.status]} ${STATUS_TEXT[q.status]} |`
    ),
    '',
  ];
  if (m.untraced.length) lines.push(`${m.untraced.length} test(s) are not linked to a requirement.`, '');
  lines.push('Full report with step-by-step evidence and screenshots: download the **compliance-report** artifact.');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- HTML

function pill(status: RequirementStatus | Outcome, text: string): string {
  return `<span class="pill pill-${status}">${esc(text)}</span>`;
}

function renderHtml(m: Model, jsonHash: string): string {
  const r = m.totals.requirements;
  const t = m.totals.tests;
  const run = m.run;
  const failedOrGaps = m.requirements.filter((q) => q.status !== 'passed');
  const flaky = m.requirements.flatMap((q) => q.tests).filter((x) => x.outcome === 'flaky');
  const allEvidence = [...new Map(m.requirements.flatMap((q) => q.tests.flatMap((x) => x.evidence)).map((e) => [e.sha256, e])).values()];

  const detail = (label: string, value: string | null, href?: string | null) =>
    `<div><dt>${esc(label)}</dt><dd>${value ? (href ? `<a href="${esc(href)}">${esc(value)}</a>` : esc(value)) : '<span class="muted">Not recorded</span>'}</dd></div>`;

  const matrixRows = m.requirements
    .map(
      (q) => `<tr>
        <th scope="row"><a href="#${esc(q.id)}">${esc(q.id)}</a></th>
        <td>${esc(q.title)}<div class="sub">${esc(q.category)}</div></td>
        <td>${esc(q.control)}</td>
        <td class="risk risk-${esc(q.risk)}">${esc(q.risk)}</td>
        <td class="num">${q.tests.length}</td>
        <td>${pill(q.status, STATUS_TEXT[q.status])}</td>
      </tr>`
    )
    .join('');

  const gapItems = [
    ...failedOrGaps.map((q) => {
      const why =
        q.status === 'no-tests'
          ? 'No automated test is linked to this requirement.'
          : q.status === 'failed'
            ? `${q.tests.filter((x) => x.outcome === 'failed').length} test(s) failed.`
            : `All linked tests were skipped: ${[...new Set(q.tests.map((x) => x.skipReason))].join('; ')}.`;
      return `<li>${pill(q.status, STATUS_TEXT[q.status])} <a href="#${esc(q.id)}">${esc(q.id)}</a> ${esc(q.title)}. <span class="muted">${esc(why)}</span></li>`;
    }),
    ...flaky.map(
      (x) => `<li>${pill('flaky', 'Passed on retry')} ${esc(x.title)} <span class="muted">(${esc(x.project)}, ${x.attempts} attempts). Investigate before relying on this result.</span></li>`
    ),
    ...(m.unknownTags.length
      ? [`<li>${pill('failed', 'Unknown tag')} Tests reference requirements that are not in the catalog: ${esc(m.unknownTags.join(', '))}.</li>`]
      : []),
  ];

  const untracedList = m.untraced.length
    ? `<details><summary>${m.untraced.length} test(s) not linked to any requirement</summary><ul class="plain">${m.untraced
        .map((x) => `<li>${esc(x.title)} <span class="muted">${esc(x.file)}:${x.line} · ${esc(x.project)}</span></li>`)
        .join('')}</ul></details>`
    : '<p class="muted">Every test in this run is linked to a requirement.</p>';

  const sections = m.requirements
    .map((q) => {
      const tests = q.tests.length
        ? q.tests
            .map(
              (x) => `<article class="test">
          <header class="test-head">
            <h4>${esc(x.title)}</h4>
            ${pill(x.outcome, OUTCOME_TEXT[x.outcome])}
          </header>
          <p class="test-meta">${esc(x.project)} · ${esc(x.file)}:${x.line} · ${x.attempts > 1 ? `${x.attempts} attempts · ` : ''}${fmtDuration(x.durationMs)}${x.startedAt ? ` · ${esc(new Date(x.startedAt).toISOString())}` : ''}</p>
          ${x.skipReason ? `<p class="note">Skipped: ${esc(x.skipReason)}</p>` : ''}
          ${x.error ? `<pre class="error">${esc(x.error)}</pre>` : ''}
          ${x.steps.length ? `<ol class="steps">${x.steps.map((s) => `<li${s.startsWith('  ') ? ' class="sub-step"' : ''}>${esc(s.trim())}</li>`).join('')}</ol>` : ''}
          ${x.evidence
            .map(
              (e) => `<figure><img src="${esc(e.file)}" alt="${esc(e.label)}"><figcaption>${esc(e.label)} <span class="hash">sha256 ${esc(e.sha256.slice(0, 16))}…</span></figcaption></figure>`
            )
            .join('')}
        </article>`
            )
            .join('')
        : '<p class="note">No automated test covers this requirement. Add a test tagged <code>@' + esc(q.id) + '</code>, or record why it is tested manually.</p>';

      return `<section class="req" id="${esc(q.id)}">
        <header class="req-head">
          <h3><span class="req-id">${esc(q.id)}</span> ${esc(q.title)}</h3>
          ${pill(q.status, STATUS_TEXT[q.status])}
        </header>
        <dl class="req-meta">
          <div><dt>Category</dt><dd>${esc(q.category)}</dd></div>
          <div><dt>Control</dt><dd>${esc(q.control)}</dd></div>
          <div><dt>Risk</dt><dd>${esc(q.risk)}</dd></div>
        </dl>
        ${tests}
      </section>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test evidence report: ${esc(m.system)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #1f2328; --muted: #5f6670; --rule: #d5d8dc; --sheet: #ffffff; --desk: #eef0f2;
    --pass: #1f6b45; --pass-bg: #e3f1e8; --fail: #a32d22; --fail-bg: #f8e3e0;
    --skip: #7a5b12; --skip-bg: #f6eccf; --gap: #5b4a8a; --gap-bg: #ebe6f6; --accent: #23395b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--desk); color: var(--ink); font: 14px/1.55 "IBM Plex Sans", system-ui, sans-serif; }
  .sheet { max-width: 980px; margin: 32px auto; background: var(--sheet); padding: 56px 64px; box-shadow: 0 1px 0 var(--rule); }
  h1, h2, h3 { font-family: "IBM Plex Serif", Georgia, serif; font-weight: 600; line-height: 1.25; }
  h1 { font-size: 30px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 44px 0 14px; padding-top: 18px; border-top: 2px solid var(--ink); }
  h3 { font-size: 17px; margin: 0; }
  h4 { font-size: 14px; margin: 0; font-weight: 600; }
  a { color: var(--accent); }
  .muted, .sub { color: var(--muted); }
  .sub { font-size: 12px; }
  .doc-sub { color: var(--muted); margin: 0 0 28px; }
  code, pre, .hash { font-family: "IBM Plex Mono", monospace; }

  .verdict { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--rule); margin: 0 0 28px; }
  .verdict div { padding: 14px 16px; border-right: 1px solid var(--rule); }
  .verdict div:last-child { border-right: none; }
  .verdict strong { display: block; font: 600 28px/1.1 "IBM Plex Serif", Georgia, serif; }
  .verdict span { color: var(--muted); font-size: 13px; }

  dl.details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 32px; margin: 0; }
  dl.details div { display: grid; grid-template-columns: 150px 1fr; padding: 6px 0; border-bottom: 1px solid var(--rule); }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--rule); }
  thead th { font-weight: 600; color: var(--muted); border-bottom: 2px solid var(--ink); }
  tbody th { font-weight: 600; white-space: nowrap; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .risk { font-weight: 600; }
  .risk-P1 { color: var(--fail); }

  .pill { display: inline-block; padding: 1px 8px; border-radius: 3px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .pill-passed { color: var(--pass); background: var(--pass-bg); }
  .pill-failed { color: var(--fail); background: var(--fail-bg); }
  .pill-not-run, .pill-skipped { color: var(--skip); background: var(--skip-bg); }
  .pill-no-tests, .pill-flaky { color: var(--gap); background: var(--gap-bg); }

  ul.gaps, ul.plain { padding-left: 0; list-style: none; margin: 0; }
  ul.gaps li, ul.plain li { padding: 7px 0; border-bottom: 1px solid var(--rule); }
  details summary { cursor: pointer; margin-top: 12px; }

  .req { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--rule); }
  .req-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
  .req-id { font-family: "IBM Plex Mono", monospace; font-weight: 400; color: var(--muted); margin-right: 6px; }
  .req-meta { display: flex; flex-wrap: wrap; gap: 4px 28px; margin: 8px 0 14px; font-size: 13px; }
  .req-meta div { display: flex; gap: 8px; }
  .test { border-left: 3px solid var(--rule); padding: 4px 0 4px 16px; margin: 14px 0; }
  .test-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .test-meta { color: var(--muted); font-size: 12px; margin: 2px 0 8px; overflow-wrap: anywhere; }
  .steps { margin: 6px 0 10px; padding-left: 22px; font-size: 13px; }
  .steps li { padding: 1px 0; }
  .steps li.sub-step { list-style: none; margin-left: 14px; color: var(--muted); font-size: 12px; }
  .note { background: var(--skip-bg); color: var(--skip); padding: 6px 10px; font-size: 13px; }
  pre.error { background: var(--fail-bg); color: var(--fail); padding: 10px 12px; white-space: pre-wrap; font-size: 12px; }
  figure { margin: 10px 0 14px; }
  figure img { display: block; max-width: 100%; max-height: 420px; border: 1px solid var(--rule); }
  figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .hash { font-size: 11px; margin-left: 6px; }

  .signoff { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 18px; }
  .signoff div { border-top: 1px solid var(--ink); padding-top: 6px; color: var(--muted); font-size: 12px; min-height: 48px; }
  footer { margin-top: 40px; color: var(--muted); font-size: 12px; }

  @media (max-width: 760px) {
    .sheet { margin: 0; padding: 28px 18px; }
    .verdict { grid-template-columns: repeat(2, 1fr); }
    .verdict div:nth-child(2) { border-right: none; }
    .verdict div:nth-child(-n + 2) { border-bottom: 1px solid var(--rule); }
    dl.details { grid-template-columns: 1fr; }
    dl.details div { grid-template-columns: 120px 1fr; }
    .matrix-wrap { overflow-x: auto; }
    .signoff { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #fff; }
    .sheet { margin: 0; padding: 0; max-width: none; box-shadow: none; }
    h2 { break-after: avoid; }
    .req, figure { break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
    details { display: block; }
  }
</style>
</head>
<body>
<main class="sheet">
  <h1>Test evidence report</h1>
  <p class="doc-sub">${esc(m.system)} · generated ${esc(new Date(m.generatedAt).toUTCString())}</p>

  <div class="verdict" role="group" aria-label="Requirement results">
    <div><strong>${r.passed ?? 0}</strong><span>requirements passed</span></div>
    <div><strong>${r.failed ?? 0}</strong><span>failed</span></div>
    <div><strong>${r['not-run'] ?? 0}</strong><span>not run (all tests skipped)</span></div>
    <div><strong>${r['no-tests'] ?? 0}</strong><span>without automated tests</span></div>
  </div>

  <h2>Run details</h2>
  <dl class="details">
    ${detail('Overall result', run.status)}
    ${detail('Started', run.startedAt ? new Date(run.startedAt).toUTCString() : null)}
    ${detail('Duration', fmtDuration(run.durationMs))}
    ${detail('Commit', run.commit ? run.commit.slice(0, 12) : null)}
    ${detail('Branch', run.branch)}
    ${detail('CI run', run.ciRun ? 'GitHub Actions' : 'Local run', run.ciRun)}
    ${detail('Projects', run.projects.join(', '))}
    ${detail('Target host', run.target)}
    ${detail('Tests', `${t.passed ?? 0} passed, ${t.failed ?? 0} failed, ${t.flaky ?? 0} passed on retry, ${t.skipped ?? 0} skipped`)}
    ${detail('Tooling', `Playwright ${run.playwright}, Node ${run.node}`)}
  </dl>

  <h2>Traceability matrix</h2>
  <div class="matrix-wrap">
  <table>
    <thead><tr><th scope="col">ID</th><th scope="col">Requirement</th><th scope="col">Control</th><th scope="col">Risk</th><th scope="col">Tests</th><th scope="col">Result</th></tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>
  </div>

  <h2>Gaps and exceptions</h2>
  ${gapItems.length ? `<ul class="gaps">${gapItems.join('')}</ul>` : '<p>No failed, skipped or untested requirements, and no tests that needed a retry.</p>'}
  ${untracedList}

  <h2>Evidence by requirement</h2>
  ${sections}

  <h2>Integrity</h2>
  <p>Screenshots are stored under their SHA-256 hash, and <code>evidence.json</code> holds every result in this report. Re-hash the files to confirm nothing changed after the run.</p>
  <dl class="details">
    <div><dt>evidence.json</dt><dd class="hash">${esc(jsonHash)}</dd></div>
    <div><dt>Screenshots</dt><dd>${allEvidence.length} file(s)</dd></div>
  </dl>

  <h2>Review and sign-off</h2>
  <div class="signoff">
    <div>Reviewed by</div>
    <div>Date</div>
    <div>Signature</div>
  </div>

  <footer>Generated by playwright/reporters/compliance-reporter.ts from compliance/requirements.json.</footer>
</main>
</body>
</html>
`;
}
