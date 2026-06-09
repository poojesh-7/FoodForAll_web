CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  retention_duration_days INTEGER NULL,
  archive_after_days INTEGER NULL,
  delete_after_days INTEGER NULL,
  deletion_eligible BOOLEAN NOT NULL DEFAULT false,
  deletion_mode TEXT NOT NULL DEFAULT 'never_delete',
  archive_mode TEXT NOT NULL DEFAULT 'none',
  legal_basis TEXT NOT NULL DEFAULT 'platform_integrity',
  immutable_source BOOLEAN NOT NULL DEFAULT false,
  searchable_when_archived BOOLEAN NOT NULL DEFAULT true,
  protects_financial_integrity BOOLEAN NOT NULL DEFAULT false,
  protects_trust_replay BOOLEAN NOT NULL DEFAULT false,
  protects_investigations BOOLEAN NOT NULL DEFAULT false,
  default_policy BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT retention_policies_key_present CHECK (length(trim(policy_key)) > 0),
  CONSTRAINT retention_policies_category_present CHECK (length(trim(category)) > 0),
  CONSTRAINT retention_policies_display_present CHECK (length(trim(display_name)) > 0),
  CONSTRAINT retention_policies_retention_positive CHECK (
    retention_duration_days IS NULL OR retention_duration_days > 0
  ),
  CONSTRAINT retention_policies_archive_positive CHECK (
    archive_after_days IS NULL OR archive_after_days > 0
  ),
  CONSTRAINT retention_policies_delete_positive CHECK (
    delete_after_days IS NULL OR delete_after_days > 0
  ),
  CONSTRAINT retention_policies_deletion_mode_valid CHECK (
    deletion_mode IN (
      'never_delete',
      'anonymize_only',
      'controlled_delete',
      'archive_then_controlled_delete'
    )
  ),
  CONSTRAINT retention_policies_archive_mode_valid CHECK (
    archive_mode IN (
      'none',
      'searchable_hot',
      'searchable_archive',
      'cloudinary_preserve',
      'summarize_then_archive'
    )
  )
);

