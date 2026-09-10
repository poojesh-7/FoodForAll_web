ALTER TABLE provider_settlements
  DROP CONSTRAINT IF EXISTS provider_settlements_paid_amount_valid;

ALTER TABLE provider_settlements
  DROP COLUMN IF EXISTS paid_amount;