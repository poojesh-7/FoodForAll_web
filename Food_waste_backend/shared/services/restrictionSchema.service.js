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
        CREATE TABLE IF NOT EXISTS provider_report_attachments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          report_id UUID NOT NULL REFERENCES provider_reports(id) ON DELETE CASCADE,
          uploader_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          file_url TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_provider_report_attachments_report
        ON provider_report_attachments (report_id, created_at ASC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_provider_report_attachments_uploader_created
        ON provider_report_attachments (uploader_user_id, created_at DESC)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS moderation_cases (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          case_type TEXT NOT NULL DEFAULT 'provider_report',
          subject_type TEXT NOT NULL DEFAULT 'provider',
          subject_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'OPEN',
          opened_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          assigned_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
          source_report_id UUID REFERENCES provider_reports(id) ON DELETE SET NULL,
          reason TEXT NULL,
          summary TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMP NULL,
          CONSTRAINT moderation_cases_status_check CHECK (
            status IN (
              'OPEN',
              'UNDER_REVIEW',
              'AWAITING_RESPONSE',
              'VALIDATED',
              'DISMISSED',
              'ESCALATED'
            )
          )
        )
      `);

      await client.query(`
        ALTER TABLE provider_reports
        ADD COLUMN IF NOT EXISTS moderation_case_id UUID REFERENCES moderation_cases(id) ON DELETE SET NULL
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_cases_source_report
        ON moderation_cases (source_report_id)
        WHERE source_report_id IS NOT NULL
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_moderation_cases_subject_status
        ON moderation_cases (subject_type, subject_id, status, created_at DESC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_moderation_cases_status_created
        ON moderation_cases (status, created_at DESC)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS moderation_case_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          case_id UUID NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
          actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          event_type TEXT NOT NULL,
          from_status TEXT NULL,
          to_status TEXT NULL,
          note TEXT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_moderation_case_events_case_created
        ON moderation_case_events (case_id, created_at ASC)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_moderation_case_events_actor_created
        ON moderation_case_events (actor_user_id, created_at DESC)
        WHERE actor_user_id IS NOT NULL
      `);

      await client.query(`
        WITH inserted_cases AS (
          INSERT INTO moderation_cases (
            case_type,
            subject_type,
            subject_id,
            status,
            opened_by_user_id,
            assigned_admin_id,
            source_report_id,
            reason,
            summary,
            created_at,
            updated_at,
            closed_at
          )
          SELECT
            'provider_report',
            'provider',
            report_seed.provider_id,
            CASE
              WHEN report_seed.status = 'validated' THEN 'VALIDATED'
              WHEN report_seed.status = 'dismissed' THEN 'DISMISSED'
              ELSE 'OPEN'
            END,
            report_seed.reported_by,
            report_seed.reviewed_by_admin,
            report_seed.id,
            report_seed.reason,
            report_seed.description,
            COALESCE(report_seed.created_at, NOW()),
            COALESCE(report_seed.resolved_at, report_seed.created_at, NOW()),
            CASE
              WHEN report_seed.status IN ('validated', 'dismissed')
                THEN COALESCE(report_seed.resolved_at, report_seed.created_at, NOW())
              ELSE NULL
            END
          FROM provider_reports report_seed
          WHERE NOT EXISTS (
            SELECT 1
            FROM moderation_cases existing_case
            WHERE existing_case.source_report_id = report_seed.id
          )
          RETURNING id, source_report_id
        )
        UPDATE provider_reports report_link
        SET moderation_case_id = inserted_cases.id
        FROM inserted_cases
        WHERE report_link.id = inserted_cases.source_report_id
        AND report_link.moderation_case_id IS NULL
      `);

      await client.query(`
        UPDATE provider_reports report_link
        SET moderation_case_id = existing_case.id
        FROM moderation_cases existing_case
        WHERE existing_case.source_report_id = report_link.id
        AND report_link.moderation_case_id IS NULL
      `);

      await client.query(`
        INSERT INTO moderation_case_events (
          case_id,
          actor_user_id,
          event_type,
          from_status,
          to_status,
          note,
          metadata,
          created_at
        )
        SELECT
          moderation_cases.id,
          moderation_cases.opened_by_user_id,
          'CASE_OPENED',
          NULL,
          'OPEN',
          NULL,
          jsonb_build_object(
            'source', 'runtime_schema',
            'source_report_id', moderation_cases.source_report_id
          ),
          moderation_cases.created_at
        FROM moderation_cases
        WHERE moderation_cases.case_type = 'provider_report'
        AND NOT EXISTS (
          SELECT 1
          FROM moderation_case_events existing_event
          WHERE existing_event.case_id = moderation_cases.id
          AND existing_event.event_type = 'CASE_OPENED'
        )
      `);

      await client.query(`
        INSERT INTO moderation_case_events (
          case_id,
          actor_user_id,
          event_type,
          from_status,
          to_status,
          note,
          metadata,
          created_at
        )
        SELECT
          moderation_cases.id,
          moderation_cases.assigned_admin_id,
          'CASE_STATUS_CHANGED',
          'OPEN',
          moderation_cases.status,
          NULL,
          jsonb_build_object(
            'source', 'runtime_schema',
            'source_report_id', moderation_cases.source_report_id
          ),
          COALESCE(moderation_cases.closed_at, moderation_cases.updated_at)
        FROM moderation_cases
        WHERE moderation_cases.case_type = 'provider_report'
        AND moderation_cases.status IN ('VALIDATED', 'DISMISSED')
        AND NOT EXISTS (
          SELECT 1
          FROM moderation_case_events existing_event
          WHERE existing_event.case_id = moderation_cases.id
          AND existing_event.event_type = 'CASE_STATUS_CHANGED'
          AND existing_event.to_status = moderation_cases.status
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS provider_case_responses (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          case_id UUID NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
          provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          response_text TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_case_responses_case_provider
        ON provider_case_responses (case_id, provider_id)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_provider_case_responses_provider_updated
        ON provider_case_responses (provider_id, updated_at DESC)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS provider_case_response_attachments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          response_id UUID NOT NULL REFERENCES provider_case_responses(id) ON DELETE CASCADE,
          file_url TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_provider_case_response_attachments_response
        ON provider_case_response_attachments (response_id, created_at ASC)
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
