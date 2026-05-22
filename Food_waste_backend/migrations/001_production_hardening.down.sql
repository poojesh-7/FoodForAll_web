DROP INDEX IF EXISTS idx_restaurants_verification;
DROP INDEX IF EXISTS idx_ngos_verification;
DROP INDEX IF EXISTS idx_notifications_user_read;
DROP INDEX IF EXISTS idx_operational_alerts_open_key;
DROP INDEX IF EXISTS idx_operational_events_category;
DROP INDEX IF EXISTS idx_operational_events_created;
DROP INDEX IF EXISTS idx_volunteer_requests_lookup;
DROP INDEX IF EXISTS idx_provider_reports_unique_pending;
DROP INDEX IF EXISTS idx_provider_reports_provider_status;
DROP INDEX IF EXISTS idx_cashfree_webhook_events_status;
DROP INDEX IF EXISTS idx_cashfree_webhook_events_order;
DROP INDEX IF EXISTS idx_payments_deposit_refund_id_unique;
DROP INDEX IF EXISTS idx_payments_refund_id_unique;
DROP INDEX IF EXISTS idx_payments_transaction_id_unique;
DROP INDEX IF EXISTS idx_payments_reconciliation;
DROP INDEX IF EXISTS idx_payments_reservation;
DROP INDEX IF EXISTS idx_payments_order_status;
DROP INDEX IF EXISTS idx_reservations_pending_payment;
DROP INDEX IF EXISTS idx_reservations_volunteer_tasks;
DROP INDEX IF EXISTS idx_reservations_listing_reserved;
DROP INDEX IF EXISTS idx_reservations_listing_status;
DROP INDEX IF EXISTS idx_reservations_user_lifecycle;
DROP INDEX IF EXISTS idx_reservations_user_status;
DROP INDEX IF EXISTS unique_pending_payment_reservation;
DROP INDEX IF EXISTS unique_active_reservation;
DROP INDEX IF EXISTS idx_food_listings_location_gist;
DROP INDEX IF EXISTS idx_food_listings_provider_status;
DROP INDEX IF EXISTS idx_food_listings_active_scan;
DROP INDEX IF EXISTS idx_food_listings_visibility;
DROP INDEX IF EXISTS users_email_unique_idx;

DROP TABLE IF EXISTS worker_heartbeats;
DROP TABLE IF EXISTS operational_alerts;
DROP TABLE IF EXISTS operational_events;
DROP TABLE IF EXISTS cashfree_webhook_events;

ALTER TABLE volunteer_requests
  DROP COLUMN IF EXISTS request_type;

ALTER TABLE payments
  DROP COLUMN IF EXISTS reliability_deposit_refund_attempts,
  DROP COLUMN IF EXISTS refund_attempts,
  DROP COLUMN IF EXISTS reconciliation_attempts,
  DROP COLUMN IF EXISTS reconciliation_status,
  DROP COLUMN IF EXISTS last_reconciled_at,
  DROP COLUMN IF EXISTS last_webhook_event_key,
  DROP COLUMN IF EXISTS gateway_status,
  DROP COLUMN IF EXISTS refund_status,
  DROP COLUMN IF EXISTS refund_id,
  DROP COLUMN IF EXISTS payment_method,
  DROP COLUMN IF EXISTS transaction_id,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS reliability_deposit_retained_at,
  DROP COLUMN IF EXISTS reliability_deposit_refunded_at,
  DROP COLUMN IF EXISTS reliability_deposit_refund_id,
  DROP COLUMN IF EXISTS reliability_deposit_status,
  DROP COLUMN IF EXISTS reliability_deposit_amount,
  DROP COLUMN IF EXISTS food_amount;

ALTER TABLE reservations
  DROP COLUMN IF EXISTS payment_expires_at,
  DROP COLUMN IF EXISTS payment_context;

ALTER TABLE food_listings
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS is_deleted;

ALTER TABLE users
  DROP COLUMN IF EXISTS total_failed_pickups,
  DROP COLUMN IF EXISTS total_successful_pickups,
  DROP COLUMN IF EXISTS restriction_type,
  DROP COLUMN IF EXISTS trust_score,
  DROP COLUMN IF EXISTS cooldown_until,
  DROP COLUMN IF EXISTS restriction_reason,
  DROP COLUMN IF EXISTS restriction_level,
  DROP COLUMN IF EXISTS successful_pickups_count,
  DROP COLUMN IF EXISTS last_penalty_at,
  DROP COLUMN IF EXISTS requires_reliability_deposit,
  DROP COLUMN IF EXISTS reliability_deposit_amount,
  DROP COLUMN IF EXISTS last_auth_activity_at,
  DROP COLUMN IF EXISTS refresh_token_last_used_at,
  DROP COLUMN IF EXISTS refresh_token_device,
  DROP COLUMN IF EXISTS refresh_token_family;
