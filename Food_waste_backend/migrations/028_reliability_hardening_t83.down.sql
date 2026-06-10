DROP INDEX IF EXISTS idx_notifications_idempotency_key;

ALTER TABLE notifications
  DROP COLUMN IF EXISTS idempotency_key;
