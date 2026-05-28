DROP INDEX IF EXISTS idx_financial_operations_operation_source;

ALTER TABLE financial_operations
  DROP COLUMN IF EXISTS operation_source;
