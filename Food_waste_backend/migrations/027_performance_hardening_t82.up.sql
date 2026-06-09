CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_active_archive
  ON notifications (user_id, created_at DESC, id DESC)
  WHERE archive_status <> 'archived';

CREATE INDEX IF NOT EXISTS idx_restaurants_user_verified_lookup
  ON restaurants (user_id, is_verified DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ngos_user_verified_lookup
  ON ngos (user_id, is_verified DESC, id DESC);
