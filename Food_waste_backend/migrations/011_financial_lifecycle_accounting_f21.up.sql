ALTER TABLE financial_operations
  ADD COLUMN IF NOT EXISTS operation_source TEXT DEFAULT 'unspecified';

CREATE INDEX IF NOT EXISTS idx_financial_operations_operation_source
  ON financial_operations (operation_source, created_at DESC);
