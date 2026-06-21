DROP INDEX IF EXISTS idx_payments_legacy_commission_snapshot;
DROP INDEX IF EXISTS idx_payments_paid_financial_reconciliation;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_financial_terms_nonnegative,
  DROP COLUMN IF EXISTS platform_amount,
  DROP COLUMN IF EXISTS food_amount_snapshot,
  DROP COLUMN IF EXISTS provider_amount,
  DROP COLUMN IF EXISTS commission_amount,
  DROP COLUMN IF EXISTS commission_percent;
