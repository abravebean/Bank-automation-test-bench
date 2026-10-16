// Data integrity tests: the API must agree with the database (the system of record).
// Each test reads PostgreSQL directly with SQL and compares it to what the API returns.
// Skipped automatically when DATABASE_URL is not set.
import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { runListSchema, statsSchema, healthSchema, resultEventSchema } from './schemas';
import { expectToMatchSchema, parseNdjson } from '../support/schema';
import type { ResultEvent, Run, TestStats } from '../support/api-types';

const { DATABASE_URL } = process.env;

/** A row of the test_runs table, as node-postgres returns it. */
interface TestRunRow {
  id: number;
  test_name: string;
  engine: string;
  passed: boolean;
  message: string;
  duration_ms: number;
  started_at: Date;
}

test.describe('Run history: API vs. PostgreSQL', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is not set');

  let pool: Pool;
  // Unique name so this file's seeded rows never collide with other tests or runs.
  const SEEDED = `seeded-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    // Test data setup: one pass and one fail for the same test, written straight to the DB.
    await pool.query(
      `INSERT INTO test_runs (test_name, engine, passed, message, duration_ms, started_at)
       VALUES ($1, 'playwright', true,  'seeded pass', 1200, now() - interval '2 minutes'),
              ($1, 'playwright', false, 'seeded fail', 1800, now() - interval '1 minute')`,
      [SEEDED]
    );
  });

  test.afterAll(async () => {
    if (!pool) return;
    await pool.query('DELETE FROM test_runs WHERE test_name = $1', [SEEDED]);
    await pool.end();
  });

  test('health check reports the database as up', { tag: '@R8' }, async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expectToMatchSchema(body, healthSchema);
    expect(body.database).toBe('up');
  });

  test('running a test writes exactly one matching row to test_runs', { tag: '@R7' }, async ({ request }) => {
    test.setTimeout(60_000);
    const res = await request.post('/api/tests/invalid-login-rejected-playwright/run', { timeout: 55_000 });
    const events = parseNdjson(await res.text());
    const result = events[events.length - 1] as ResultEvent;
    expectToMatchSchema(result, resultEventSchema);
    expect(result.runId, 'result event should include the saved row id').toBeGreaterThan(0);

    const { rows } = await pool.query<TestRunRow>('SELECT * FROM test_runs WHERE id = $1', [result.runId]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.test_name).toBe(result.name);
    expect(row.engine).toBe('playwright');
    expect(row.passed).toBe(result.passed);
    expect(row.message).toBe(result.message);
    expect(row.duration_ms).toBe(result.durationMs);
  });

  test('GET /api/runs returns the same rows as the database, newest first', { tag: '@R8' }, async ({ request }) => {
    const res = await request.get(`/api/runs?test=${SEEDED}`);
    expect(res.status()).toBe(200);
    const runs: Run[] = await res.json();
    expectToMatchSchema(runs, runListSchema);

    const { rows } = await pool.query<TestRunRow>(
      'SELECT * FROM test_runs WHERE test_name = $1 ORDER BY started_at DESC, id DESC',
      [SEEDED]
    );
    expect(runs.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(runs.map((r) => r.message)).toEqual(['seeded fail', 'seeded pass']);
    expect(runs[0].startedAt).toBe(rows[0].started_at.toISOString());
  });

  test('GET /api/stats aggregates match a SQL count and flag flaky tests', { tag: ['@R8', '@R9'] }, async ({ request }) => {
    const res = await request.get('/api/stats');
    expect(res.status()).toBe(200);
    const stats: TestStats[] = await res.json();
    expectToMatchSchema(stats, statsSchema);

    const seeded = stats.find((s) => s.name === SEEDED);
    if (!seeded) throw new Error(`Seeded test ${SEEDED} is missing from /api/stats`);

    const { rows } = await pool.query<{ total: number; passed: number; avg: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE passed)::int AS passed,
              ROUND(AVG(duration_ms))::int AS avg
         FROM test_runs WHERE test_name = $1`,
      [SEEDED]
    );
    expect(seeded.totalRuns).toBe(rows[0].total);
    expect(seeded.passedRuns).toBe(rows[0].passed);
    expect(seeded.avgDurationMs).toBe(rows[0].avg);
    expect(seeded.passRate).toBe(0.5);
    expect(seeded.flaky).toBe(true); // passed once and failed once
  });

  for (const bad of ['0', '101', 'abc', '-5', '2.5']) {
    test(`rejects invalid limit=${bad} with 400`, { tag: '@R10' }, async ({ request }) => {
      const res = await request.get(`/api/runs?limit=${bad}`);
      expect(res.status()).toBe(400);
    });
  }

  test('SQL injection in the test filter is treated as plain text', { tag: '@R10' }, async ({ request }) => {
    const payload = encodeURIComponent("x'; DROP TABLE test_runs; --");
    const res = await request.get(`/api/runs?test=${payload}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([]);

    // The table must still exist and still hold our seeded rows.
    const { rows } = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM test_runs WHERE test_name = $1', [SEEDED]);
    expect(rows[0].n).toBe(2);
  });
});
