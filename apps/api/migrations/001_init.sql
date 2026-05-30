CREATE TABLE IF NOT EXISTS schedules (
  id BINARY(16) PRIMARY KEY,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  method VARCHAR(16) NOT NULL,
  cron_expression VARCHAR(255) NOT NULL,
  headers JSON NOT NULL,
  payload TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  timeout_seconds INT NOT NULL DEFAULT 30,
  retry_count INT NOT NULL DEFAULT 0,
  next_run_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_schedules_status CHECK (status IN ('active', 'paused')),
  CONSTRAINT chk_schedules_timeout CHECK (timeout_seconds BETWEEN 1 AND 120),
  CONSTRAINT chk_schedules_retry_count CHECK (retry_count BETWEEN 0 AND 5),
  KEY idx_schedules_due (status, next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS executions (
  id BINARY(16) PRIMARY KEY,
  schedule_id BINARY(16) NOT NULL,
  started_at DATETIME(6) NOT NULL,
  finished_at DATETIME(6) NOT NULL,
  status VARCHAR(16) NOT NULL,
  status_code INT,
  duration_ms INT NOT NULL,
  error TEXT,
  response_body TEXT,
  CONSTRAINT fk_executions_schedule_id
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
  CONSTRAINT chk_executions_status CHECK (status IN ('success', 'failed')),
  KEY idx_executions_schedule_started (schedule_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
