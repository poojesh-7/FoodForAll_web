DROP INDEX IF EXISTS idx_trust_scores_projected_cooldown;
DROP INDEX IF EXISTS idx_trust_scores_operational_risk;

ALTER TABLE trust_scores
  DROP CONSTRAINT IF EXISTS trust_scores_risk_category_check,
  DROP CONSTRAINT IF EXISTS trust_scores_streaks_nonnegative,
  DROP CONSTRAINT IF EXISTS trust_scores_recovery_progress_bounds,
  DROP CONSTRAINT IF EXISTS trust_scores_projected_deposit_multiplier_minimum,
  DROP CONSTRAINT IF EXISTS trust_scores_projected_restriction_level_bounds;

ALTER TABLE trust_scores
  DROP COLUMN IF EXISTS risk_state,
  DROP COLUMN IF EXISTS decay_state,
  DROP COLUMN IF EXISTS recovery_state,
  DROP COLUMN IF EXISTS projected_actions,
  DROP COLUMN IF EXISTS score_breakdown,
  DROP COLUMN IF EXISTS last_decay_at,
  DROP COLUMN IF EXISTS last_failure_at,
  DROP COLUMN IF EXISTS last_success_at,
  DROP COLUMN IF EXISTS failure_streak,
  DROP COLUMN IF EXISTS success_streak,
  DROP COLUMN IF EXISTS risk_category,
  DROP COLUMN IF EXISTS recovery_progress,
  DROP COLUMN IF EXISTS projected_deposit_multiplier,
  DROP COLUMN IF EXISTS projected_cooldown_until,
  DROP COLUMN IF EXISTS projected_restriction_level;
