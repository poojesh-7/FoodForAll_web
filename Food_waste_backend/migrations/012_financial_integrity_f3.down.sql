DROP TRIGGER IF EXISTS trg_payments_financial_state_transition_log ON payments;
DROP TRIGGER IF EXISTS trg_payments_financial_state_guard ON payments;
DROP TRIGGER IF EXISTS trg_financial_state_transitions_immutable ON financial_state_transitions;
DROP TRIGGER IF EXISTS trg_cashfree_webhook_audit_immutable ON cashfree_webhook_audit_log;

DROP FUNCTION IF EXISTS log_payment_financial_state_transition();
DROP FUNCTION IF EXISTS guard_payment_financial_state_transition();
DROP FUNCTION IF EXISTS prevent_financial_state_transition_mutation();
DROP FUNCTION IF EXISTS prevent_cashfree_webhook_audit_mutation();

DROP TABLE IF EXISTS financial_state_transitions;
DROP TABLE IF EXISTS cashfree_webhook_audit_log;
DROP TABLE IF EXISTS payment_order_attempts;

ALTER TABLE payments
  DROP COLUMN IF EXISTS financial_state_version,
  DROP COLUMN IF EXISTS refund_terminal_at,
  DROP COLUMN IF EXISTS payment_terminal_at;
