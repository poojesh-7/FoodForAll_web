CREATE UNIQUE INDEX IF NOT EXISTS unique_volunteer_active_task
  ON reservations (assigned_volunteer_id)
  WHERE assigned_volunteer_id IS NOT NULL
    AND task_status IN ('in_progress', 'picked_from_provider');

CREATE INDEX IF NOT EXISTS idx_reservations_payment_reconcile_order
  ON reservations (status, payment_status, payment_expires_at, reserved_at, id)
  WHERE status='payment_pending' AND payment_status='pending';

CREATE INDEX IF NOT EXISTS idx_payments_refund_pending
  ON payments (reservation_id, status, refund_status, updated_at DESC)
  WHERE status IN ('refund_pending', 'refund_failed', 'paid', 'success');

CREATE INDEX IF NOT EXISTS idx_ngo_requests_pending_listing
  ON ngo_requests (listing_id, status, id)
  WHERE status='pending';
