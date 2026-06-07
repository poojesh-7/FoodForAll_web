CREATE TABLE IF NOT EXISTS admin_trust_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NULL,
  trust_event_key TEXT NOT NULL UNIQUE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_trust_actions_type_check CHECK (
    action_type IN (
      'MANUAL_RESTRICTION',
      'MANUAL_COOLDOWN',
      'MANUAL_RECOVERY_CREDIT',
      'VERIFIED_GOOD_BEHAVIOR',
      'TRUST_REVIEW_FLAG'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_admin_trust_actions_subject_created
  ON admin_trust_actions (subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_trust_actions_admin_created
  ON admin_trust_actions (admin_user_id, created_at DESC)
  WHERE admin_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_trust_actions_type_created
  ON admin_trust_actions (action_type, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_trust_actions_idempotency
  ON admin_trust_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_admin_trust_action_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_trust_actions rows are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_trust_actions_immutable ON admin_trust_actions;

CREATE TRIGGER trg_admin_trust_actions_immutable
  BEFORE UPDATE OR DELETE ON admin_trust_actions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_admin_trust_action_mutation();
