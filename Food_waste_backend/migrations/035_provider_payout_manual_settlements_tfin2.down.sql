DROP INDEX IF EXISTS idx_provider_settlements_provider_status_tfin2;
DROP INDEX IF EXISTS idx_provider_settlements_status_created_tfin2;

ALTER TABLE provider_settlements
  DROP CONSTRAINT IF EXISTS provider_settlements_status_valid,
  ADD CONSTRAINT provider_settlements_status_valid
    CHECK (status IN ('allocated','batched','settled','pending','processing','paid','failed','cancelled'));

UPDATE provider_settlements
SET status = CASE
  WHEN status IN ('pending','processing','failed') THEN 'allocated'
  WHEN status='paid' THEN 'settled'
  ELSE status
END
WHERE status IN ('pending','processing','paid','failed');

ALTER TABLE provider_settlements
  ALTER COLUMN status SET DEFAULT 'allocated',
  DROP CONSTRAINT IF EXISTS provider_settlements_status_valid,
  ADD CONSTRAINT provider_settlements_status_valid
    CHECK (status IN ('allocated','batched','settled','cancelled'));

ALTER TABLE provider_settlements
  DROP COLUMN IF EXISTS processed_by,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS payment_reference,
  DROP COLUMN IF EXISTS paid_at;

DROP INDEX IF EXISTS idx_provider_payout_accounts_provider_created;
DROP INDEX IF EXISTS idx_provider_payout_accounts_one_active;
DROP TABLE IF EXISTS provider_payout_accounts;
