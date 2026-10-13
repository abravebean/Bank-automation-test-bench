-- Run history for the test bench.
-- Applied automatically at server startup (idempotent), and by docker-compose on first boot.

CREATE TABLE IF NOT EXISTS test_runs (
  id           SERIAL PRIMARY KEY,
  test_name    TEXT        NOT NULL,
  engine       TEXT        NOT NULL CHECK (engine IN ('selenium', 'playwright')),
  passed       BOOLEAN     NOT NULL,
  message      TEXT        NOT NULL,
  duration_ms  INTEGER     NOT NULL CHECK (duration_ms >= 0),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Latest runs for a test" is the most common query, so index it.
CREATE INDEX IF NOT EXISTS idx_test_runs_name_started
  ON test_runs (test_name, started_at DESC);
