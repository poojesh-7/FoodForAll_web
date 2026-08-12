ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS food_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS processing_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE settlement_allocation_snapshots
  ADD COLUMN IF NOT EXISTS processing_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_processing_fee_nonnegative,
  ADD CONSTRAINT reservations_processing_fee_nonnegative CHECK (processing_fee >= 0),
  DROP CONSTRAINT IF EXISTS reservations_food_price_nonnegative,
  ADD CONSTRAINT reservations_food_price_nonnegative CHECK (food_price >= 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_processing_fee_nonnegative,
  ADD CONSTRAINT payments_processing_fee_nonnegative CHECK (processing_fee >= 0);

ALTER TABLE settlement_allocation_snapshots
  DROP CONSTRAINT IF EXISTS settlement_processing_fee_nonnegative,
  ADD CONSTRAINT settlement_processing_fee_nonnegative CHECK (processing_fee_amount >= 0);
