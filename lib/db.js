// PostgreSQL run history.
// Optional: with no database configured, every function is a safe no-op and the
// dashboard works exactly as before. Recording a run must never break a test run.
//
// Configure with either DATABASE_URL (local, Docker Compose, CI) or the standard
// PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD variables (AWS: the password
// comes from Secrets Manager). DB_SSL=true requires a verified TLS connection.
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const CONFIGURED = Boolean(DATABASE_URL || process.env.PGHOST);
let pool = null;

function isEnabled() {
  return Boolean(pool);
}

async function init() {
  if (!CONFIGURED) return false;
  const { Pool } = require('pg');
  const candidate = new Pool({
    // Without a connection string, node-postgres reads the PG* environment variables.
    ...(DATABASE_URL ? { connectionString: DATABASE_URL } : {}),
    // Verified TLS: the server certificate must chain to a trusted CA (the Docker image
    // adds Amazon's RDS bundle via NODE_EXTRA_CA_CERTS).
    ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
    max: 5,
  });
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  try {
    await candidate.query(schema);
  } catch (err) {
    await candidate.end().catch(() => {});
    throw err; // pool stays null, so run history stays disabled
  }
  pool = candidate;
  return true;
}

async function ping() {
  if (!pool) return 'disabled';
  try {
    await pool.query('SELECT 1');
    return 'up';
  } catch {
    return 'down';
  }
}

// Parameterized query ($1, $2...) so test names and messages can never inject SQL.
async function recordRun({ name, engine, passed, message, durationMs }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO test_runs (test_name, engine, passed, message, duration_ms)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [name, engine, passed, message, durationMs]
  );
  return rows[0].id;
}

async function listRuns({ limit = 20, testName } = {}) {
  const params = [limit];
  let where = '';
  if (testName) {
    params.push(testName);
    where = 'WHERE test_name = $2';
  }
  const { rows } = await pool.query(
    `SELECT id, test_name, engine, passed, message, duration_ms, started_at
       FROM test_runs ${where}
      ORDER BY started_at DESC, id DESC
      LIMIT $1`,
    params
  );
  return rows.map(toApi);
}

// Per-test quality metrics computed in SQL: pass rate, average duration,
// and a flaky flag for tests that have both passed and failed recently.
async function getStats() {
  const { rows } = await pool.query(
    `SELECT test_name,
            engine,
            COUNT(*)::int                                   AS total_runs,
            COUNT(*) FILTER (WHERE passed)::int             AS passed_runs,
            ROUND(AVG(duration_ms))::int                    AS avg_duration_ms,
            MAX(started_at)                                 AS last_run_at
       FROM test_runs
      GROUP BY test_name, engine
      ORDER BY test_name`
  );
  return rows.map((r) => {
    const passRate = r.total_runs ? r.passed_runs / r.total_runs : 0;
    return {
      name: r.test_name,
      engine: r.engine,
      totalRuns: r.total_runs,
      passedRuns: r.passed_runs,
      passRate: Math.round(passRate * 1000) / 1000,
      avgDurationMs: r.avg_duration_ms,
      lastRunAt: r.last_run_at.toISOString(),
      flaky: r.passed_runs > 0 && r.passed_runs < r.total_runs,
    };
  });
}

function toApi(r) {
  return {
    id: r.id,
    name: r.test_name,
    engine: r.engine,
    passed: r.passed,
    message: r.message,
    durationMs: r.duration_ms,
    startedAt: r.started_at.toISOString(),
  };
}

async function close() {
  if (pool) await pool.end();
}

module.exports = { init, isEnabled, ping, recordRun, listRuns, getStats, close };
