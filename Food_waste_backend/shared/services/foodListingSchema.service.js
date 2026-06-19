const pool = require("../config/db");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");

let schemaReady;

function ensureFoodListingSoftDeleteSchema(client = pool) {
  if (shouldSkipRuntimeSchemaMutation()) {
    schemaReady = schemaReady || Promise.resolve();
    return schemaReady;
  }

  if (!schemaReady || client !== pool) {
    const run = async () => {
      await client.query(`
        ALTER TABLE food_listings
        ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false
      `);

      await client.query(`
        ALTER TABLE food_listings
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL
      `);

      await client.query(`
        ALTER TABLE food_listings
        ADD COLUMN IF NOT EXISTS quantity_unit TEXT NOT NULL DEFAULT 'Piece',
        ADD COLUMN IF NOT EXISTS custom_quantity_unit TEXT NULL
      `);

      await client.query(`
        ALTER TABLE food_listings
        ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other',
        ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
      `);

      await client.query(`
        UPDATE food_listings
        SET quantity_unit = 'Piece'
        WHERE quantity_unit IS NULL OR TRIM(quantity_unit) = ''
      `);

      await client.query(`
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
          )
      `);

      await client.query(`
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
          )
      `);

      await client.query(`
        ALTER TABLE food_listings
        DROP CONSTRAINT IF EXISTS food_listings_category_valid,
        ADD CONSTRAINT food_listings_category_valid
          CHECK (
            category IN (
              'meals',
              'bakery',
              'beverages',
              'fruits',
              'vegetables',
              'dairy',
              'snacks',
              'prepared_food',
              'grocery',
              'other'
            )
          )
      `);

      await client.query(`
        ALTER TABLE food_listings
        DROP CONSTRAINT IF EXISTS food_listings_dietary_tags_valid,
        ADD CONSTRAINT food_listings_dietary_tags_valid
          CHECK (
            dietary_tags <@ ARRAY[
              'vegetarian',
              'vegan',
              'egg',
              'non_veg',
              'halal',
              'jain',
              'gluten_free'
            ]::TEXT[]
          )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_food_listings_visibility
        ON food_listings (status, is_deleted, pickup_end_time)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_food_listings_category
        ON food_listings (category)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_food_listings_dietary_tags
        ON food_listings USING GIN (dietary_tags)
      `);
    };

    if (client === pool) {
      schemaReady = run();
      return schemaReady;
    }

    return run();
  }

  return schemaReady;
}

module.exports = {
  ensureFoodListingSoftDeleteSchema,
};
