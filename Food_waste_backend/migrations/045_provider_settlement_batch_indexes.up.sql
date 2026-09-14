CREATE INDEX IF NOT EXISTS idx_provider_settlements_provider_status_created_batch
  ON provider_settlements (provider_id, status, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_provider_settlements_provider_carry_forward
  ON provider_settlements (provider_id, manual_carry_forward_amount, created_at ASC, id ASC)
  WHERE manual_carry_forward_amount > 0;

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_reservation_session_event
  ON financial_ledger_entries (reservation_id, payment_session_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_provider_settlement_event
  ON financial_ledger_entries (provider_settlement_id, event_type, created_at DESC)
  WHERE provider_settlement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_refund_event
  ON financial_ledger_entries (refund_id, event_type, created_at DESC)
  WHERE refund_id IS NOT NULL;
