const { Worker } = require("bullmq");
const crypto = require("crypto");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");
const cashfree = require("../shared/config/cashfree");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const {
  publishPaymentUpdated,
  publishReservationUpdated,
} = require("../shared/services/realtime.service");
const {
  ensurePaymentHardeningSchema,
} = require("../shared/services/paymentReconciliation.service");
const {
  lockReservationGraph,
} = require("../shared/services/reservationConsistency.service");

logger.info("Refund worker started");

const FINAL_REFUND_STATES = new Set(["refunded"]);
const REFUNDABLE_PAYMENT_STATES = new Set([
  "paid",
  "success",
  "refund_pending",
  "refund_failed",
]);

function normalizeRefundStatus(status) {
  const normalized = String(status || "").toUpperCase();

  if (normalized === "SUCCESS") return "refunded";
  if (normalized === "FAILED" || normalized === "CANCELLED") {
    return "refund_failed";
  }

  return "refund_pending";
}

async function markRefundFailed(reservationId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { payment } = await lockReservationGraph(client, reservationId, {
      lockPayments: true,
    });

    if (!payment) {
      await client.query("ROLLBACK");
      return;
    }

    if (FINAL_REFUND_STATES.has(payment.status)) {
      await client.query("ROLLBACK");
      return;
    }

    await client.query(
      `
      UPDATE payments
      SET status='refund_failed',
          refund_status='refund_failed',
          updated_at=NOW()
      WHERE id=$1
      `,
      [payment.id]
    );

    await client.query(
      `
      UPDATE reservations
      SET payment_status='refund_failed'
      WHERE id=$1
      AND payment_status <> 'refunded'
      `,
      [reservationId]
    );

    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: "refund_failed" }),
      publishPaymentUpdated(reservationId, { action: "refund_failed" }),
    ]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function persistRefundStatus(reservationId, refundStatus) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { payment } = await lockReservationGraph(client, reservationId, {
      lockPayments: true,
    });

    if (!payment) {
      await client.query("ROLLBACK");
      return;
    }

    if (FINAL_REFUND_STATES.has(payment.status)) {
      await client.query("ROLLBACK");
      return;
    }

    if (refundStatus === "refunded") {
      await client.query(
        `
        UPDATE payments
        SET status='refunded',
            refund_status='refunded',
            reliability_deposit_status = CASE
              WHEN reliability_deposit_amount > 0 THEN 'refunded'
              ELSE reliability_deposit_status
            END,
            reliability_deposit_refunded_at = CASE
              WHEN reliability_deposit_amount > 0 THEN NOW()
              ELSE reliability_deposit_refunded_at
            END,
            updated_at=NOW()
        WHERE id=$1
        `,
        [payment.id]
      );

      await client.query(
        `
        UPDATE reservations
        SET payment_status='refunded'
        WHERE id=$1
        `,
        [reservationId]
      );
    } else if (refundStatus === "refund_failed") {
      await client.query(
        `
        UPDATE payments
        SET status='refund_failed',
            refund_status='refund_failed',
            updated_at=NOW()
        WHERE id=$1
        `,
        [payment.id]
      );

      await client.query(
        `
        UPDATE reservations
        SET payment_status='refund_failed'
        WHERE id=$1
        AND payment_status <> 'refunded'
        `,
        [reservationId]
      );
    } else {
      await client.query(
        `
        UPDATE payments
        SET status='refund_pending',
            refund_status='refund_pending',
            updated_at=NOW()
        WHERE id=$1
        `,
        [payment.id]
      );

      await client.query(
        `
        UPDATE reservations
        SET payment_status='refund_pending'
        WHERE id=$1
        AND payment_status NOT IN ('refunded', 'refund_failed')
        `,
        [reservationId]
      );
    }

    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: refundStatus }),
      publishPaymentUpdated(reservationId, { action: refundStatus }),
    ]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function markDepositRefundFailed(reservationId) {
  const client = await pool.connect();

  try {
    await ensurePaymentHardeningSchema(client);
    await client.query("BEGIN");
    await client.query(
      `
      UPDATE payments
      SET reliability_deposit_status='refund_failed',
          updated_at=NOW()
      WHERE reservation_id=$1
      AND reliability_deposit_amount > 0
      AND reliability_deposit_status <> 'refunded'
      `,
      [reservationId]
    );
    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: "deposit_refund_failed" }),
      publishPaymentUpdated(reservationId, { action: "deposit_refund_failed" }),
    ]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function persistDepositRefundStatus(reservationId, refundStatus) {
  const client = await pool.connect();

  try {
    await ensurePaymentHardeningSchema(client);
    await client.query("BEGIN");

    if (refundStatus === "refunded") {
      await client.query(
        `
        UPDATE payments
        SET reliability_deposit_status='refunded',
            reliability_deposit_refunded_at=NOW(),
            updated_at=NOW()
        WHERE reservation_id=$1
        AND reliability_deposit_amount > 0
        `,
        [reservationId]
      );
    } else if (refundStatus === "refund_failed") {
      await client.query(
        `
        UPDATE payments
        SET reliability_deposit_status='refund_failed',
            updated_at=NOW()
        WHERE reservation_id=$1
        AND reliability_deposit_amount > 0
        AND reliability_deposit_status <> 'refunded'
        `,
        [reservationId]
      );
    } else {
      await client.query(
        `
        UPDATE payments
        SET reliability_deposit_status='refund_pending',
            updated_at=NOW()
        WHERE reservation_id=$1
        AND reliability_deposit_amount > 0
        AND reliability_deposit_status <> 'refunded'
        `,
        [reservationId]
      );
    }

    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: `deposit_${refundStatus}` }),
      publishPaymentUpdated(reservationId, { action: `deposit_${refundStatus}` }),
    ]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function prepareDepositRefund(reservationId) {
  const client = await pool.connect();

  try {
    await ensurePaymentHardeningSchema(client);
    await client.query("BEGIN");

    const { payment } = await lockReservationGraph(client, reservationId, {
      lockPayments: true,
    });

    if (!payment) {
      await client.query("ROLLBACK");
      return null;
    }

    const amount = Number(payment.reliability_deposit_amount || 0);

    if (
      amount <= 0 ||
      payment.status !== "paid" ||
      payment.reliability_deposit_status === "refunded" ||
      payment.reliability_deposit_status === "retained"
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    const refundId = payment.reliability_deposit_refund_id || crypto.randomUUID();

      await client.query(
        `
        UPDATE payments
        SET reliability_deposit_status='refund_pending',
            reliability_deposit_refund_id=$1,
            reliability_deposit_refund_attempts=COALESCE(reliability_deposit_refund_attempts, 0) + 1,
            updated_at=NOW()
        WHERE id=$2
      `,
      [refundId, payment.id]
    );

    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: "deposit_refund_pending" }),
      publishPaymentUpdated(reservationId, { action: "deposit_refund_pending" }),
    ]);

    return {
      orderId: payment.order_id,
      refundId,
      amount,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function prepareRefund(reservationId) {
  const client = await pool.connect();

  try {
    await ensurePaymentHardeningSchema(client);
    await client.query("BEGIN");

    const { reservation, payment } = await lockReservationGraph(client, reservationId, {
      lockPayments: true,
    });

    if (!payment || !reservation) {
      await client.query("ROLLBACK");
      return null;
    }

    payment.reservation_status = reservation.status;
    payment.reservation_payment_status = reservation.payment_status;

    if (
      payment.status === "refunded" ||
      payment.refund_status === "refunded" ||
      payment.reservation_payment_status === "refunded"
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    if (
      payment.reservation_status !== "cancelled" ||
      !REFUNDABLE_PAYMENT_STATES.has(payment.status)
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    const refundId = payment.refund_id || crypto.randomUUID();

    await client.query(
      `
      UPDATE payments
      SET status='refund_pending',
          refund_status='refund_pending',
          refund_id=$1,
          refund_attempts=COALESCE(refund_attempts, 0) + 1,
          updated_at=NOW()
      WHERE id=$2
      `,
      [refundId, payment.id]
    );

    await client.query(
      `
      UPDATE reservations
      SET payment_status='refund_pending'
      WHERE id=$1
      AND payment_status NOT IN ('refunded', 'refund_failed')
      `,
      [reservationId]
    );

    await client.query("COMMIT");
    await Promise.all([
      publishReservationUpdated(reservationId, { action: "refund_pending" }),
      publishPaymentUpdated(reservationId, { action: "refund_pending" }),
    ]);

    return {
      orderId: payment.order_id,
      refundId,
      amount: Number(payment.amount),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const refundWorker = new Worker(
  "refund-queue",
  withWorkerBoundary("refund-queue", async (job) => {
    const { reservationId, refundType } = job.data;
    if (refundType === "reliability_deposit") {
      const refund = await prepareDepositRefund(reservationId);

      if (!refund) return;

      try {
        const response = await cashfree.PGOrderCreateRefund(
          refund.orderId,
          {
            refund_id: refund.refundId,
            refund_amount: refund.amount,
            refund_note: "Refundable reliability deposit returned after successful pickup",
          },
          undefined,
          refund.refundId
        );

        const refundStatus = normalizeRefundStatus(response.data?.refund_status);
        await persistDepositRefundStatus(reservationId, refundStatus);
      } catch (err) {
        const attempts = job.opts.attempts || 5;
        const isLastAttempt = job.attemptsMade + 1 >= attempts;

        logger.error("Reliability deposit refund failed", {
          err,
          reservationId,
          orderId: refund.orderId,
          refundId: refund.refundId,
          attemptsMade: job.attemptsMade,
          attempts,
        });

        if (isLastAttempt) {
          await markDepositRefundFailed(reservationId);
        }

        throw err;
      }

      return;
    }

    const refund = await prepareRefund(reservationId);

    if (!refund) return;

    try {
      const response = await cashfree.PGOrderCreateRefund(
        refund.orderId,
        {
          refund_id: refund.refundId,
          refund_amount: refund.amount,
          refund_note: "Reservation cancelled before pickup cutoff",
        },
        undefined,
        refund.refundId
      );

      const refundStatus = normalizeRefundStatus(response.data?.refund_status);
      await persistRefundStatus(reservationId, refundStatus);
    } catch (err) {
      const attempts = job.opts.attempts || 5;
      const isLastAttempt = job.attemptsMade + 1 >= attempts;

      logger.error("Refund execution failed", {
        err,
        reservationId,
        orderId: refund.orderId,
        refundId: refund.refundId,
        attemptsMade: job.attemptsMade,
        attempts,
      });

      if (isLastAttempt) {
        await markRefundFailed(reservationId);
      }

      throw err;
    }
  }),
  workerOptions(connection)
);

registerWorkerEvents(refundWorker, "refund-queue");
