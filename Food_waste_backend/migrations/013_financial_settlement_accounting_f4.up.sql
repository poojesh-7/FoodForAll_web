CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS settlement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned',
  currency TEXT NOT NULL DEFAULT 'INR',
  provider_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT settlement_batches_amounts_nonnegative
    CHECK (provider_total >= 0 AND commission_total >= 0),
  CONSTRAINT settlement_batches_currency_present
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT settlement_batches_status_valid
    CHECK (status IN ('planned','allocated','closed','cancelled'))
);

CREATE TABLE IF NOT EXISTS settlement_allocation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
  payment_session_id TEXT NOT NULL,
  payment_ownership_id UUID NOT NULL REFERENCES payment_ownership(id) ON DELETE RESTRICT,
  commission_percent NUMERIC(6,3) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  provider_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  platform_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  food_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  settlement_version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT settlement_allocation_amounts_nonnegative
    CHECK (
      commission_amount >= 0
      AND provider_amount >= 0
      AND platform_amount >= 0
      AND deposit_amount >= 0
      AND tax_amount >= 0
      AND food_amount >= 0
      AND total_amount >= 0
    ),
  CONSTRAINT settlement_allocation_commission_percent_nonnegative
    CHECK (commission_percent >= 0),
  CONSTRAINT settlement_allocation_currency_present
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT settlement_allocation_version_positive
    CHECK (settlement_version > 0)
);

CREATE TABLE IF NOT EXISTS provider_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
  payment_session_id TEXT NOT NULL,
  settlement_allocation_id UUID NOT NULL REFERENCES settlement_allocation_snapshots(id) ON DELETE RESTRICT,
  settlement_batch_id UUID NULL REFERENCES settlement_batches(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'allocated',
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_settlements_amounts_nonnegative
    CHECK (amount >= 0 AND commission_amount >= 0),
  CONSTRAINT provider_settlements_currency_present
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT provider_settlements_status_valid
    CHECK (status IN ('allocated','batched','settled','cancelled'))
);

CREATE TABLE IF NOT EXISTS financial_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
  payment_session_id TEXT NOT NULL,
  payment_ownership_id UUID NULL REFERENCES payment_ownership(id) ON DELETE RESTRICT,
  settlement_allocation_id UUID NULL REFERENCES settlement_allocation_snapshots(id) ON DELETE RESTRICT,
  provider_settlement_id UUID NULL REFERENCES provider_settlements(id) ON DELETE RESTRICT,
  settlement_batch_id UUID NULL REFERENCES settlement_batches(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role TEXT NULL,
  counterparty_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  counterparty_role TEXT NULL,
  refund_id TEXT NULL,
  source_type TEXT NOT NULL DEFAULT 'system',
  source_id TEXT NULL,
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_ledger_entries_amount_nonnegative
    CHECK (amount >= 0),
  CONSTRAINT financial_ledger_entries_currency_present
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT financial_ledger_entries_event_type_valid
    CHECK (event_type IN (
      'payment_collected',
      'food_payment_settled',
      'platform_commission',
      'deposit_collected',
      'deposit_refunded',
      'deposit_retained',
      'refund_issued',
      'refund_failed',
      'refund_retried',
      'settlement_allocated'
    ))
);

CREATE TABLE IF NOT EXISTS financial_refund_terminal_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  payment_session_id TEXT NOT NULL,
  payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
  refund_type TEXT NOT NULL,
  refund_id TEXT NULL,
  terminal_status TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_refund_terminal_amount_nonnegative
    CHECK (amount >= 0),
  CONSTRAINT financial_refund_terminal_currency_present
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT financial_refund_terminal_status_valid
    CHECK (terminal_status IN ('refunded','retained'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_allocation_idempotency_key
  ON settlement_allocation_snapshots (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_allocation_reservation_session_version
  ON settlement_allocation_snapshots (reservation_id, payment_session_id, settlement_version);

CREATE INDEX IF NOT EXISTS idx_settlement_allocation_provider
  ON settlement_allocation_snapshots (payment_ownership_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_settlements_idempotency_key
  ON provider_settlements (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_provider_settlements_provider_status
  ON provider_settlements (provider_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_settlements_batch
  ON provider_settlements (settlement_batch_id, status)
  WHERE settlement_batch_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_ledger_entries_idempotency_key
  ON financial_ledger_entries (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_reservation
  ON financial_ledger_entries (reservation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_payment_session
  ON financial_ledger_entries (payment_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_event_type
  ON financial_ledger_entries (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_refund
  ON financial_ledger_entries (refund_id, created_at DESC)
  WHERE refund_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_refund_terminal_idempotency_key
  ON financial_refund_terminal_records (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_refund_terminal_once
  ON financial_refund_terminal_records (reservation_id, refund_type)
  WHERE terminal_status IN ('refunded','retained');

CREATE INDEX IF NOT EXISTS idx_financial_refund_terminal_refund
  ON financial_refund_terminal_records (refund_id)
  WHERE refund_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_financial_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial ledger and settlement snapshot rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_allocation_immutable ON settlement_allocation_snapshots;
CREATE TRIGGER trg_settlement_allocation_immutable
  BEFORE UPDATE OR DELETE ON settlement_allocation_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION prevent_financial_ledger_mutation();

DROP TRIGGER IF EXISTS trg_financial_ledger_entries_immutable ON financial_ledger_entries;
CREATE TRIGGER trg_financial_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON financial_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION prevent_financial_ledger_mutation();

DROP TRIGGER IF EXISTS trg_financial_refund_terminal_immutable ON financial_refund_terminal_records;
CREATE TRIGGER trg_financial_refund_terminal_immutable
  BEFORE UPDATE OR DELETE ON financial_refund_terminal_records
  FOR EACH ROW
  EXECUTE FUNCTION prevent_financial_ledger_mutation();
