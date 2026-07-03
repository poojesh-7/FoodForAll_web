-- Rollback: Revert timestamps from timestamptz back to timestamp without time zone
-- Date: 2026-07-03
-- Note: Only reverts columns that were actually converted by the up migration

BEGIN;

-- ===== RESERVATIONS TABLE =====
ALTER TABLE reservations
  ALTER COLUMN completed_at SET DATA TYPE timestamp USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN payment_expires_at SET DATA TYPE timestamp USING payment_expires_at AT TIME ZONE 'UTC';

-- ===== PAYMENTS TABLE =====
ALTER TABLE payments
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN payment_terminal_at SET DATA TYPE timestamp USING payment_terminal_at AT TIME ZONE 'UTC',
  ALTER COLUMN refund_terminal_at SET DATA TYPE timestamp USING refund_terminal_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_reconciled_at SET DATA TYPE timestamp USING last_reconciled_at AT TIME ZONE 'UTC',
  ALTER COLUMN reliability_deposit_refunded_at SET DATA TYPE timestamp USING reliability_deposit_refunded_at AT TIME ZONE 'UTC',
  ALTER COLUMN reliability_deposit_retained_at SET DATA TYPE timestamp USING reliability_deposit_retained_at AT TIME ZONE 'UTC';

-- ===== CASHFREE WEBHOOK EVENTS TABLE =====
ALTER TABLE cashfree_webhook_events
  ALTER COLUMN received_at SET DATA TYPE timestamp USING received_at AT TIME ZONE 'UTC',
  ALTER COLUMN processed_at SET DATA TYPE timestamp USING processed_at AT TIME ZONE 'UTC';

-- ===== CASHFREE WEBHOOK AUDIT LOG TABLE =====
ALTER TABLE cashfree_webhook_audit_log
  ALTER COLUMN received_at SET DATA TYPE timestamp USING received_at AT TIME ZONE 'UTC';

-- ===== TRUST EVENTS TABLE =====
ALTER TABLE trust_events
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN processed_at SET DATA TYPE timestamp USING processed_at AT TIME ZONE 'UTC';

-- ===== TRUST RESTRICTIONS TABLE =====
ALTER TABLE trust_restrictions
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN active_until SET DATA TYPE timestamp USING active_until AT TIME ZONE 'UTC';

-- ===== TRUST SCORES TABLE =====
ALTER TABLE trust_scores
  ALTER COLUMN cooldown_until SET DATA TYPE timestamp USING cooldown_until AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN projected_cooldown_until SET DATA TYPE timestamp USING projected_cooldown_until AT TIME ZONE 'UTC',
  ALTER COLUMN last_success_at SET DATA TYPE timestamp USING last_success_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_failure_at SET DATA TYPE timestamp USING last_failure_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_decay_at SET DATA TYPE timestamp USING last_decay_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_event_at SET DATA TYPE timestamp USING last_event_at AT TIME ZONE 'UTC';

-- ===== TRUST EVENT EFFECTS TABLE =====
ALTER TABLE trust_event_effects
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== USERS TABLE =====
ALTER TABLE users
  ALTER COLUMN cooldown_until SET DATA TYPE timestamp USING cooldown_until AT TIME ZONE 'UTC',
  ALTER COLUMN last_penalty_at SET DATA TYPE timestamp USING last_penalty_at AT TIME ZONE 'UTC',
  ALTER COLUMN refresh_token_expiry SET DATA TYPE timestamp USING refresh_token_expiry AT TIME ZONE 'UTC',
  ALTER COLUMN refresh_token_last_used_at SET DATA TYPE timestamp USING refresh_token_last_used_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_auth_activity_at SET DATA TYPE timestamp USING last_auth_activity_at AT TIME ZONE 'UTC';

-- ===== NGOS TABLE =====
ALTER TABLE ngos
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN banned_until SET DATA TYPE timestamp USING banned_until AT TIME ZONE 'UTC';

-- ===== OPERATIONAL ALERTS TABLE =====
ALTER TABLE operational_alerts
  ALTER COLUMN first_seen_at SET DATA TYPE timestamp USING first_seen_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_seen_at SET DATA TYPE timestamp USING last_seen_at AT TIME ZONE 'UTC';

-- ===== OPERATIONAL EVENTS TABLE =====
ALTER TABLE operational_events
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== ADMIN TRUST ACTIONS TABLE =====
ALTER TABLE admin_trust_actions
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== COMPLIANCE EVENTS TABLE =====
ALTER TABLE compliance_events
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== DATA ARCHIVE RECORDS TABLE =====
ALTER TABLE data_archive_records
  ALTER COLUMN archived_at SET DATA TYPE timestamp USING archived_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC';

-- ===== DATA DELETION REQUESTS TABLE =====
ALTER TABLE data_deletion_requests
  ALTER COLUMN requested_at SET DATA TYPE timestamp USING requested_at AT TIME ZONE 'UTC',
  ALTER COLUMN reviewed_at SET DATA TYPE timestamp USING reviewed_at AT TIME ZONE 'UTC',
  ALTER COLUMN approved_at SET DATA TYPE timestamp USING approved_at AT TIME ZONE 'UTC',
  ALTER COLUMN executed_at SET DATA TYPE timestamp USING executed_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC';

