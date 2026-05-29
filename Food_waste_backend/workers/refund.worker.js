const { Worker } = require("bullmq");
const crypto = require("crypto");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");
const cashfree = require("../shared/config/cashfree");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { jobOptions, workerOptions } = require("../shared/utils/queueOptions");
const { withWorkerBoundary } = require("../shared/utils/workerBoundary");
const {
  publishPaymentUpdated,
  publishReservationUpdated,
} = require("../shared/services/realtime.service");
const {
  ensurePaymentHardeningSchema,
  reconcilePendingRefunds,
  reconcileRefundAgainstGateway,
} = require("../shared/services/paymentReconciliation.service");
const {
  prepareLifecycleAccounting,
} = require("../shared/services/lifecycleAccounting.service");
const {
  markFinancialOperationStatus,
  operationStatusFromRefundStatus,
} = require("../shared/services/refundExecution.service");
const {
  lockReservationGraph,
} = require("../shared/services/reservationConsistency.service");

logger.info("Refund worker started");

const refundQueue = require("../queues/refund.queue");

const FINAL_REFUND_STATES = new Set(["refunded"]);
const REFUNDABLE_PAYMENT_STATES = new Set([
  "paid",
  "success",
  "refund_pending",
  "refund_failed",
]);

refundQueue
  .add(
    "refund-reconciliation-sweep",
    {},
    jobOptions("critical", {
      jobId: "refund-reconciliation-sweep",
      repeat: { every: 10 * 60 * 1000 },
      removeOnComplete: { age: 60 * 60, count: 24 },
      removeOnFail: { age: 24 * 60 * 60, count: 100 },
    })
  )
  .catch((err) => {
    logger.warn("Refund reconciliation sweep scheduling failed", { err });
  });

function normalizeRefundStatus(status) {
  const normalized = String(status || "").toUpperCase();

  if (normalized === "SUCCESS") return "refunded";
  if (normalized === "FAILED" || normalized === "CANCELLED") {
    return "refund_failed";
  }

  return "refund_pending";
}

function refundPlanAmount(plan) {
  return Math.round(
    (plan.refunds || []).reduce((sum, refund) => {
      const amount = Number(refund.amount);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0) * 100
  ) / 100;
}

async function markOperationStatusSafely(options) {
  try {
    await markFinancialOperationStatus(options);
  } catch (err) {
    logger.warn("Financial operation status update failed", {
      err,
      operationId: options.operationId,
      status: options.status,
    });
  }
}

async function reconcileRefundErrorWithGateway(refund, source) {
  try {
    const reconciled = await reconcileRefundAgainstGateway({
      orderId: refund.orderId,
      refundId: refund.refundId,
      source,
    });

    return reconciled.gatewayStatus !== "UNKNOWN" ? reconciled : null;
  } catch (err) {
    logger.warn("Refund error gateway reconciliation failed", {
      err,
      orderId: refund.orderId,
      refundId: refund.refundId,
      source,
    });
    return null;
  }
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

async function prepareDepositRefund(reservationId, operationSource) {
  const client = await pool.connect();

  try {
    await ensurePaymentHardeningSchema(client);
    await client.query("BEGIN");

    const { reservation, payment } = await lockReservationGraph(client, reservationId, {
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
    const accounting = await prepareLifecycleAccounting({
      client,
      reservation,
      payment,
      terminalReason:
        operationSource ||
        (reservation.pickup_type === "ngo"
          ? "successful_delivery"
          : "successful_pickup"),
      lifecycleState: {
        refundType: "reliability_deposit",
        outcome: "success",
      },
      refundId,
      metadata: {
        queue: "refund-queue",
        worker: "refund.worker",
      },
    });
    const refundAmount = refundPlanAmount(accounting.plan);

    if (refundAmount <= 0) {
      await client.query("ROLLBACK");
      return null;
    }

    if (!accounting.shouldExecute) {
      await client.query("ROLLBACK");
      return null;
    }

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
      amount: refundAmount,
      operationId: accounting.operation.id,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function prepareRefund(reservationId, operationSource) {
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
    const accounting = await prepareLifecycleAccounting({
      client,
      reservation,
      payment,
      terminalReason:
        operationSource ||
        (reservation.pickup_type === "ngo" ? "ngo_cancelled" : "user_cancelled"),
      lifecycleState: {
        refundType: "payment",
        outcome: "cancellation",
      },
      refundId,
      metadata: {
        queue: "refund-queue",
        worker: "refund.worker",
      },
    });
    const refundAmount = refundPlanAmount(accounting.plan);

    if (refundAmount <= 0 || !accounting.shouldExecute) {
      await client.query("ROLLBACK");
      return null;
    }

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
      amount: refundAmount,
      operationId: accounting.operation.id,
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
    if (job.name === "refund-reconciliation-sweep") {
      const results = await reconcilePendingRefunds();
      logger.info("Refund reconciliation sweep completed", {
        reconciledRefunds: results.length,
      });
      return;
    }

    const { reservationId, refundType } = job.data;
    if (refundType === "reliability_deposit") {
      const refund = await prepareDepositRefund(reservationId, job.data.operationSource);

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
        await markOperationStatusSafely({
          client: pool,
          operationId: refund.operationId,
          status: operationStatusFromRefundStatus(refundStatus),
          metadata: {
            refund_id: refund.refundId,
            gateway_status: response.data?.refund_status || null,
          },
        });
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

        const reconciled = await reconcileRefundErrorWithGateway(
          refund,
          "deposit_refund_worker_error"
        );
        if (reconciled) {
          await markOperationStatusSafely({
            client: pool,
            operationId: refund.operationId,
            status: operationStatusFromRefundStatus(reconciled.normalizedStatus),
            metadata: {
              refund_id: refund.refundId,
              gateway_status: reconciled.gatewayStatus,
              recovered_after_error: true,
            },
          });
          return;
        }

        if (isLastAttempt) {
          await markOperationStatusSafely({
            client: pool,
            operationId: refund.operationId,
            status: "processing",
            metadata: {
              refund_id: refund.refundId,
              error: err?.message,
              attempts_made: job.attemptsMade + 1,
              gateway_status: "unknown_after_retry_exhaustion",
            },
          });
        }

        throw err;
      }

      return;
    }

    const refund = await prepareRefund(reservationId, job.data.operationSource);

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
      await markOperationStatusSafely({
        client: pool,
        operationId: refund.operationId,
        status: operationStatusFromRefundStatus(refundStatus),
        metadata: {
          refund_id: refund.refundId,
          gateway_status: response.data?.refund_status || null,
        },
      });
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

      const reconciled = await reconcileRefundErrorWithGateway(
        refund,
        "payment_refund_worker_error"
      );
      if (reconciled) {
        await markOperationStatusSafely({
          client: pool,
          operationId: refund.operationId,
          status: operationStatusFromRefundStatus(reconciled.normalizedStatus),
          metadata: {
            refund_id: refund.refundId,
            gateway_status: reconciled.gatewayStatus,
            recovered_after_error: true,
          },
        });
        return;
      }

      if (isLastAttempt) {
        await markOperationStatusSafely({
          client: pool,
          operationId: refund.operationId,
          status: "processing",
          metadata: {
            refund_id: refund.refundId,
            error: err?.message,
            attempts_made: job.attemptsMade + 1,
            gateway_status: "unknown_after_retry_exhaustion",
          },
        });
      }

      throw err;
    }
  }),
  workerOptions(connection)
);

registerWorkerEvents(refundWorker, "refund-queue");
