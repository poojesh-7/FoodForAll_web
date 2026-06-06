CREATE TABLE IF NOT EXISTS provider_case_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_case_responses_case_provider
  ON provider_case_responses (case_id, provider_id);

CREATE INDEX IF NOT EXISTS idx_provider_case_responses_provider_updated
  ON provider_case_responses (provider_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_case_response_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES provider_case_responses(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_case_response_attachments_response
  ON provider_case_response_attachments (response_id, created_at ASC);
