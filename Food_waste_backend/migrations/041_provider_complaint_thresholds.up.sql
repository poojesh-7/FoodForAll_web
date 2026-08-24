ALTER TABLE trust_scores
  ADD COLUMN IF NOT EXISTS provider_complaint_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_provider_complaint_count_nonnegative'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_provider_complaint_count_nonnegative
      CHECK (provider_complaint_count >= 0) NOT VALID;
  END IF;
END
$$;
