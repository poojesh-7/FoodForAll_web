DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('operational_events', 'request_id'),
      ('operational_events', 'correlation_id'),
      ('operational_events', 'payment_session_id'),
      ('operational_events', 'queue_job_id'),
      ('operational_events', 'worker_name'),
      ('operational_events', 'category'),
      ('operational_events', 'severity'),
      ('operational_events', 'event_name'),
      ('operational_events', 'role'),
      ('operational_alerts', 'alert_key'),
      ('operational_alerts', 'category'),
      ('operational_alerts', 'severity'),
      ('operational_alerts', 'message'),
      ('operational_alerts', 'status'),
      ('worker_heartbeats', 'worker_name'),
      ('worker_heartbeats', 'queue_name'),
      ('worker_heartbeats', 'status'),
      ('worker_heartbeats', 'last_job_id'),
      ('cashfree_webhook_events', 'idempotency_key'),
      ('cashfree_webhook_events', 'event_type'),
      ('cashfree_webhook_events', 'order_id'),
      ('cashfree_webhook_events', 'cf_payment_id'),
      ('cashfree_webhook_events', 'refund_id'),
      ('cashfree_webhook_events', 'status'),
      ('cashfree_webhook_events', 'payload_hash'),
      ('cashfree_webhook_events', 'signature'),
      ('cashfree_webhook_events', 'webhook_timestamp'),
      ('payments', 'order_id'),
      ('payments', 'payment_session_id'),
      ('payments', 'transaction_id'),
      ('payments', 'payment_method'),
      ('payments', 'refund_id'),
      ('payments', 'refund_status'),
      ('payments', 'gateway_status'),
      ('payments', 'last_webhook_event_key'),
      ('payments', 'reconciliation_status'),
      ('payments', 'reliability_deposit_status'),
      ('payments', 'reliability_deposit_refund_id'),
      ('reservations', 'payment_status'),
      ('reservations', 'status'),
      ('reservations', 'task_status'),
      ('reservations', 'pickup_type')
    ) AS columns_to_widen(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
      AND table_name = target.table_name
      AND column_name = target.column_name
      AND data_type = 'character varying'
      AND (character_maximum_length IS NULL OR character_maximum_length < 128)
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE TEXT',
        target.table_name,
        target.column_name
      );
    END IF;
  END LOOP;
END $$;
