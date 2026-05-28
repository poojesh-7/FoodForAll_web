CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS payment_ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  payment_session_id TEXT NOT NULL,
  payer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payer_role TEXT NOT NULL,
  provider_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  beneficiary_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  beneficiary_role TEXT NULL,
  platform_account_id TEXT NULL,
  deposit_owner_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  deposit_owner_role TEXT NULL,
  refund_target_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  refund_target_role TEXT NULL,
  commission_receiver_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  commission_receiver_role TEXT NULL,
  food_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  ownership_version INTEGER NOT NULL DEFAULT 1,
  snapshot_hash TEXT NOT NULL,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_ownership_amounts_nonnegative
    CHECK (food_amount >= 0 AND deposit_amount >= 0 AND commission_amount >= 0),
  CONSTRAINT payment_ownership_version_positive
    CHECK (ownership_version > 0),
  CONSTRAINT payment_ownership_currency_present
    CHECK (length(trim(currency)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_ownership_reservation_session_version
  ON payment_ownership (reservation_id, payment_session_id, ownership_version);

CREATE INDEX IF NOT EXISTS idx_payment_ownership_reservation
  ON payment_ownership (reservation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_ownership_payment_session
  ON payment_ownership (payment_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_ownership_payer
  ON payment_ownership (payer_user_id, payer_role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_ownership_provider
  ON payment_ownership (provider_id, created_at DESC)
  WHERE provider_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_ownership_refund_target
  ON payment_ownership (refund_target_user_id, refund_target_role, created_at DESC)
  WHERE refund_target_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_payment_ownership_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment_ownership rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_ownership_immutable ON payment_ownership;
CREATE TRIGGER trg_payment_ownership_immutable
  BEFORE UPDATE OR DELETE ON payment_ownership
  FOR EACH ROW
  EXECUTE FUNCTION prevent_payment_ownership_mutation();
