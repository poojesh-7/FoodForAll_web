DROP TRIGGER IF EXISTS trg_financial_refund_terminal_immutable ON financial_refund_terminal_records;
DROP TRIGGER IF EXISTS trg_financial_ledger_entries_immutable ON financial_ledger_entries;
DROP TRIGGER IF EXISTS trg_settlement_allocation_immutable ON settlement_allocation_snapshots;

DROP FUNCTION IF EXISTS prevent_financial_ledger_mutation();

DROP TABLE IF EXISTS financial_refund_terminal_records;
DROP TABLE IF EXISTS financial_ledger_entries;
DROP TABLE IF EXISTS provider_settlements;
DROP TABLE IF EXISTS settlement_allocation_snapshots;
DROP TABLE IF EXISTS settlement_batches;