INSERT INTO retention_policies (
  policy_key,
  category,
  display_name,
  description,
  retention_duration_days,
  archive_after_days,
  delete_after_days,
  deletion_eligible,
  deletion_mode,
  archive_mode,
  legal_basis,
  immutable_source,
  searchable_when_archived,
  protects_financial_integrity,
  protects_trust_replay,
  protects_investigations,
  metadata
)
VALUES
  (
    'audit_records',
    'audit',
    'Audit Records',
    'Audit Center source rows and compliance events remain searchable by default and are not automatically deleted.',
    NULL,
    NULL,
    NULL,
    false,
    'never_delete',
    'searchable_hot',
    'auditability',
    true,
    true,
    true,
    true,
    true,
    '{"sources":["operational_events","compliance_events","audit center source tables"]}'::jsonb
  ),
  (
    'financial_records',
    'financial',
    'Financial Records',
    'Ledger, settlement, reconciliation, gateway audit, and refund terminal records are retained for financial integrity.',
    NULL,
    NULL,
    NULL,
    false,
    'never_delete',
    'searchable_hot',
    'financial_reconciliation',
    true,
    true,
    true,
    false,
    true,
    '{"sources":["financial_ledger_entries","provider_settlements","settlement_allocation_snapshots","settlement_batches","cashfree_webhook_audit_log","payment_order_attempts","financial_refund_terminal_records"]}'::jsonb
  ),
  (
    'trust_replay_records',
    'trust',
    'Trust Replay Records',
    'Trust event streams, effects, scores, and restrictions are retained so trust reconstruction remains possible.',
    NULL,
    NULL,
    NULL,
    false,
    'never_delete',
    'searchable_hot',
    'trust_replay',
    true,
    true,
    false,
    true,
    true,
    '{"sources":["trust_events","trust_event_effects","trust_scores","trust_restrictions"]}'::jsonb
  ),
  (
    'governance_records',
    'governance',
    'Governance Records',
    'Moderation cases, provider reports, appeals, and lifecycle events are retained for governance review and investigations.',
    2555,
    1095,
    NULL,
    false,
    'never_delete',
    'searchable_archive',
    'governance_review',
    false,
    true,
    false,
    true,
    true,
    '{"sources":["provider_reports","moderation_cases","moderation_case_events","moderation_appeals","moderation_appeal_events"]}'::jsonb
  ),
  (
    'evidence_records',
    'evidence',
    'Evidence Assets',
    'Provider report and appeal evidence is retained through investigations and can be archived while Cloudinary references remain discoverable.',
    1095,
    365,
    NULL,
    true,
    'archive_then_controlled_delete',
    'cloudinary_preserve',
    'investigation_evidence',
    false,
    true,
    false,
    false,
    true,
    '{"sources":["provider_report_attachments","moderation_appeal_attachments"],"storage_provider":"cloudinary"}'::jsonb
  ),
  (
    'incident_records',
    'incidents',
    'Incident Records',
    'Incident records, events, notes, and postmortems are retained for operational investigations and post-incident learning.',
    2555,
    1095,
    NULL,
    false,
    'never_delete',
    'searchable_archive',
    'operational_investigation',
    true,
    true,
    false,
    false,
    true,
    '{"sources":["incident_records","incident_events","incident_notes","incident_postmortems"]}'::jsonb
  ),
  (
    'notifications',
    'notifications',
    'Notifications',
    'Notification rows may be archived after they age out of active product use; destructive cleanup requires an approved workflow.',
    365,
    180,
    730,
    true,
    'archive_then_controlled_delete',
    'searchable_archive',
    'user_communication',
    false,
    true,
    false,
    false,
    false,
    '{"sources":["notifications"],"cleanup_behavior":"archive_without_silent_delete"}'::jsonb
  ),
  (
    'privacy_requests',
    'privacy',
    'Privacy Requests',
    'Deletion, anonymization, and data access requests remain auditable after execution.',
    2555,
    NULL,
    NULL,
    false,
    'never_delete',
    'searchable_hot',
    'privacy_compliance',
    true,
    true,
    true,
    true,
    true,
    '{"sources":["data_deletion_requests","compliance_events"]}'::jsonb
  )
