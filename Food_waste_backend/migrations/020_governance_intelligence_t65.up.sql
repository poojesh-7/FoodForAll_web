CREATE INDEX IF NOT EXISTS idx_provider_reports_reporter_status_created
  ON provider_reports (reported_by, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_reports_reporter_provider_created
  ON provider_reports (reported_by, provider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_subject_created
  ON moderation_cases (subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_case_events_type_status_created
  ON moderation_case_events (event_type, to_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_case_status_created
  ON moderation_appeals (case_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_provider_status_created
  ON moderation_appeals (provider_id, status, created_at DESC);
