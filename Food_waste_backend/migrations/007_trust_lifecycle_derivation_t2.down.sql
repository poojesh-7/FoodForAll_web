DROP INDEX IF EXISTS idx_trust_events_type_created;

ALTER TABLE trust_scores
  DROP CONSTRAINT IF EXISTS trust_scores_refund_count_nonnegative,
  DROP CONSTRAINT IF EXISTS trust_scores_fulfillment_count_nonnegative,
  DROP CONSTRAINT IF EXISTS trust_scores_timeout_count_nonnegative,
  DROP CONSTRAINT IF EXISTS trust_scores_completion_count_nonnegative,
  DROP CONSTRAINT IF EXISTS trust_scores_cancellation_count_nonnegative,
  DROP CONSTRAINT IF EXISTS trust_scores_failure_count_nonnegative;

ALTER TABLE trust_scores
  DROP COLUMN IF EXISTS refund_count,
  DROP COLUMN IF EXISTS fulfillment_count,
  DROP COLUMN IF EXISTS timeout_count,
  DROP COLUMN IF EXISTS completion_count,
  DROP COLUMN IF EXISTS cancellation_count,
  DROP COLUMN IF EXISTS failure_count;
