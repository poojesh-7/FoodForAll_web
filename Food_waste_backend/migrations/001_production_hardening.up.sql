CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS refresh_token_family TEXT NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_device TEXT NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_last_used_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_auth_activity_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS reliability_deposit_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requires_reliability_deposit BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_penalty_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS successful_pickups_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS restriction_level INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS restriction_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS trust_score NUMERIC DEFAULT 100,
  ADD COLUMN IF NOT EXISTS restriction_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS total_successful_pickups INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_failed_pickups INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON users (lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email) <> '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_phone_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_unique UNIQUE (phone);
  END IF;
END
$$;

ALTER TABLE food_listings
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_food_listings_visibility
  ON food_listings (status, is_deleted, pickup_end_time);

CREATE INDEX IF NOT EXISTS idx_food_listings_active_scan
  ON food_listings (pickup_end_time, remaining_quantity, created_at DESC)
  WHERE status='active' AND is_deleted=false;

CREATE INDEX IF NOT EXISTS idx_food_listings_provider_status
  ON food_listings (provider_id, status, pickup_end_time DESC);

CREATE INDEX IF NOT EXISTS idx_food_listings_location_gist
  ON food_listings USING GIST (location);

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS payment_context JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMP NULL;

DROP INDEX IF EXISTS unique_active_reservation;

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_reservation
  ON reservations (user_id, listing_id)
  WHERE (
    (
      status IN ('reserved', 'pending', 'volunteer_started', 'picked_from_provider', 'delivered', 'picked_up', 'completed')
      OR task_status IN ('self_pickup', 'pending', 'assigned', 'in_progress', 'volunteer_started', 'picked_from_provider', 'delivered')
    )
    AND NOT (status='payment_pending' AND payment_status='pending')
    AND COALESCE(status, '') NOT IN ('cancelled', 'expired', 'failed', 'payment_failed', 'abandoned_payment', 'expired_payment', 'cancelled_before_confirmation')
    AND COALESCE(payment_status, '') NOT IN ('failed', 'expired', 'abandoned', 'cancelled')
  );

CREATE INDEX IF NOT EXISTS idx_reservations_user_status
  ON reservations (user_id, status, reserved_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_user_lifecycle
  ON reservations (user_id, pickup_type, task_status, reserved_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_listing_status
  ON reservations (listing_id, status, task_status, reserved_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_listing_reserved
  ON reservations (listing_id, reserved_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_volunteer_tasks
  ON reservations (assigned_volunteer_id, task_status, assigned_at DESC)
  WHERE assigned_volunteer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_pending_payment
  ON reservations (payment_status, status, payment_expires_at, reserved_at DESC)
  WHERE status='payment_pending' AND payment_status='pending';

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS food_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reliability_deposit_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reliability_deposit_status TEXT DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS reliability_deposit_refund_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS reliability_deposit_refunded_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS reliability_deposit_retained_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS transaction_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS payment_method TEXT NULL,
  ADD COLUMN IF NOT EXISTS refund_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS refund_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS gateway_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_webhook_event_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reliability_deposit_refund_attempts INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_payments_order_status
  ON payments (order_id, status);

CREATE INDEX IF NOT EXISTS idx_payments_reservation
  ON payments (reservation_id);

CREATE INDEX IF NOT EXISTS idx_payments_reconciliation
  ON payments (status, reconciliation_status, last_reconciled_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_id_unique
  ON payments (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_refund_id_unique
  ON payments (refund_id)
  WHERE refund_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_deposit_refund_id_unique
  ON payments (reliability_deposit_refund_id)
  WHERE reliability_deposit_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cashfree_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT NULL,
  order_id TEXT NULL,
  cf_payment_id TEXT NULL,
  refund_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  attempts INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  signature TEXT NULL,
  webhook_timestamp TEXT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP NULL,
  failure_reason TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_events_order
  ON cashfree_webhook_events (order_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_events_status
  ON cashfree_webhook_events (status, received_at DESC);

CREATE TABLE IF NOT EXISTS provider_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  description TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP NULL,
  reviewed_by_admin UUID REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE provider_reports
  ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reported_by UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by_admin UUID REFERENCES users(id) ON DELETE SET NULL;

WITH ranked_reports AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY provider_id, reported_by, reservation_id
           ORDER BY created_at ASC, id ASC
         ) AS row_number
  FROM provider_reports
  WHERE status='pending'
  AND reservation_id IS NOT NULL
)
UPDATE provider_reports pr
SET status='dismissed',
    resolved_at=COALESCE(pr.resolved_at, NOW()),
    description=LEFT(
      CONCAT_WS(E'\n', pr.description, 'Duplicate pending report closed during schema normalization.'),
      1000
    )
FROM ranked_reports ranked
WHERE pr.id=ranked.id
AND ranked.row_number > 1;

CREATE INDEX IF NOT EXISTS idx_provider_reports_provider_status
  ON provider_reports (provider_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_reports_unique_pending
  ON provider_reports (provider_id, reported_by, reservation_id)
  WHERE status='pending' AND reservation_id IS NOT NULL;

ALTER TABLE volunteer_requests
  ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'ngo_invite';

CREATE INDEX IF NOT EXISTS idx_volunteer_requests_lookup
  ON volunteer_requests (ngo_id, volunteer_id, request_type, status);

CREATE TABLE IF NOT EXISTS operational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  event_name TEXT NOT NULL,
  request_id TEXT NULL,
  user_id UUID NULL,
  role TEXT NULL,
  reservation_id UUID NULL,
  payment_session_id TEXT NULL,
  queue_job_id TEXT NULL,
  worker_name TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operational_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  occurrences INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name TEXT PRIMARY KEY,
  queue_name TEXT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  last_job_id TEXT NULL,
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_operational_events_created
  ON operational_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_events_category
  ON operational_events (category, severity, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_alerts_open_key
  ON operational_alerts (alert_key)
  WHERE status='open';

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ngos_verification
  ON ngos (is_verified, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurants_verification
  ON restaurants (is_verified, created_at DESC);
