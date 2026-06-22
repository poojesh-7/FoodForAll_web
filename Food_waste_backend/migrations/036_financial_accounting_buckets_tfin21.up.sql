ALTER TABLE financial_ledger_entries
  ADD COLUMN IF NOT EXISTS accounting_category TEXT NULL;

ALTER TABLE financial_ledger_entries
  DROP CONSTRAINT IF EXISTS financial_ledger_entries_accounting_category_valid,
  ADD CONSTRAINT financial_ledger_entries_accounting_category_valid
    CHECK (
      accounting_category IS NULL
      OR accounting_category IN (
        'platform_commission_revenue',
        'gateway_fee_expense',
        'reliability_deposit_held',
        'reliability_deposit_refunded',
        'reliability_deposit_retained',
        'provider_settlement_liability',
        'provider_settlement_paid',
        'refund_expense'
      )
    );

ALTER TABLE financial_ledger_entries
  DROP CONSTRAINT IF EXISTS financial_ledger_entries_event_type_valid,
  ADD CONSTRAINT financial_ledger_entries_event_type_valid
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
      'settlement_allocated',
      'provider_settlement_paid',
      'gateway_fee_recorded'
    ));

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_accounting_category
  ON financial_ledger_entries (accounting_category, created_at DESC)
  WHERE accounting_category IS NOT NULL;

CREATE TABLE IF NOT EXISTS financial_accounting_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_ledger_entry_id UUID NOT NULL REFERENCES financial_ledger_entries(id) ON DELETE RESTRICT,
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  payment_id UUID NULL REFERENCES payments(id) ON DELETE RESTRICT,
  payment_session_id TEXT NOT NULL,
  provider_settlement_id UUID NULL REFERENCES provider_settlements(id) ON DELETE RESTRICT,
  accounting_category TEXT NOT NULL,
  source_event_type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  refund_id TEXT NULL,
  source_type TEXT NOT NULL DEFAULT 'financial_ledger_entry',
  source_id TEXT NULL,
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT financial_accounting_classifications_category_valid
    CHECK (accounting_category IN (
      'platform_commission_revenue',
      'gateway_fee_expense',
      'reliability_deposit_held',
      'reliability_deposit_refunded',
      'reliability_deposit_retained',
      'provider_settlement_liability',
      'provider_settlement_paid',
      'refund_expense'
    )),
  CONSTRAINT financial_accounting_classifications_amount_nonnegative
    CHECK (amount >= 0),
  CONSTRAINT financial_accounting_classifications_currency_present
    CHECK (length(trim(currency)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_accounting_classifications_idempotency
  ON financial_accounting_classifications (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_accounting_classifications_ledger_category
  ON financial_accounting_classifications (financial_ledger_entry_id, accounting_category);

CREATE INDEX IF NOT EXISTS idx_financial_accounting_classifications_category
  ON financial_accounting_classifications (accounting_category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_accounting_classifications_reservation
  ON financial_accounting_classifications (reservation_id, payment_session_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_financial_accounting_classifications_immutable ON financial_accounting_classifications;
CREATE TRIGGER trg_financial_accounting_classifications_immutable
  BEFORE UPDATE OR DELETE ON financial_accounting_classifications
  FOR EACH ROW
  EXECUTE FUNCTION prevent_financial_ledger_mutation();

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS gateway_provider TEXT NULL,
  ADD COLUMN IF NOT EXISTS gateway_order_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS gateway_fee_amount NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS gateway_tax_amount NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS gateway_fee_recorded_at TIMESTAMP NULL;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_gateway_fee_amounts_nonnegative,
  ADD CONSTRAINT payments_gateway_fee_amounts_nonnegative
    CHECK (
      (gateway_fee_amount IS NULL OR gateway_fee_amount >= 0)
      AND (gateway_tax_amount IS NULL OR gateway_tax_amount >= 0)
    );

CREATE INDEX IF NOT EXISTS idx_payments_gateway_fee_recorded
  ON payments (gateway_provider, gateway_fee_recorded_at DESC, id)
  WHERE gateway_fee_recorded_at IS NOT NULL
     OR gateway_fee_amount IS NOT NULL
     OR gateway_tax_amount IS NOT NULL;
