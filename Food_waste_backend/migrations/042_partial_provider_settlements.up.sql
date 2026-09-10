ALTER TABLE provider_settlements
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE provider_settlements
  DROP CONSTRAINT IF EXISTS provider_settlements_paid_amount_valid,
  ADD CONSTRAINT provider_settlements_paid_amount_valid
    CHECK (paid_amount >= 0 AND paid_amount <= amount);