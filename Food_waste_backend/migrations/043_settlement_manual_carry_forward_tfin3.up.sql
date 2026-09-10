-- Migration: Settlement Manual Carry Forward (TFIN3)
-- Purpose: Add columns to track manual carry forward operations for refund liability management
-- This enables admin-driven carry forward instead of automatic deductions

ALTER TABLE provider_settlements ADD COLUMN IF NOT EXISTS manual_carry_forward_amount NUMERIC(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE provider_settlements ADD COLUMN IF NOT EXISTS manual_carry_forward_applied_at TIMESTAMP NULL;
ALTER TABLE provider_settlements ADD COLUMN IF NOT EXISTS manual_carry_forward_applied_by UUID NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE provider_settlements ADD COLUMN IF NOT EXISTS manual_carry_forward_notes TEXT NULL;

-- Add constraints to ensure valid data
ALTER TABLE provider_settlements ADD CONSTRAINT provider_settlements_carry_forward_amount_nonnegative
  CHECK (manual_carry_forward_amount >= 0) NOT DEFERRABLE;

ALTER TABLE provider_settlements ADD CONSTRAINT provider_settlements_carry_forward_timestamp_consistency
  CHECK (
    (manual_carry_forward_applied_at IS NULL AND manual_carry_forward_amount = 0) OR
    (manual_carry_forward_applied_at IS NOT NULL AND manual_carry_forward_amount > 0)
  ) NOT DEFERRABLE;

-- Create index for efficient queries on records with pending carry forward
CREATE INDEX IF NOT EXISTS idx_provider_settlements_pending_carry_forward
ON provider_settlements(provider_id, id)
WHERE manual_carry_forward_applied_at IS NULL AND status IN ('pending', 'processing');

-- Create index for efficient queries on applied carry forwards
CREATE INDEX IF NOT EXISTS idx_provider_settlements_applied_carry_forward
ON provider_settlements(provider_id, manual_carry_forward_applied_at)
WHERE manual_carry_forward_applied_at IS NOT NULL;

-- Add new event type for carry forward operations in financial ledger
-- This is documented for reference; the actual event type check is in the application
COMMENT ON COLUMN financial_ledger_entries.event_type IS 'Types: payment_initiated, payment_succeeded, payment_failed, refund_requested, refund_issued, refund_failed, deposit_held, deposit_released, deposit_refunded, commission_calculated, carry_forward_manual_applied';

-- Create view for admin dashboard to see pending refunds awaiting carry forward
CREATE OR REPLACE VIEW pending_refunds_awaiting_carry_forward AS
SELECT
  ps.id AS settlement_id,
  ps.provider_id,
  ps.reservation_id,
  ps.amount,
  LEAST(ps.amount, COALESCE(refund.refund_amount, 0))::numeric AS refund_amount,
  ps.status,
  ps.created_at,
  ps.updated_at,
  u.phone AS provider_phone,
  restaurants.restaurant_name,
  (LEAST(ps.amount, COALESCE(refund.refund_amount, 0)) - COALESCE(ps.manual_carry_forward_amount, 0)) AS remaining_to_carry_forward
FROM provider_settlements ps
JOIN users u ON ps.provider_id = u.id
LEFT JOIN restaurants ON u.id = restaurants.user_id
LEFT JOIN LATERAL (
  SELECT SUM(fle.amount) AS refund_amount
  FROM financial_ledger_entries fle
  WHERE fle.reservation_id = ps.reservation_id
    AND fle.payment_session_id = ps.payment_session_id
    AND fle.event_type = 'refund_issued'
) refund ON true
WHERE LEAST(ps.amount, COALESCE(refund.refund_amount, 0)) > 0
  AND (ps.manual_carry_forward_applied_at IS NULL OR ps.manual_carry_forward_amount < LEAST(ps.amount, COALESCE(refund.refund_amount, 0)))
  AND ps.status IN ('pending', 'processing', 'failed')
ORDER BY ps.created_at ASC, ps.id ASC;
