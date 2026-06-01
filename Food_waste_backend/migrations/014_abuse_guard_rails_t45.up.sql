CREATE INDEX IF NOT EXISTS idx_reservations_user_active_unpaid_holds
  ON reservations (user_id, status, payment_status, payment_expires_at, reserved_at DESC);

CREATE INDEX IF NOT EXISTS idx_reservations_user_abandoned_hold_patterns
  ON reservations (user_id, reserved_at DESC, status, payment_status)
  WHERE status IN (
    'abandoned_payment',
    'cancelled_before_confirmation',
    'expired_payment',
    'payment_failed'
  )
  OR payment_status IN ('abandoned','cancelled','expired','failed');

CREATE INDEX IF NOT EXISTS idx_trust_events_subject_daily_gain
  ON trust_events (subject_type, subject_id, created_at DESC, event_type);

CREATE INDEX IF NOT EXISTS idx_trust_events_provider_pairings
  ON trust_events (
    subject_type,
    subject_id,
    ((event_payload->'metadata'->>'provider_id')),
    created_at DESC
  )
  WHERE event_payload->'metadata'->>'provider_id' IS NOT NULL;
