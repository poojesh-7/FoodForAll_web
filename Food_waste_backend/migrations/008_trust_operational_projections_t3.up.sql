ALTER TABLE trust_scores
  ADD COLUMN IF NOT EXISTS projected_restriction_level INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS projected_cooldown_until TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS projected_deposit_multiplier NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recovery_progress NUMERIC NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS risk_category TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS success_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_decay_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS projected_actions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recovery_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS decay_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_state JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_projected_restriction_level_bounds'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_projected_restriction_level_bounds
      CHECK (projected_restriction_level >= 0 AND projected_restriction_level <= 5) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_projected_deposit_multiplier_minimum'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_projected_deposit_multiplier_minimum
      CHECK (projected_deposit_multiplier >= 1) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_recovery_progress_bounds'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_recovery_progress_bounds
      CHECK (recovery_progress >= 0 AND recovery_progress <= 100) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_streaks_nonnegative'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_streaks_nonnegative
      CHECK (success_streak >= 0 AND failure_streak >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trust_scores_risk_category_check'
  ) THEN
    ALTER TABLE trust_scores
      ADD CONSTRAINT trust_scores_risk_category_check
      CHECK (risk_category IN ('normal', 'watch', 'elevated', 'high', 'severe', 'critical')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trust_scores_operational_risk
  ON trust_scores (risk_category, projected_restriction_level, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trust_scores_projected_cooldown
  ON trust_scores (projected_cooldown_until)
  WHERE projected_cooldown_until IS NOT NULL;
