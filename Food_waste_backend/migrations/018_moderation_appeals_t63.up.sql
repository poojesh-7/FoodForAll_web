CREATE TABLE IF NOT EXISTS moderation_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  appeal_text TEXT NOT NULL,
  decision_note TEXT NULL,
  reviewed_by_admin UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP NULL,
  withdrawn_at TIMESTAMP NULL,
  withdrawn_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT moderation_appeals_status_check CHECK (
    status IN (
      'SUBMITTED',
      'UNDER_REVIEW',
      'ACCEPTED',
      'REJECTED',
      'WITHDRAWN'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_appeals_case_provider
  ON moderation_appeals (case_id, provider_id);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_status_updated
  ON moderation_appeals (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_provider_updated
  ON moderation_appeals (provider_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS moderation_appeal_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appeal_id UUID NOT NULL REFERENCES moderation_appeals(id) ON DELETE CASCADE,
  uploader_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_appeal_attachments_appeal
  ON moderation_appeal_attachments (appeal_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeal_attachments_uploader_created
  ON moderation_appeal_attachments (uploader_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_appeal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appeal_id UUID NOT NULL REFERENCES moderation_appeals(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  from_status TEXT NULL,
  to_status TEXT NULL,
  note TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_appeal_events_appeal_created
  ON moderation_appeal_events (appeal_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeal_events_case_created
  ON moderation_appeal_events (case_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeal_events_actor_created
  ON moderation_appeal_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
