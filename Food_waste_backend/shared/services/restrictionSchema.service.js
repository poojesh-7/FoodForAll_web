const pool = require("../config/db");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");

let schemaReady;

function ensureRestrictionSchema(client = pool) {
  if (shouldSkipRuntimeSchemaMutation()) {
    schemaReady = schemaReady || Promise.resolve();
    return schemaReady;
  }

  if (!schemaReady || client !== pool) {
    const run = async () => {
      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS reliability_deposit_amount NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS requires_reliability_deposit BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS last_penalty_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS successful_pickups_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS restriction_level INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS restriction_reason TEXT NULL,
        ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS trust_score NUMERIC DEFAULT 100,
        ADD COLUMN IF NOT EXISTS restriction_type TEXT NULL,
        ADD COLUMN IF NOT EXISTS total_successful_pickups INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_failed_pickups INTEGER DEFAULT 0
      `);

      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS provider_reports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reported_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
          reason TEXT NOT NULL,
          description TEXT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMP NULL,
          reviewed_by_admin UUID REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      await client.query(`
        ALTER TABLE provider_reports
        ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES users(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS reported_by UUID REFERENCES users(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS reason TEXT,
        ADD COLUMN IF NOT EXISTS description TEXT NULL,
        ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS reviewed_by_admin UUID REFERENCES users(id) ON DELETE SET NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_provider_reports_provider_status
        ON provider_reports (provider_id, status, created_at DESC)
      `);

      await client.query(`
        WITH ranked_reports AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY provider_id, reported_by, reservation_id
                   ORDER BY created_at ASC, id ASC
                 ) AS row_number
          FROM provider_reports
          WHERE status='pending'
          AND reservation_id IS NOT NULL
        )
        UPDATE provider_reports pr
        SET status='dismissed',
            resolved_at=COALESCE(pr.resolved_at, NOW()),
            description=LEFT(
              CONCAT_WS(E'\n', pr.description, 'Duplicate pending report closed during schema normalization.'),
              1000
            )
        FROM ranked_reports ranked
        WHERE pr.id=ranked.id
        AND ranked.row_number > 1
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_reports_unique_pending
        ON provider_reports (provider_id, reported_by, reservation_id)
        WHERE status='pending' AND reservation_id IS NOT NULL
      `);

      await client.query(`
        ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS food_amount NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reliability_deposit_amount NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reliability_deposit_status TEXT DEFAULT 'not_required',
        ADD COLUMN IF NOT EXISTS reliability_deposit_refund_id TEXT NULL,
        ADD COLUMN IF NOT EXISTS reliability_deposit_refunded_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS reliability_deposit_retained_at TIMESTAMP NULL
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

module.exports = { ensureRestrictionSchema };
