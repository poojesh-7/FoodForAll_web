ALTER TABLE settlement_allocation_snapshots
  DROP CONSTRAINT IF EXISTS settlement_processing_fee_nonnegative,
  DROP COLUMN IF EXISTS processing_fee_amount;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_processing_fee_nonnegative,
  DROP COLUMN IF EXISTS processing_fee;

ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_processing_fee_nonnegative,
  DROP CONSTRAINT IF EXISTS reservations_food_price_nonnegative,
  DROP COLUMN IF EXISTS food_price,
  DROP COLUMN IF EXISTS processing_fee,
  DROP COLUMN IF EXISTS total_paid;
