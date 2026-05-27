ALTER TABLE trust_scores
  ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timeout_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fulfillment_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_failure_count_nonnegative'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_failure_count_nonnegative
      CHECK (failure_count >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_cancellation_count_nonnegative'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_cancellation_count_nonnegative
      CHECK (cancellation_count >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_completion_count_nonnegative'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_completion_count_nonnegative
      CHECK (completion_count >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_timeout_count_nonnegative'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_timeout_count_nonnegative
      CHECK (timeout_count >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_fulfillment_count_nonnegative'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_fulfillment_count_nonnegative
      CHECK (fulfillment_count >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_refund_count_nonnegative'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_refund_count_nonnegative
      CHECK (refund_count >= 0) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trust_events_type_created
  ON trust_events (event_type, created_at DESC);
