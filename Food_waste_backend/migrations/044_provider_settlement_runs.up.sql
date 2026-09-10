CREATE TABLE IF NOT EXISTS provider_settlement_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  settlement_year INTEGER NOT NULL,
  settlement_month INTEGER NOT NULL,
  settled_at TIMESTAMP NOT NULL DEFAULT NOW(),
  settled_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_amount_before NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_amount_after NUMERIC(12,2) NOT NULL DEFAULT 0,
  carry_forward_reduced_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_reference TEXT NULL,
  notes TEXT NULL,
  status TEXT NOT NULL DEFAULT 'settled',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_settlement_runs_month_valid
    CHECK (settlement_month BETWEEN 1 AND 12),
  CONSTRAINT provider_settlement_runs_amounts_nonnegative
    CHECK (
      paid_amount >= 0
      AND pending_amount_before >= 0
      AND pending_amount_after >= 0
      AND carry_forward_reduced_amount >= 0
    ),
  CONSTRAINT provider_settlement_runs_status_valid
    CHECK (status = 'settled')
);

CREATE INDEX IF NOT EXISTS idx_provider_settlement_runs_provider_month
  ON provider_settlement_runs (provider_id, settlement_year, settlement_month, settled_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_settlement_runs_status
  ON provider_settlement_runs (provider_id, status, settled_at DESC);