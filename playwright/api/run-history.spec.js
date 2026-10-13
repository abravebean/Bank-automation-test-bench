// Data integrity tests: the API must agree with the database (the system of record).
// Each test reads PostgreSQL directly with SQL and compares it to what the API returns.
// Skipped automatically when DATABASE_URL is not set.
const { test, expect } = require('@playwright/test');
const { Pool } = require('pg');
const Ajv = require('ajv');
const { runListSchema, statsSchema, healthSchema, resultEventSchema } = require('./schemas');

const { DATABASE_URL } = process.env;
const ajv = new Ajv({ allErrors: true });

function expectToMatchSchema(data, schema) {
  const validate = ajv.compile(schema);
  expect(validate(data), ajv.errorsText(validate.errors)).toBe(true);
}

test.describe('Run history: API vs. PostgreSQL', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL is not set');

  /** @type {import('pg').Pool} */
  let pool;
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

  test('health check reports the database as up', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expectToMatchSchema(body, healthSchema);
    expect(body.database).toBe('up');
  });

  test('running a test writes exactly one matching row to test_runs', async ({ request }) => {
    test.setTimeout(60_000);
    const res = await request.post('/api/tests/invalid-login-rejected-playwright/run', { timeout: 55_000 });
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    const result = events.at(-1);
    expectToMatchSchema(result, resultEventSchema);
    expect(result.runId, 'result event should include the saved row id').toBeGreaterThan(0);

    const { rows } = await pool.query('SELECT * FROM test_runs WHERE id = $1', [result.runId]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.test_name).toBe(result.name);
    expect(row.engine).toBe('playwright');
    expect(row.passed).toBe(result.passed);
    expect(row.message).toBe(result.message);
    expect(row.duration_ms).toBe(result.durationMs);
  });

  test('GET /api/runs returns the same rows as the database, newest first', async ({ request }) => {
    const res = await request.get(`/api/runs?test=${SEEDED}`);
    expect(res.status()).toBe(200);
    const runs = await res.json();
    expectToMatchSchema(runs, runListSchema);

    const { rows } = await pool.query(
      'SELECT * FROM test_runs WHERE test_name = $1 ORDER BY started_at DESC, id DESC',
      [SEEDED]
    );
    expect(runs.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(runs.map((r) => r.message)).toEqual(['seeded fail', 'seeded pass']);
    expect(runs[0].startedAt).toBe(rows[0].started_at.toISOString());
  });

  test('GET /api/stats aggregates match a SQL count and flag flaky tests', async ({ request }) => {
    const res = await request.get('/api/stats');
    expect(res.status()).toBe(200);
    const stats = await res.json();
    expectToMatchSchema(stats, statsSchema);

    const seeded = stats.find((s) => s.name === SEEDED);
    expect(seeded).toBeDefined();

    const { rows } = await pool.query(
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
    test(`rejects invalid limit=${bad} with 400`, async ({ request }) => {
      const res = await request.get(`/api/runs?limit=${bad}`);
      expect(res.status()).toBe(400);
    });
  }

  test('SQL injection in the test filter is treated as plain text', async ({ request }) => {
    const payload = encodeURIComponent("x'; DROP TABLE test_runs; --");
    const res = await request.get(`/api/runs?test=${payload}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([]);

    // The table must still exist and still hold our seeded rows.
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM test_runs WHERE test_name = $1', [SEEDED]);
    expect(rows[0].n).toBe(2);
  });
});
