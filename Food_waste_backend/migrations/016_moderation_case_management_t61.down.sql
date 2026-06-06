DROP INDEX IF EXISTS idx_moderation_case_events_actor_created;
DROP INDEX IF EXISTS idx_moderation_case_events_case_created;
DROP TABLE IF EXISTS moderation_case_events;

DROP INDEX IF EXISTS idx_moderation_cases_status_created;
DROP INDEX IF EXISTS idx_moderation_cases_subject_status;
DROP INDEX IF EXISTS idx_moderation_cases_source_report;

ALTER TABLE provider_reports
  DROP COLUMN IF EXISTS moderation_case_id;

DROP TABLE IF EXISTS moderation_cases;
