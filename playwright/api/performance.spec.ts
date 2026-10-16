// Lightweight performance tests for the dashboard API.
// Measures response-time percentiles under sequential and concurrent load and
// attaches the numbers to the HTML report, so a slowdown shows up as a failed build.
import { test, expect, type APIResponse } from '@playwright/test';

// Budgets are generous on purpose: CI runners are slower and noisier than a laptop.
const P95_BUDGET_MS = Number(process.env.PERF_P95_BUDGET_MS || 300);
const SAMPLES = 50;
const CONCURRENCY = 20;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

interface LatencyStats {
  samples: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

function summarize(durations: number[]): LatencyStats {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    minMs: sorted[0],
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1],
  };
}

async function timed(fn: () => Promise<APIResponse>): Promise<{ res: APIResponse; ms: number }> {
  const start = performance.now();
  const res = await fn();
  return { res, ms: Math.round(performance.now() - start) };
}

test.describe('Performance: GET /api/tests', { tag: '@R11' }, () => {
  test.describe.configure({ mode: 'serial' }); // don't let the two load tests compete

  test(`sequential: p95 under ${P95_BUDGET_MS}ms over ${SAMPLES} requests`, async ({ request }, testInfo) => {
    await request.get('/api/tests'); // warm-up, not measured

    const durations: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const { res, ms } = await timed(() => request.get('/api/tests'));
      expect(res.status()).toBe(200);
      durations.push(ms);
    }

    const stats = summarize(durations);
    await testInfo.attach('sequential-latency.json', { body: JSON.stringify(stats, null, 2), contentType: 'application/json' });
    expect(stats.p95Ms, `p95 was ${stats.p95Ms}ms`).toBeLessThan(P95_BUDGET_MS);
  });

  test(`concurrent: ${CONCURRENCY} parallel requests all succeed within budget`, async ({ request }, testInfo) => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => timed(() => request.get('/api/tests')))
    );

    for (const { res } of results) expect(res.status()).toBe(200);

    const stats = summarize(results.map((r) => r.ms));
    await testInfo.attach('concurrent-latency.json', { body: JSON.stringify(stats, null, 2), contentType: 'application/json' });
    // Under concurrency we allow 3x the sequential budget.
    expect(stats.p95Ms, `p95 was ${stats.p95Ms}ms`).toBeLessThan(P95_BUDGET_MS * 3);
  });
});
