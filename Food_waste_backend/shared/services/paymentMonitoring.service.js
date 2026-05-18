const pool = require("../config/db");
const { ensurePaymentHardeningSchema } = require("./paymentReconciliation.service");

async function getPaymentHealth() {
  await ensurePaymentHardeningSchema();

  const [payments, webhooks, stale] = await Promise.all([
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
  ]);

  return {
    summary: payments.rows[0],
    webhooks: webhooks.rows[0],
    stale_sessions: stale.rows,
  };
}

module.exports = {
  getPaymentHealth,
};