ON CONFLICT (policy_key) DO UPDATE SET
  category = EXCLUDED.category,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  retention_duration_days = EXCLUDED.retention_duration_days,
  archive_after_days = EXCLUDED.archive_after_days,
  delete_after_days = EXCLUDED.delete_after_days,
  deletion_eligible = EXCLUDED.deletion_eligible,
  deletion_mode = EXCLUDED.deletion_mode,
  archive_mode = EXCLUDED.archive_mode,
  legal_basis = EXCLUDED.legal_basis,
  immutable_source = EXCLUDED.immutable_source,
  searchable_when_archived = EXCLUDED.searchable_when_archived,
  protects_financial_integrity = EXCLUDED.protects_financial_integrity,
  protects_trust_replay = EXCLUDED.protects_trust_replay,
  protects_investigations = EXCLUDED.protects_investigations,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  target_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  requested_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  reason TEXT NOT NULL,
  review_note TEXT NULL,
  decision_note TEXT NULL,
  execution_summary TEXT NULL,
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  policy_key TEXT NOT NULL REFERENCES retention_policies(policy_key),
  approval_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP NULL,
  approved_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP NULL,
  executed_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  executed_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT data_deletion_requests_type_valid CHECK (
    request_type IN (
      'account_deletion',
      'data_access',
      'anonymization',
      'evidence_deletion',
      'notification_cleanup'
    )
  ),
  CONSTRAINT data_deletion_requests_subject_type_valid CHECK (
    subject_type IN (
      'user',
      'provider',
      'ngo',
      'volunteer',
      'admin',
      'provider_report_attachment',
      'moderation_appeal_attachment',
      'notification',
      'other'
    )
  ),
  CONSTRAINT data_deletion_requests_status_valid CHECK (
    status IN (
      'REQUESTED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'EXECUTED',
      'CANCELLED'
    )
  ),
  CONSTRAINT data_deletion_requests_reason_present CHECK (length(trim(reason)) > 0),
  CONSTRAINT data_deletion_requests_subject_present CHECK (length(trim(subject_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_status_requested
  ON data_deletion_requests (status, requested_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_subject
  ON data_deletion_requests (subject_type, subject_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_target_user
  ON data_deletion_requests (target_user_id, requested_at DESC)
  WHERE target_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS data_archive_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  policy_key TEXT NOT NULL REFERENCES retention_policies(policy_key),
  archive_status TEXT NOT NULL DEFAULT 'candidate',
  archive_reason TEXT NULL,
  storage_provider TEXT NULL,
  archive_reference TEXT NULL,
  archived_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  archived_at TIMESTAMP NULL,
  visible_in_audit_center BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT data_archive_records_source_present CHECK (length(trim(source_table)) > 0),
  CONSTRAINT data_archive_records_record_present CHECK (length(trim(source_record_id)) > 0),
  CONSTRAINT data_archive_records_status_valid CHECK (
    archive_status IN ('candidate','archived','restored','blocked','legal_hold')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_archive_records_source
  ON data_archive_records (source_table, source_record_id);

CREATE INDEX IF NOT EXISTS idx_data_archive_records_policy_status
  ON data_archive_records (policy_key, archive_status, created_at DESC);

CREATE TABLE IF NOT EXISTS compliance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'admin',
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  deletion_request_id UUID NULL REFERENCES data_deletion_requests(id) ON DELETE SET NULL,
  policy_key TEXT NULL REFERENCES retention_policies(policy_key),
  details TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT compliance_events_event_present CHECK (length(trim(event_type)) > 0),
  CONSTRAINT compliance_events_actor_type_valid CHECK (
    actor_type IN ('admin','system','user')
  ),
  CONSTRAINT compliance_events_target_present CHECK (length(trim(target_type)) > 0 AND length(trim(target_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_compliance_events_created
  ON compliance_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_events_request
  ON compliance_events (deletion_request_id, created_at ASC)
  WHERE deletion_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_compliance_events_target
  ON compliance_events (target_type, target_id, created_at DESC);

ALTER TABLE provider_report_attachments
  ADD COLUMN IF NOT EXISTS retention_policy_key TEXT NOT NULL DEFAULT 'evidence_records' REFERENCES retention_policies(policy_key),
  ADD COLUMN IF NOT EXISTS archive_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS archived_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reference TEXT NULL,
  ADD COLUMN IF NOT EXISTS archive_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retained_until TIMESTAMP NULL;

ALTER TABLE moderation_appeal_attachments
  ADD COLUMN IF NOT EXISTS retention_policy_key TEXT NOT NULL DEFAULT 'evidence_records' REFERENCES retention_policies(policy_key),
  ADD COLUMN IF NOT EXISTS archive_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS archived_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reference TEXT NULL,
  ADD COLUMN IF NOT EXISTS archive_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retained_until TIMESTAMP NULL;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS retention_policy_key TEXT NOT NULL DEFAULT 'notifications' REFERENCES retention_policies(policy_key),
  ADD COLUMN IF NOT EXISTS archive_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS archived_by_admin_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retained_until TIMESTAMP NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_report_attachments_archive_status_valid'
  ) THEN
    ALTER TABLE provider_report_attachments
      ADD CONSTRAINT provider_report_attachments_archive_status_valid
      CHECK (archive_status IN ('active','candidate','archived','legal_hold')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'moderation_appeal_attachments_archive_status_valid'
  ) THEN
    ALTER TABLE moderation_appeal_attachments
      ADD CONSTRAINT moderation_appeal_attachments_archive_status_valid
      CHECK (archive_status IN ('active','candidate','archived','legal_hold')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_archive_status_valid'
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_archive_status_valid
      CHECK (archive_status IN ('active','candidate','archived','legal_hold')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_provider_report_attachments_archive
  ON provider_report_attachments (archive_status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeal_attachments_archive
  ON moderation_appeal_attachments (archive_status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_archive_status_created
  ON notifications (archive_status, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_compliance_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'compliance events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compliance_events_immutable ON compliance_events;
CREATE TRIGGER trg_compliance_events_immutable
  BEFORE UPDATE OR DELETE ON compliance_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_compliance_event_mutation();
