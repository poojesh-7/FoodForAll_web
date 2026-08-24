ALTER TABLE trust_scores
  DROP CONSTRAINT IF EXISTS trust_scores_provider_complaint_count_nonnegative,
  DROP COLUMN IF EXISTS provider_complaint_count;
