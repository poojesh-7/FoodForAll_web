-- Rollback: Settlement Manual Carry Forward (TFIN3)
-- Removes carry forward tracking functionality

-- Drop view first (depends on table)
DROP VIEW IF EXISTS pending_refunds_awaiting_carry_forward;

-- Drop indexes
DROP INDEX IF EXISTS idx_provider_settlements_pending_carry_forward;
DROP INDEX IF EXISTS idx_provider_settlements_applied_carry_forward;

-- Drop constraints
ALTER TABLE provider_settlements DROP CONSTRAINT IF EXISTS provider_settlements_carry_forward_amount_nonnegative;
ALTER TABLE provider_settlements DROP CONSTRAINT IF EXISTS provider_settlements_carry_forward_timestamp_consistency;

-- Remove columns
ALTER TABLE provider_settlements DROP COLUMN IF EXISTS manual_carry_forward_notes;
ALTER TABLE provider_settlements DROP COLUMN IF EXISTS manual_carry_forward_applied_by;
ALTER TABLE provider_settlements DROP COLUMN IF EXISTS manual_carry_forward_applied_at;
ALTER TABLE provider_settlements DROP COLUMN IF EXISTS manual_carry_forward_amount;
