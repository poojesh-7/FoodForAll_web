DROP TRIGGER IF EXISTS trg_compliance_events_immutable ON compliance_events;
DROP FUNCTION IF EXISTS prevent_compliance_event_mutation();

DROP INDEX IF EXISTS idx_notifications_archive_status_created;
DROP INDEX IF EXISTS idx_moderation_appeal_attachments_archive;
DROP INDEX IF EXISTS idx_provider_report_attachments_archive;

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_archive_status_valid,
  DROP COLUMN IF EXISTS retained_until,
  DROP COLUMN IF EXISTS archive_metadata,
  DROP COLUMN IF EXISTS archived_by_admin_id,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS archive_status,
  DROP COLUMN IF EXISTS retention_policy_key;

ALTER TABLE moderation_appeal_attachments
  DROP CONSTRAINT IF EXISTS moderation_appeal_attachments_archive_status_valid,
  DROP COLUMN IF EXISTS retained_until,
  DROP COLUMN IF EXISTS archive_metadata,
  DROP COLUMN IF EXISTS archive_reference,
  DROP COLUMN IF EXISTS archived_by_admin_id,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS archive_status,
  DROP COLUMN IF EXISTS retention_policy_key;

ALTER TABLE provider_report_attachments
  DROP CONSTRAINT IF EXISTS provider_report_attachments_archive_status_valid,
  DROP COLUMN IF EXISTS retained_until,
  DROP COLUMN IF EXISTS archive_metadata,
  DROP COLUMN IF EXISTS archive_reference,
  DROP COLUMN IF EXISTS archived_by_admin_id,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS archive_status,
  DROP COLUMN IF EXISTS retention_policy_key;

DROP INDEX IF EXISTS idx_compliance_events_target;
DROP INDEX IF EXISTS idx_compliance_events_request;
DROP INDEX IF EXISTS idx_compliance_events_created;
DROP TABLE IF EXISTS compliance_events;

DROP INDEX IF EXISTS idx_data_archive_records_policy_status;
DROP INDEX IF EXISTS idx_data_archive_records_source;
DROP TABLE IF EXISTS data_archive_records;

DROP INDEX IF EXISTS idx_data_deletion_requests_target_user;
DROP INDEX IF EXISTS idx_data_deletion_requests_subject;
DROP INDEX IF EXISTS idx_data_deletion_requests_status_requested;
DROP TABLE IF EXISTS data_deletion_requests;

DROP TABLE IF EXISTS retention_policies;
