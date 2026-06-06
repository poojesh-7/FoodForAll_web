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
);

ALTER TABLE provider_reports
  ADD COLUMN IF NOT EXISTS moderation_case_id UUID REFERENCES moderation_cases(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_cases_source_report
  ON moderation_cases (source_report_id)
  WHERE source_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_moderation_cases_subject_status
  ON moderation_cases (subject_type, subject_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_status_created
  ON moderation_cases (status, created_at DESC);

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
);

CREATE INDEX IF NOT EXISTS idx_moderation_case_events_case_created
  ON moderation_case_events (case_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_moderation_case_events_actor_created
  ON moderation_case_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

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
AND report_link.moderation_case_id IS NULL;

UPDATE provider_reports report_link
SET moderation_case_id = existing_case.id
FROM moderation_cases existing_case
WHERE existing_case.source_report_id = report_link.id
AND report_link.moderation_case_id IS NULL;

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
    'source', 'migration_t61',
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
);

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
    'source', 'migration_t61',
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
);
