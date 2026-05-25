ALTER TABLE food_listings
  DROP CONSTRAINT IF EXISTS food_listings_remaining_quantity_nonnegative;

DROP INDEX IF EXISTS idx_cashfree_webhook_events_order_recent;
DROP INDEX IF EXISTS idx_reservations_listing_payment_state;
DROP INDEX IF EXISTS idx_payments_reservation_status_updated;
DROP INDEX IF EXISTS idx_payments_order_reservation_lock;
