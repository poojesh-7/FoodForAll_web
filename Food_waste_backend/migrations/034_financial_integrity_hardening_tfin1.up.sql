ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(6,3) NULL,
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS provider_amount NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS food_amount_snapshot NUMERIC(12,2) NULL,
  ADD COLUMN IF NOT EXISTS platform_amount NUMERIC(12,2) NULL;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_financial_terms_nonnegative,
  ADD CONSTRAINT payments_financial_terms_nonnegative
    CHECK (
      (commission_percent IS NULL OR commission_percent >= 0)
      AND (commission_amount IS NULL OR commission_amount >= 0)
      AND (provider_amount IS NULL OR provider_amount >= 0)
      AND (food_amount_snapshot IS NULL OR food_amount_snapshot >= 0)
      AND (platform_amount IS NULL OR platform_amount >= 0)
    );

CREATE INDEX IF NOT EXISTS idx_payments_paid_financial_reconciliation
  ON payments (status, updated_at DESC, id)
  WHERE status='paid';

CREATE INDEX IF NOT EXISTS idx_payments_legacy_commission_snapshot
  ON payments (status, created_at DESC, id)
  WHERE status='paid' AND commission_percent IS NULL;
