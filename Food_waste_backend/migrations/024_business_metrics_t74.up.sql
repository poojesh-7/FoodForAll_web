CREATE INDEX IF NOT EXISTS idx_business_metrics_food_listings_created
  ON food_listings (created_at DESC, id DESC)
  WHERE COALESCE(is_deleted, false) = false;

CREATE INDEX IF NOT EXISTS idx_business_metrics_food_listings_provider_created
  ON food_listings (provider_id, created_at DESC)
  WHERE provider_id IS NOT NULL
  AND COALESCE(is_deleted, false) = false;

CREATE INDEX IF NOT EXISTS idx_business_metrics_reservations_reserved
  ON reservations (reserved_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_business_metrics_reservations_completed
  ON reservations (completed_at DESC, id DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_metrics_reservations_picked_up
  ON reservations (picked_up_at DESC, id DESC)
  WHERE picked_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_metrics_reservations_volunteer
  ON reservations (assigned_volunteer_id, completed_at DESC)
  WHERE assigned_volunteer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_metrics_provider_reports_created
  ON provider_reports (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_business_metrics_provider_reports_status_resolved
  ON provider_reports (status, resolved_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_metrics_moderation_appeals_submitted
  ON moderation_appeals (submitted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_business_metrics_provider_settlements_created
  ON provider_settlements (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_business_metrics_provider_settlements_status_updated
  ON provider_settlements (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_metrics_refund_terminal_created
  ON financial_refund_terminal_records (terminal_status, created_at DESC);
