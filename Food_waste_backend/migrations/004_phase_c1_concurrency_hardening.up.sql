CREATE INDEX IF NOT EXISTS idx_payments_order_reservation_lock
  ON payments (order_id, reservation_id, id);

CREATE INDEX IF NOT EXISTS idx_payments_reservation_status_updated
  ON payments (reservation_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_listing_payment_state
  ON reservations (listing_id, status, payment_status, id);

CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_events_order_recent
  ON cashfree_webhook_events (order_id, received_at DESC, status)
  WHERE order_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'food_listings_remaining_quantity_nonnegative'
  ) THEN
    ALTER TABLE food_listings
      ADD CONSTRAINT food_listings_remaining_quantity_nonnegative
      CHECK (remaining_quantity >= 0) NOT VALID;
  END IF;
END $$;
