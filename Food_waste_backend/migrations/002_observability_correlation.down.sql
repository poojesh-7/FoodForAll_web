DROP INDEX IF EXISTS idx_operational_events_correlation;

ALTER TABLE operational_events
  DROP COLUMN IF EXISTS correlation_id;
