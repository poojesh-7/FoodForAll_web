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
