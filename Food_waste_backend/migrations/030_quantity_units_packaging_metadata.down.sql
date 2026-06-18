ALTER TABLE food_listings
  DROP CONSTRAINT IF EXISTS food_listings_custom_quantity_unit_valid,
  DROP CONSTRAINT IF EXISTS food_listings_quantity_unit_valid,
  DROP COLUMN IF EXISTS custom_quantity_unit,
  DROP COLUMN IF EXISTS quantity_unit;
