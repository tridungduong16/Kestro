CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  method TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  timeout_seconds INTEGER NOT NULL DEFAULT 30 CHECK (timeout_seconds BETWEEN 1 AND 120),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 5),
  next_run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  status_code INTEGER,
  duration_ms INTEGER NOT NULL,
  error TEXT,
  response_body TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedules_due
  ON schedules (status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_executions_schedule_started
  ON executions (schedule_id, started_at DESC);

