CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS trust_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reservation_id UUID NULL,
  payment_id UUID NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMP NULL,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT trust_events_processing_status_check
    CHECK (processing_status IN ('pending', 'retry', 'processing', 'processed', 'failed'))
);

CREATE TABLE IF NOT EXISTS trust_scores (
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  trust_score NUMERIC NOT NULL DEFAULT 100,
  penalty_level INTEGER NOT NULL DEFAULT 0,
  deposit_multiplier NUMERIC NOT NULL DEFAULT 1,
  cooldown_until TIMESTAMP NULL,
  restriction_level INTEGER NOT NULL DEFAULT 0,
  last_event_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject_type, subject_id),
  CONSTRAINT trust_scores_trust_score_bounds
    CHECK (trust_score >= 0 AND trust_score <= 100),
  CONSTRAINT trust_scores_penalty_level_nonnegative
    CHECK (penalty_level >= 0),
  CONSTRAINT trust_scores_deposit_multiplier_minimum
    CHECK (deposit_multiplier >= 1),
  CONSTRAINT trust_scores_restriction_level_nonnegative
    CHECK (restriction_level >= 0)
);

CREATE TABLE IF NOT EXISTS trust_restrictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restriction_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  active_until TIMESTAMP NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trust_event_effects (
  event_id UUID NOT NULL REFERENCES trust_events(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  effect_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_trust_events_processing
  ON trust_events (processing_status, created_at, id)
  WHERE processing_status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS idx_trust_events_subject_history
  ON trust_events (subject_type, subject_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_events_source
  ON trust_events (source_type, source_id, event_type);

CREATE INDEX IF NOT EXISTS idx_trust_events_reservation
  ON trust_events (reservation_id, created_at DESC)
  WHERE reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trust_events_payment
  ON trust_events (payment_id, created_at DESC)
  WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_restrictions_subject_type
  ON trust_restrictions (restriction_type, subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_trust_restrictions_subject
  ON trust_restrictions (subject_type, subject_id, active_until DESC);

CREATE INDEX IF NOT EXISTS idx_trust_event_effects_subject
  ON trust_event_effects (subject_type, subject_id, created_at DESC);
