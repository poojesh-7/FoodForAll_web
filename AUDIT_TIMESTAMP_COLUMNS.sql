-- Query to audit which tables and columns exist for timestamps
-- Run this against the database to verify before migration

SELECT 
  table_name,
  STRING_AGG(column_name, ', ') AS timestamp_columns
FROM information_schema.columns
WHERE table_schema = 'public'
AND (
  column_name IN (
    'created_at', 'updated_at', 'deleted_at', 'archived_at',
    'reserved_at', 'assigned_at', 'picked_up_at', 'completed_at', 'payment_expires_at',
    'payment_terminal_at', 'refund_terminal_at', 'last_reconciled_at',
    'received_at', 'processed_at',
    'submitted_at', 'reviewed_at', 'withdrawn_at', 'approved_at', 'executed_at', 'resolved_at',
    'banned_until', 'cooldown_until', 'active_until', 'projected_cooldown_until',
    'retained_until', 'reliability_deposit_refunded_at', 'reliability_deposit_retained_at',
    'ngo_requested_at', 'change_requested_at', 'first_seen_at', 'last_seen_at',
    'pickup_start_time', 'pickup_end_time'
  )
  OR data_type LIKE '%time%'
)
GROUP BY table_name
ORDER BY table_name;
