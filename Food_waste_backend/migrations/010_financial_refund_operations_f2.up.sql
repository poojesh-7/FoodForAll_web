CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS financial_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL,
  reservation_id UUID NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  payment_session_id TEXT NULL,
  payment_ownership_id UUID NULL REFERENCES payment_ownership(id) ON DELETE RESTRICT,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role TEXT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  retry_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_operations_amount_nonnegative
    CHECK (amount >= 0),
  CONSTRAINT financial_operations_retry_count_nonnegative
    CHECK (retry_count >= 0),
  CONSTRAINT financial_operations_currency_present
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT financial_operations_status_valid
    CHECK (status IN ('planned','processing','succeeded','failed','skipped','retained'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_operations_idempotency_key
  ON financial_operations (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_financial_operations_reservation
  ON financial_operations (reservation_id, created_at DESC)
  WHERE reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_operations_payment_session
  ON financial_operations (payment_session_id, created_at DESC)
  WHERE payment_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_operations_status
  ON financial_operations (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_operations_payment_ownership
  ON financial_operations (payment_ownership_id, created_at DESC)
  WHERE payment_ownership_id IS NOT NULL;
