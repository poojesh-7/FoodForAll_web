const pool = require("../config/db");
const { ensurePaymentHardeningSchema } = require("./paymentReconciliation.service");

async function getPaymentHealth() {
  await ensurePaymentHardeningSchema();

  const [
    payments,
    webhooks,
    stale,
    diagnostics,
    orderAttempts,
    refunds,
    transitions,
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE status='paid')::int AS completed,
        COUNT(*) FILTER (WHERE status IN ('failed','expired','abandoned','cancelled'))::int AS abandoned_or_failed,
        COUNT(*) FILTER (WHERE status IN ('refund_pending','refund_failed','refunded'))::int AS refunds,
        COUNT(*) FILTER (WHERE status='pending'
          AND updated_at < NOW() - INTERVAL '10 minutes')::int AS stale_sessions,
        COUNT(*) FILTER (WHERE reconciliation_status NOT IN ('terminal','pending_gateway')
          AND reconciliation_status IS NOT NULL)::int AS reconciliation_failures
      FROM payments
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='processed')::int AS processed,
        COUNT(*) FILTER (WHERE status='failed')::int AS failed,
        COUNT(*) FILTER (WHERE status='processing')::int AS processing,
        COUNT(*) FILTER (WHERE attempts > 1)::int AS retried
      FROM cashfree_webhook_events
      WHERE received_at > NOW() - INTERVAL '24 hours'
    `),
    pool.query(`
      SELECT p.order_id, p.reservation_id, p.status, p.gateway_status,
             p.reconciliation_status, p.reconciliation_attempts,
             r.payment_expires_at
      FROM payments p
      LEFT JOIN reservations r ON r.id=p.reservation_id
      WHERE p.status='pending'
      AND COALESCE(r.payment_expires_at, p.created_at + INTERVAL '10 minutes') <= NOW()
      ORDER BY COALESCE(r.payment_expires_at, p.created_at) ASC
      LIMIT 20
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE p.reservation_id IS NOT NULL AND r.id IS NULL)::int AS orphan_payments,
        COUNT(*) FILTER (
          WHERE r.id IS NOT NULL
          AND (
            (p.status='paid' AND r.payment_status NOT IN ('paid','refunded','refund_pending','refund_failed'))
            OR (p.status IN ('failed','expired','abandoned','cancelled') AND r.payment_status='pending')
            OR (p.status='refunded' AND r.payment_status <> 'refunded')
          )
        )::int AS reservation_payment_mismatches,
        COUNT(*) FILTER (
          WHERE p.status='pending'
          AND p.created_at < NOW() - INTERVAL '30 minutes'
        )::int AS aged_pending_payments,
        COUNT(*) FILTER (
          WHERE p.reconciliation_status IS NOT NULL
          AND p.reconciliation_status NOT IN ('terminal','pending_gateway')
        )::int AS reconciliation_attention_required
      FROM payments p
      LEFT JOIN reservations r ON r.id=p.reservation_id
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('creating','gateway_created','db_inserted','recovery_pending'))::int AS recoverable,
        COUNT(*) FILTER (WHERE status='manual_review_required')::int AS manual_review_required,
        COUNT(*) FILTER (
          WHERE status IN ('creating','gateway_created','db_inserted','recovery_pending')
          AND updated_at < NOW() - INTERVAL '10 minutes'
        )::int AS stuck
      FROM payment_order_attempts
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE refund_id IS NOT NULL
          AND status IN ('refund_pending','refund_failed')
          AND COALESCE(last_reconciled_at, updated_at, created_at) < NOW() - INTERVAL '10 minutes'
        )::int AS stale_payment_refunds,
        COUNT(*) FILTER (
          WHERE reliability_deposit_refund_id IS NOT NULL
          AND reliability_deposit_status IN ('refund_pending','refund_failed')
          AND COALESCE(last_reconciled_at, updated_at, created_at) < NOW() - INTERVAL '10 minutes'
        )::int AS stale_deposit_refunds,
        COUNT(*) FILTER (
          WHERE status='refund_pending'
          AND refund_id IS NULL
        )::int AS orphan_refund_pending_without_refund_id
      FROM payments
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS transitions_24h,
        COUNT(*) FILTER (
          WHERE new_payment_status IN ('refund_pending','refund_failed','refunded')
          AND created_at > NOW() - INTERVAL '24 hours'
        )::int AS refund_transitions_24h
      FROM financial_state_transitions
    `),
  ]);

  return {
    summary: payments.rows[0],
    webhooks: webhooks.rows[0],
    diagnostics: diagnostics.rows[0],
    order_attempts: orderAttempts.rows[0],
    refunds: refunds.rows[0],
    transitions: transitions.rows[0],
    stale_sessions: stale.rows,
  };
}

module.exports = {
  getPaymentHealth,
};
