#!/usr/bin/env node
// Checks a JMeter results file (.jtl, CSV) against performance/thresholds.json.
//
//   node scripts/load-check.js load-results/results.jtl [--base http://localhost:3000]
//                              [--holdings-before <cents>] [--json out.json]
//
// Prints a Markdown summary (for the CI job summary) and exits 1 if any budget is broken:
// error rate, p95 per request type, throughput, and, when --base is given, money conservation:
// every account still matches its ledger, and the bank's total grew by exactly the opening
// deposits of the customers the run created (transfers moved money but never made or lost any).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const jtl = args[0];
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
if (!jtl) {
  console.error('Usage: node scripts/load-check.js <results.jtl> [--base URL] [--holdings-before CENTS] [--json FILE]');
  process.exit(2);
}
const thresholds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'performance', 'thresholds.json'), 'utf8'));

/** Minimal CSV parser: JMeter quotes fields that contain commas or quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const samples = parseCsv(fs.readFileSync(jtl, 'utf8'));
  if (!samples.length) throw new Error(`No samples in ${jtl}`);

  const byLabel = new Map();
  for (const s of samples) {
    if (!byLabel.has(s.label)) byLabel.set(s.label, []);
    byLabel.get(s.label).push(s);
  }
  const start = Math.min(...samples.map((s) => Number(s.timeStamp)));
  const end = Math.max(...samples.map((s) => Number(s.timeStamp) + Number(s.elapsed)));
  const seconds = (end - start) / 1000;

  const failures = [];
  const rows = [];
  for (const [label, list] of byLabel) {
    const times = list.map((s) => Number(s.elapsed)).sort((a, b) => a - b);
    const errors = list.filter((s) => s.success !== 'true');
    const p95 = percentile(times, 95);
    const budget = thresholds.p95Ms[label] ?? thresholds.p95Ms.default;
    // Setup steps run once per user, so they're reported but not held to the latency budget.
    const budgeted = list.length >= 50;
    const ok = !budgeted || p95 <= budget;
    if (!ok) failures.push(`${label}: p95 ${p95} ms is over the ${budget} ms budget`);
    rows.push({ label, count: list.length, errors: errors.length, p50: percentile(times, 50), p95, p99: percentile(times, 99), max: times[times.length - 1], budget: budgeted ? budget : null, ok, firstError: errors[0]?.failureMessage || errors[0]?.responseMessage });
  }

  const total = samples.length;
  const errorCount = samples.filter((s) => s.success !== 'true').length;
  const errorRate = (errorCount / total) * 100;
  const rps = total / seconds;
  if (errorRate > thresholds.maxErrorRatePct) failures.push(`Error rate ${errorRate.toFixed(2)}% is over ${thresholds.maxErrorRatePct}%`);
  if (rps < thresholds.minRequestsPerSecond) failures.push(`Throughput ${rps.toFixed(1)} req/s is under ${thresholds.minRequestsPerSecond} req/s`);
  for (const r of rows) if (r.errors) failures.push(`${r.label}: ${r.errors} failed (${r.firstError || 'see the report'})`);

  const users = Math.max(...samples.map((s) => Number(s.allThreads) || 0));
  let money = null;
  const base = opt('base');
  if (base) {
    const res = await fetch(`${base.replace(/\/$/, '')}/bank/api/test/integrity`);
    const integrity = await res.json();
    const created = (byLabel.get('Create test customer') || []).filter((s) => s.success === 'true').length;
    const openingCents = Number(process.env.LOAD_OPENING_CENTS || 20_000_000); // checking + savings per load user
    const before = opt('holdings-before') !== undefined ? Number(opt('holdings-before')) : null;
    const expected = before === null ? null : before + created * openingCents;
    money = { mismatches: integrity.ledgerMismatches.length, totalAfter: integrity.totalHoldingsCents, expected, created };
    if (integrity.ledgerMismatches.length) failures.push(`${integrity.ledgerMismatches.length} accounts don't match their ledger`);
    if (expected !== null && integrity.totalHoldingsCents !== expected) {
      failures.push(`Money not conserved: the bank holds ${integrity.totalHoldingsCents} cents, expected ${expected}`);
    }
  }

  const fmt = (n) => n.toLocaleString('en-US');
  const lines = [
    `## Load test (JMeter): ${failures.length ? '❌ failed' : '✅ passed'}`,
    '',
    `**${fmt(total)} requests** from ${users} virtual users in ${seconds.toFixed(0)} s · **${rps.toFixed(1)} req/s** · errors ${errorRate.toFixed(2)}% (budget ${thresholds.maxErrorRatePct}%)`,
    '',
    '| Request | Count | Errors | p50 | p95 | p99 | Max | p95 budget |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...rows.map((r) => `| ${r.label} | ${fmt(r.count)} | ${r.errors} | ${r.p50} ms | ${r.p95} ms | ${r.p99} ms | ${r.max} ms | ${r.budget === null ? 'setup, not budgeted' : `${r.ok ? '✅' : '❌'} ${r.budget} ms`} |`),
  ];
  if (money) {
    lines.push('', `**Money conservation:** ${money.mismatches === 0 ? '✅' : '❌'} ${money.mismatches} accounts out of line with their ledger` +
      (money.expected === null ? '' : ` · ${money.totalAfter === money.expected ? '✅' : '❌'} total held matches opening deposits of the ${money.created} customers created`));
  }
  if (failures.length) lines.push('', '**Broken budgets:**', ...failures.map((f) => `- ${f}`));
  console.log(lines.join('\n'));
  if (process.env.GITHUB_ACTIONS) for (const f of failures) console.log(`::error title=Load test budget::${f}`);

  const jsonOut = opt('json');
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ passed: !failures.length, requests: total, users, seconds: Math.round(seconds), rps: Number(rps.toFixed(1)), errorRatePct: Number(errorRate.toFixed(2)), labels: rows, money, failures, thresholds, generatedAt: new Date().toISOString() }, null, 2));
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`load-check: ${err.message}`);
  process.exit(2);
});
