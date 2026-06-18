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
        CREATE INDEX IF NOT EXISTS idx_food_listings_visibility
        ON food_listings (status, is_deleted, pickup_end_time)
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
