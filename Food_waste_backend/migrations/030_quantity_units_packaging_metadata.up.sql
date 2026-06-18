ALTER TABLE food_listings
  ADD COLUMN IF NOT EXISTS quantity_unit TEXT NOT NULL DEFAULT 'Piece',
  ADD COLUMN IF NOT EXISTS custom_quantity_unit TEXT NULL;

UPDATE food_listings
SET quantity_unit = 'Piece'
WHERE quantity_unit IS NULL OR TRIM(quantity_unit) = '';

ALTER TABLE food_listings
  DROP CONSTRAINT IF EXISTS food_listings_quantity_unit_valid,
  ADD CONSTRAINT food_listings_quantity_unit_valid
    CHECK (
      quantity_unit IN (
        'Meal Box',
        'Food Packet',
        'Plate',
        'Container',
        'Tray',
        'Loaf',
        'Bottle',
        'Liter',
        'Kilogram',
        'Piece',
        'Other'
      )
    );

ALTER TABLE food_listings
  DROP CONSTRAINT IF EXISTS food_listings_custom_quantity_unit_valid,
  ADD CONSTRAINT food_listings_custom_quantity_unit_valid
    CHECK (
      (
        quantity_unit = 'Other'
        AND custom_quantity_unit IS NOT NULL
        AND LENGTH(TRIM(custom_quantity_unit)) > 0
      )
      OR (
        quantity_unit <> 'Other'
        AND custom_quantity_unit IS NULL
      )
    );
