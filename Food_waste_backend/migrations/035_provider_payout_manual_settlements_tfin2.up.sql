CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS provider_payout_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_type TEXT NOT NULL,
  upi_id TEXT NULL,
  account_holder_name TEXT NULL,
  bank_account_number TEXT NULL,
  ifsc_code TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMP NULL,
  verified_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  rejection_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_payout_accounts_type_valid
    CHECK (account_type IN ('UPI','BANK')),
  CONSTRAINT provider_payout_accounts_verification_status_valid
    CHECK (verification_status IN ('pending','verified','rejected')),
  CONSTRAINT provider_payout_accounts_upi_shape
    CHECK (
      account_type <> 'UPI'
      OR (
        upi_id IS NOT NULL
        AND upi_id ~* '^[A-Z0-9._-]{2,}@[A-Z0-9._-]{2,}$'
      )
    ),
  CONSTRAINT provider_payout_accounts_bank_shape
    CHECK (
      account_type <> 'BANK'
      OR (
        account_holder_name IS NOT NULL
        AND length(trim(account_holder_name)) >= 2
        AND bank_account_number IS NOT NULL
        AND bank_account_number ~ '^[0-9]{6,20}$'
        AND ifsc_code IS NOT NULL
        AND ifsc_code ~* '^[A-Z]{4}0[A-Z0-9]{6}$'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_payout_accounts_one_active
  ON provider_payout_accounts (provider_id)
  WHERE is_active=true;

CREATE INDEX IF NOT EXISTS idx_provider_payout_accounts_provider_created
  ON provider_payout_accounts (provider_id, created_at DESC);

ALTER TABLE provider_settlements
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS processed_by UUID NULL REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE provider_settlements
  DROP CONSTRAINT IF EXISTS provider_settlements_status_valid,
  ADD CONSTRAINT provider_settlements_status_valid
    CHECK (status IN ('allocated','batched','settled','pending','processing','paid','failed','cancelled'));

UPDATE provider_settlements
SET status = CASE
  WHEN status IN ('allocated','batched') THEN 'pending'
  WHEN status='settled' THEN 'paid'
  ELSE status
END
WHERE status IN ('allocated','batched','settled');

ALTER TABLE provider_settlements
  ALTER COLUMN status SET DEFAULT 'pending',
  DROP CONSTRAINT IF EXISTS provider_settlements_status_valid,
  ADD CONSTRAINT provider_settlements_status_valid
    CHECK (status IN ('pending','processing','paid','failed','cancelled'));

CREATE INDEX IF NOT EXISTS idx_provider_settlements_status_created_tfin2
  ON provider_settlements (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_settlements_provider_status_tfin2
  ON provider_settlements (provider_id, status, created_at DESC);
