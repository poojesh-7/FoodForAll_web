ALTER TABLE operational_events
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_operational_events_correlation
  ON operational_events (correlation_id, created_at DESC)
  WHERE correlation_id IS NOT NULL;
