CREATE TABLE IF NOT EXISTS provider_report_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES provider_reports(id) ON DELETE CASCADE,
  uploader_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_report_attachments_report
  ON provider_report_attachments (report_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_provider_report_attachments_uploader_created
  ON provider_report_attachments (uploader_user_id, created_at DESC);
