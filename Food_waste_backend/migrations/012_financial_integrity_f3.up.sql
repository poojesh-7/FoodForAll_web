CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_terminal_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS refund_terminal_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS financial_state_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payment_order_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL UNIQUE,
  payer_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  reservation_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'creating',
  payment_session_id TEXT NULL,
  reservation_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  gateway_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason TEXT NULL,
  recovery_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  recovered_at TIMESTAMP NULL,
  CONSTRAINT payment_order_attempts_amount_nonnegative
    CHECK (amount >= 0),
  CONSTRAINT payment_order_attempts_recovery_attempts_nonnegative
    CHECK (recovery_attempts >= 0),
  CONSTRAINT payment_order_attempts_status_valid
    CHECK (status IN (
      'creating',
      'gateway_created',
      'db_inserted',
      'committed',
      'recovery_pending',
      'recovered',
      'abandoned',
      'manual_review_required',
      'failed'
    ))
);

CREATE INDEX IF NOT EXISTS idx_payment_order_attempts_status_updated
  ON payment_order_attempts (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_payment_order_attempts_payer
  ON payment_order_attempts (payer_user_id, created_at DESC)
  WHERE payer_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cashfree_webhook_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NULL,
  event_type TEXT NULL,
  order_id TEXT NULL,
  cf_payment_id TEXT NULL,
  refund_id TEXT NULL,
  processing_status TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  signature_present BOOLEAN NOT NULL DEFAULT false,
  webhook_timestamp TEXT NULL,
  rejection_reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT cashfree_webhook_audit_status_valid
    CHECK (processing_status IN (
      'received',
      'duplicate',
      'concurrent_duplicate',
      'processed',
      'failed',
      'rejected'
    ))
);

CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_audit_order
  ON cashfree_webhook_audit_log (order_id, received_at DESC)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_audit_refund
  ON cashfree_webhook_audit_log (refund_id, received_at DESC)
  WHERE refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_audit_status
  ON cashfree_webhook_audit_log (processing_status, received_at DESC);

CREATE TABLE IF NOT EXISTS financial_state_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  reservation_id UUID NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  order_id TEXT NULL,
  old_payment_status TEXT NULL,
  new_payment_status TEXT NULL,
  old_refund_status TEXT NULL,
  new_refund_status TEXT NULL,
  old_deposit_status TEXT NULL,
  new_deposit_status TEXT NULL,
  transition_source TEXT NOT NULL DEFAULT 'database_trigger',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_state_transitions_payment
  ON financial_state_transitions (payment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_state_transitions_reservation
  ON financial_state_transitions (reservation_id, created_at DESC)
  WHERE reservation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_cashfree_webhook_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cashfree_webhook_audit_log rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_cashfree_webhook_audit_immutable ON cashfree_webhook_audit_log;
CREATE TRIGGER trg_cashfree_webhook_audit_immutable
  BEFORE UPDATE OR DELETE ON cashfree_webhook_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_cashfree_webhook_audit_mutation();

CREATE OR REPLACE FUNCTION prevent_financial_state_transition_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'financial_state_transitions rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_state_transitions_immutable ON financial_state_transitions;
CREATE TRIGGER trg_financial_state_transitions_immutable
  BEFORE UPDATE OR DELETE ON financial_state_transitions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_financial_state_transition_mutation();

CREATE OR REPLACE FUNCTION guard_payment_financial_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := COALESCE(OLD.status, 'created');
  new_status TEXT := COALESCE(NEW.status, old_status);
  old_refund_status TEXT := COALESCE(OLD.refund_status, 'not_requested');
  new_refund_status TEXT := COALESCE(NEW.refund_status, old_refund_status);
  old_deposit_status TEXT := COALESCE(OLD.reliability_deposit_status, 'not_required');
  new_deposit_status TEXT := COALESCE(NEW.reliability_deposit_status, old_deposit_status);
BEGIN
  IF old_status = 'refunded' AND new_status <> 'refunded' THEN
    RAISE EXCEPTION 'Illegal payment state transition from refunded to %', new_status;
  END IF;

  IF old_status = 'paid' AND new_status IN ('created','pending','failed','expired') THEN
    RAISE EXCEPTION 'Illegal payment state transition from paid to %', new_status;
  END IF;

  IF old_status = 'refund_pending' AND new_status IN ('created','pending','paid','failed','expired') THEN
    RAISE EXCEPTION 'Illegal payment state transition from refund_pending to %', new_status;
  END IF;

  IF old_status = 'refund_failed' AND new_status IN ('created','pending','paid','failed','expired') THEN
    RAISE EXCEPTION 'Illegal payment state transition from refund_failed to %', new_status;
  END IF;

  IF old_status IN ('failed','expired') AND new_status IN ('created','pending','paid') THEN
    RAISE EXCEPTION 'Illegal payment state transition from % to %', old_status, new_status;
  END IF;

  IF old_refund_status = 'refunded' AND new_refund_status <> 'refunded' THEN
    RAISE EXCEPTION 'Illegal refund status transition from refunded to %', new_refund_status;
  END IF;

  IF old_refund_status = 'refund_failed' AND new_refund_status = 'refund_pending'
     AND new_status <> 'refund_pending' THEN
    RAISE EXCEPTION 'Illegal stale refund status transition from refund_failed to refund_pending';
  END IF;

  IF old_deposit_status IN ('refunded','retained')
     AND new_deposit_status <> old_deposit_status THEN
    RAISE EXCEPTION 'Illegal reliability deposit transition from % to %',
      old_deposit_status,
      new_deposit_status;
  END IF;

  IF new_status IN ('paid','failed','expired','refunded','refund_failed')
     AND OLD.payment_terminal_at IS NULL THEN
    NEW.payment_terminal_at = NOW();
  END IF;

  IF new_status IN ('refunded','refund_failed')
     AND OLD.refund_terminal_at IS NULL THEN
    NEW.refund_terminal_at = NOW();
  END IF;

  IF old_status IS DISTINCT FROM new_status
     OR old_refund_status IS DISTINCT FROM new_refund_status
     OR old_deposit_status IS DISTINCT FROM new_deposit_status THEN
    NEW.financial_state_version = COALESCE(OLD.financial_state_version, 0) + 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_financial_state_guard ON payments;
CREATE TRIGGER trg_payments_financial_state_guard
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION guard_payment_financial_state_transition();

CREATE OR REPLACE FUNCTION log_payment_financial_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     OR OLD.refund_status IS DISTINCT FROM NEW.refund_status
     OR OLD.reliability_deposit_status IS DISTINCT FROM NEW.reliability_deposit_status THEN
    INSERT INTO financial_state_transitions (
      payment_id,
      reservation_id,
      order_id,
      old_payment_status,
      new_payment_status,
      old_refund_status,
      new_refund_status,
      old_deposit_status,
      new_deposit_status,
      metadata
    )
    VALUES (
      NEW.id,
      NEW.reservation_id,
      NEW.order_id,
      OLD.status,
      NEW.status,
      OLD.refund_status,
      NEW.refund_status,
      OLD.reliability_deposit_status,
      NEW.reliability_deposit_status,
      jsonb_build_object(
        'gateway_status', NEW.gateway_status,
        'reconciliation_status', NEW.reconciliation_status,
        'financial_state_version', NEW.financial_state_version
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_financial_state_transition_log ON payments;
CREATE TRIGGER trg_payments_financial_state_transition_log
  AFTER UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION log_payment_financial_state_transition();
