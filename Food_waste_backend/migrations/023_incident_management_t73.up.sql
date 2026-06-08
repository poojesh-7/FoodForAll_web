CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS incident_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  initial_status TEXT NOT NULL DEFAULT 'OPEN',
  created_by_admin_id UUID NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_ref_id TEXT NULL,
  source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT incident_records_title_present CHECK (length(trim(title)) > 0),
  CONSTRAINT incident_records_severity_valid CHECK (
    severity IN ('SEV1','SEV2','SEV3','SEV4')
  ),
  CONSTRAINT incident_records_category_valid CHECK (
    category IN (
      'INFRASTRUCTURE',
      'PAYMENTS',
      'TRUST',
      'GOVERNANCE',
      'NOTIFICATIONS',
      'REALTIME',
      'DATABASE',
      'SECURITY',
      'COMPLIANCE',
      'OTHER'
    )
  ),
  CONSTRAINT incident_records_initial_status_valid CHECK (initial_status = 'OPEN'),
  CONSTRAINT incident_records_source_type_valid CHECK (
    source_type IN (
      'manual',
      'operational_monitoring',
      'operational_alert',
      'queue_diagnostic',
      'trust_diagnostic',
      'financial_diagnostic'
    )
  )
);

CREATE TABLE IF NOT EXISTS incident_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incident_records(id) ON DELETE RESTRICT,
  admin_user_id UUID NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT incident_notes_note_present CHECK (length(trim(note)) > 0)
);

CREATE TABLE IF NOT EXISTS incident_postmortems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incident_records(id) ON DELETE RESTRICT,
  admin_user_id UUID NOT NULL REFERENCES users(id),
  root_cause TEXT NOT NULL,
  impact_summary TEXT NOT NULL,
  detection_method TEXT NOT NULL,
  resolution_summary TEXT NOT NULL,
  follow_up_actions TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT incident_postmortems_unique_incident UNIQUE (incident_id),
  CONSTRAINT incident_postmortems_root_cause_present CHECK (length(trim(root_cause)) > 0),
  CONSTRAINT incident_postmortems_impact_present CHECK (length(trim(impact_summary)) > 0),
  CONSTRAINT incident_postmortems_detection_present CHECK (length(trim(detection_method)) > 0),
  CONSTRAINT incident_postmortems_resolution_present CHECK (length(trim(resolution_summary)) > 0),
  CONSTRAINT incident_postmortems_followups_present CHECK (length(trim(follow_up_actions)) > 0)
);

CREATE TABLE IF NOT EXISTS incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incident_records(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  from_status TEXT NULL,
  to_status TEXT NULL,
  from_assigned_admin_id UUID NULL REFERENCES users(id),
  to_assigned_admin_id UUID NULL REFERENCES users(id),
  note_id UUID NULL REFERENCES incident_notes(id) ON DELETE RESTRICT,
  postmortem_id UUID NULL REFERENCES incident_postmortems(id) ON DELETE RESTRICT,
  details TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT incident_events_type_valid CHECK (
    event_type IN (
      'INCIDENT_CREATED',
      'INCIDENT_ASSIGNED',
      'INCIDENT_STATUS_CHANGED',
      'INCIDENT_RESOLVED',
      'INCIDENT_CLOSED',
      'INCIDENT_NOTE_ADDED',
      'INCIDENT_POSTMORTEM_ADDED'
    )
  ),
  CONSTRAINT incident_events_from_status_valid CHECK (
    from_status IS NULL OR from_status IN (
      'OPEN',
      'INVESTIGATING',
      'IDENTIFIED',
      'MITIGATING',
      'RESOLVED',
      'CLOSED'
    )
  ),
  CONSTRAINT incident_events_to_status_valid CHECK (
    to_status IS NULL OR to_status IN (
      'OPEN',
      'INVESTIGATING',
      'IDENTIFIED',
      'MITIGATING',
      'RESOLVED',
      'CLOSED'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_incident_records_created
  ON incident_records (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_incident_records_severity_category
  ON incident_records (severity, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_records_source_ref
  ON incident_records (source_type, source_ref_id)
  WHERE source_ref_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incident_records_created_by
  ON incident_records (created_by_admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_events_incident_created
  ON incident_events (incident_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_incident_events_timeline
  ON incident_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_incident_events_status
  ON incident_events (incident_id, created_at DESC, id DESC)
  WHERE to_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incident_events_assignment
  ON incident_events (incident_id, created_at DESC, id DESC)
  WHERE event_type IN ('INCIDENT_CREATED','INCIDENT_ASSIGNED');

CREATE INDEX IF NOT EXISTS idx_incident_events_actor_created
  ON incident_events (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_notes_incident_created
  ON incident_notes (incident_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_incident_postmortems_incident
  ON incident_postmortems (incident_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_incident_management_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'incident management rows are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_incident_records_immutable ON incident_records;
CREATE TRIGGER trg_incident_records_immutable
  BEFORE UPDATE OR DELETE ON incident_records
  FOR EACH ROW
  EXECUTE FUNCTION prevent_incident_management_mutation();

DROP TRIGGER IF EXISTS trg_incident_events_immutable ON incident_events;
CREATE TRIGGER trg_incident_events_immutable
  BEFORE UPDATE OR DELETE ON incident_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_incident_management_mutation();

DROP TRIGGER IF EXISTS trg_incident_notes_immutable ON incident_notes;
CREATE TRIGGER trg_incident_notes_immutable
  BEFORE UPDATE OR DELETE ON incident_notes
  FOR EACH ROW
  EXECUTE FUNCTION prevent_incident_management_mutation();

DROP TRIGGER IF EXISTS trg_incident_postmortems_immutable ON incident_postmortems;
CREATE TRIGGER trg_incident_postmortems_immutable
  BEFORE UPDATE OR DELETE ON incident_postmortems
  FOR EACH ROW
  EXECUTE FUNCTION prevent_incident_management_mutation();
