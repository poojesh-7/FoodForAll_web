CREATE INDEX IF NOT EXISTS idx_trust_events_audit_timeline
  ON trust_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_cases_audit_timeline
  ON moderation_cases (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_case_events_audit_timeline
  ON moderation_case_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_audit_timeline
  ON moderation_appeals (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeal_events_audit_timeline
  ON moderation_appeal_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_provider_reports_audit_timeline
  ON provider_reports (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_provider_report_attachments_audit_timeline
  ON provider_report_attachments (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_audit_timeline
  ON notifications (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_operational_events_event_audit_timeline
  ON operational_events (event_name, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_operational_events_category_audit_timeline
  ON operational_events (category, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_financial_operations_audit_timeline
  ON financial_operations (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_financial_state_transitions_audit_timeline
  ON financial_state_transitions (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_financial_refund_terminal_audit_timeline
  ON financial_refund_terminal_records (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_entries_audit_timeline
  ON financial_ledger_entries (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_allocation_audit_timeline
  ON settlement_allocation_snapshots (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_provider_settlements_audit_timeline
  ON provider_settlements (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_batches_audit_timeline
  ON settlement_batches (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cashfree_webhook_audit_timeline
  ON cashfree_webhook_audit_log (received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_payment_order_attempts_audit_timeline
  ON payment_order_attempts (created_at DESC, id DESC);