-- ===== FINANCIAL LEDGER ENTRIES TABLE =====
ALTER TABLE financial_ledger_entries
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== FINANCIAL OPERATIONS TABLE =====
ALTER TABLE financial_operations
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC';

-- ===== FINANCIAL REFUND TERMINAL RECORDS TABLE =====
ALTER TABLE financial_refund_terminal_records
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== FINANCIAL STATE TRANSITIONS TABLE =====
ALTER TABLE financial_state_transitions
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== FOOD LISTINGS TABLE =====
ALTER TABLE food_listings
  ALTER COLUMN deleted_at SET DATA TYPE timestamp USING deleted_at AT TIME ZONE 'UTC',
  ALTER COLUMN ngo_requested_at SET DATA TYPE timestamp USING ngo_requested_at AT TIME ZONE 'UTC';

-- ===== INCIDENT EVENTS TABLE =====
ALTER TABLE incident_events
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== INCIDENT NOTES TABLE =====
ALTER TABLE incident_notes
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== INCIDENT POSTMORTEMS TABLE =====
ALTER TABLE incident_postmortems
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== INCIDENT RECORDS TABLE =====
ALTER TABLE incident_records
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== LISTING IMAGES TABLE =====
ALTER TABLE listing_images
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC';

-- ===== MODERATION APPEAL ATTACHMENTS TABLE =====
ALTER TABLE moderation_appeal_attachments
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN archived_at SET DATA TYPE timestamp USING archived_at AT TIME ZONE 'UTC',
  ALTER COLUMN retained_until SET DATA TYPE timestamp USING retained_until AT TIME ZONE 'UTC';

-- ===== MODERATION APPEAL EVENTS TABLE =====
ALTER TABLE moderation_appeal_events
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== MODERATION APPEALS TABLE =====
ALTER TABLE moderation_appeals
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN submitted_at SET DATA TYPE timestamp USING submitted_at AT TIME ZONE 'UTC',
  ALTER COLUMN reviewed_at SET DATA TYPE timestamp USING reviewed_at AT TIME ZONE 'UTC',
  ALTER COLUMN withdrawn_at SET DATA TYPE timestamp USING withdrawn_at AT TIME ZONE 'UTC';

-- ===== MODERATION CASE EVENTS TABLE =====
ALTER TABLE moderation_case_events
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== MODERATION CASES TABLE =====
ALTER TABLE moderation_cases
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN closed_at SET DATA TYPE timestamp USING closed_at AT TIME ZONE 'UTC';

-- ===== NGO REQUESTS TABLE =====
ALTER TABLE ngo_requests
  ALTER COLUMN requested_at SET DATA TYPE timestamp USING requested_at AT TIME ZONE 'UTC',
  ALTER COLUMN responded_at SET DATA TYPE timestamp USING responded_at AT TIME ZONE 'UTC';

-- ===== NOTIFICATIONS TABLE =====
ALTER TABLE notifications
  ALTER COLUMN archived_at SET DATA TYPE timestamp USING archived_at AT TIME ZONE 'UTC',
  ALTER COLUMN retained_until SET DATA TYPE timestamp USING retained_until AT TIME ZONE 'UTC';

-- ===== PAYMENT OWNERSHIP TABLE =====
ALTER TABLE payment_ownership
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== PAYMENT ORDER ATTEMPTS TABLE =====
ALTER TABLE payment_order_attempts
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN recovered_at SET DATA TYPE timestamp USING recovered_at AT TIME ZONE 'UTC';

-- ===== PROVIDER CASE RESPONSE ATTACHMENTS TABLE =====
ALTER TABLE provider_case_response_attachments
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== PROVIDER CASE RESPONSES TABLE =====
ALTER TABLE provider_case_responses
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC';

-- ===== PROVIDER REPORT ATTACHMENTS TABLE =====
ALTER TABLE provider_report_attachments
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN archived_at SET DATA TYPE timestamp USING archived_at AT TIME ZONE 'UTC',
  ALTER COLUMN retained_until SET DATA TYPE timestamp USING retained_until AT TIME ZONE 'UTC';

-- ===== PROVIDER REPORTS TABLE =====
ALTER TABLE provider_reports
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN resolved_at SET DATA TYPE timestamp USING resolved_at AT TIME ZONE 'UTC';

-- ===== PROVIDER SETTLEMENTS TABLE =====
ALTER TABLE provider_settlements
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC';

-- ===== RATINGS TABLE =====
ALTER TABLE ratings
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== RESTAURANTS TABLE =====
ALTER TABLE restaurants
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== RETENTION POLICIES TABLE =====
ALTER TABLE retention_policies
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC';

-- ===== SETTLEMENT ALLOCATION SNAPSHOTS TABLE =====
ALTER TABLE settlement_allocation_snapshots
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC';

-- ===== SETTLEMENT BATCHES TABLE =====
ALTER TABLE settlement_batches
  ALTER COLUMN created_at SET DATA TYPE timestamp USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at SET DATA TYPE timestamp USING updated_at AT TIME ZONE 'UTC';

COMMIT;
