CREATE INDEX IF NOT EXISTS idx_moderation_cases_status_updated
  ON moderation_cases (status, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_status_submitted
  ON moderation_appeals (status, submitted_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_trust_actions_created
  ON admin_trust_actions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_type_created
  ON notifications (type, created_at DESC);
