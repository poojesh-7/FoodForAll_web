DROP INDEX IF EXISTS idx_payments_gateway_fee_recorded;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_gateway_fee_amounts_nonnegative,
  DROP COLUMN IF EXISTS gateway_fee_recorded_at,
  DROP COLUMN IF EXISTS gateway_tax_amount,
  DROP COLUMN IF EXISTS gateway_fee_amount,
  DROP COLUMN IF EXISTS gateway_order_id,
  DROP COLUMN IF EXISTS gateway_provider;

DROP TRIGGER IF EXISTS trg_financial_accounting_classifications_immutable ON financial_accounting_classifications;
DROP INDEX IF EXISTS idx_financial_accounting_classifications_reservation;
DROP INDEX IF EXISTS idx_financial_accounting_classifications_category;
DROP INDEX IF EXISTS idx_financial_accounting_classifications_ledger_category;
DROP INDEX IF EXISTS idx_financial_accounting_classifications_idempotency;
DROP TABLE IF EXISTS financial_accounting_classifications;

DROP INDEX IF EXISTS idx_financial_ledger_entries_accounting_category;

ALTER TABLE financial_ledger_entries
  DROP CONSTRAINT IF EXISTS financial_ledger_entries_accounting_category_valid,
  DROP COLUMN IF EXISTS accounting_category;

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
      'settlement_allocated'
    ));
