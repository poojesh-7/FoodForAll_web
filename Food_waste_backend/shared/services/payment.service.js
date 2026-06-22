const cashfree = require("../config/cashfree");
const paymentQueue = require("../../queues/payment.queue");
const crypto = require("crypto");
const logger = require("../utils/logger");
const { PaymentError } = require("../utils/errors");
const { jobOptions } = require("../utils/queueOptions");
const { operationalPolicy } = require("../config/operationalPolicy");
const {
  recordAlert,
  recordOperationalEvent,
} = require("./observability.service");
const { ensureRestrictionSchema } = require("./restrictionSchema.service");
const {
  ensurePaymentHardeningSchema,
  markPaymentOrderAttemptDbInserted,
  markPaymentOrderAttemptFailed,
  markPaymentOrderAttemptGatewayCreated,
  recordPaymentOrderAttempt,
} = require("./paymentReconciliation.service");
const { assertPaymentAuthorization } = require("./authorization.service");
const {
  createFinancialOwnershipSnapshot,
} = require("./financialOwnership.service");
const {
  prepareLifecycleAccounting,
} = require("./lifecycleAccounting.service");
const {
  markFinancialOperationStatus,
} = require("./refundExecution.service");
const {
  buildPaymentFinancialTerms,
} = require("./financialLedger.service");

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function getReservationComponent(reservation, key, fallback = 0) {
  return roundMoney(reservation?.[key] ?? fallback);
}

async function createPayment({
  client,
  user,
  reservations,
  totalAmount,
  totalFoodAmount,
  reliabilityDepositAmount,
}) {
  await ensurePaymentHardeningSchema(client);
  const orderId = `order_${crypto.randomUUID()}`;
  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000")
    .replace(/\/+$/, "");
  const returnUrl = new URL("/payment-success", frontendUrl);
  returnUrl.searchParams.set("order_id", orderId);

  if (reservations.length === 1 && reservations[0]?.id) {
    returnUrl.searchParams.set("reservation_id", String(reservations[0].id));
  }

  const fallbackFoodAmount =
    reservations.length === 1 ? roundMoney(totalFoodAmount ?? totalAmount) : 0;
  const fallbackDepositAmount =
    reservations.length === 1 ? roundMoney(reliabilityDepositAmount) : 0;
  const reservationsWithFinancialTerms = reservations.map((reservation) => {
    const foodAmount = getReservationComponent(
      reservation,
      "food_amount",
      fallbackFoodAmount
    );
    const depositAmount = getReservationComponent(
      reservation,
      "reliability_deposit_amount",
      fallbackDepositAmount
    );

    return {
      ...reservation,
      food_amount: foodAmount,
      reliability_deposit_amount: depositAmount,
      financial_terms: buildPaymentFinancialTerms({ foodAmount }),
    };
  });

  try {
    await recordPaymentOrderAttempt({
      client,
      orderId,
      user,
      reservations: reservationsWithFinancialTerms,
      amount: totalAmount,
      currency: "INR",
    });

    logger.payment("Payment order creation initiated", {
      userId: user?.id,
      orderId,
      reservationIds: reservationsWithFinancialTerms.map((reservation) => reservation.id),
      amount: totalAmount,
    });
    const response = await cashfree.PGCreateOrder({
      order_id: orderId,
      order_amount: roundMoney(totalAmount),
      order_currency: "INR",
      customer_details: {
        customer_id: user.id.toString(),
        customer_email: user.email || "test@gmail.com",
        customer_phone: user.phone || "9999999999",
      },
      order_meta: {
        return_url: returnUrl.toString(),
      },
    });

    const paymentSessionId = response.data.payment_session_id;
    await markPaymentOrderAttemptGatewayCreated({
      client,
      orderId,
      paymentSessionId,
      gatewayResponse: response.data,
    });

    for (const reservation of reservationsWithFinancialTerms) {
      const foodAmount = getReservationComponent(
        reservation,
        "food_amount",
        fallbackFoodAmount
      );
      const depositAmount = getReservationComponent(
        reservation,
        "reliability_deposit_amount",
        fallbackDepositAmount
      );
      const rowAmount = roundMoney(foodAmount + depositAmount);
      const financialTerms =
        reservation.financial_terms || buildPaymentFinancialTerms({ foodAmount });

      const paymentRow = await client.query(
        `
        INSERT INTO payments
        (reservation_id, order_id, payment_session_id, amount, status,
         food_amount, reliability_deposit_amount, reliability_deposit_status,
         commission_percent, commission_amount, provider_amount,
         food_amount_snapshot, platform_amount, gateway_provider, gateway_order_id)
        VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING *
        `,
        [
          reservation.id,
          orderId,
          paymentSessionId,
          rowAmount,
          foodAmount,
          depositAmount,
          depositAmount > 0 ? "held" : "not_required",
          financialTerms.commission_percent,
          financialTerms.commission_amount,
          financialTerms.provider_amount,
          financialTerms.food_amount_snapshot,
          financialTerms.platform_amount,
          "cashfree",
          orderId,
        ]
      );

      await createFinancialOwnershipSnapshot({
        client,
        user,
        payer: user,
        reservation,
        payment: paymentRow.rows[0],
        foodAmount,
        depositAmount,
        commissionAmount: financialTerms.commission_amount,
        currency: "INR",
        sourceMetadata: {
          order_id: orderId,
          payment_session_id: paymentSessionId,
          commission_percent: financialTerms.commission_percent,
          provider_amount: financialTerms.provider_amount,
          food_amount_snapshot: financialTerms.food_amount_snapshot,
          platform_amount: financialTerms.platform_amount,
        },
      });
    }

    await markPaymentOrderAttemptDbInserted({ client, orderId });

    const expiryTime = new Date(Date.now() + operationalPolicy.payment.holdTimeoutMs);

    for (const reservation of reservationsWithFinancialTerms) {
      await client.query(
        `UPDATE reservations SET payment_expires_at=$1 WHERE id=$2`,
        [expiryTime, reservation.id]
      );
    }

    await paymentQueue
      .add(
        "payment-timeout",
        {
          reservationIds: reservationsWithFinancialTerms.map(
            (reservation) => reservation.id
          ),
          userId: user?.id,
          orderId,
          paymentSessionId,
        },
        jobOptions("critical", {
          delay: operationalPolicy.payment.holdTimeoutMs,
          jobId: `payment-batch-${orderId}`,
        })
      )
      .catch((err) => {
        logger.error("Payment timeout enqueue failed; reconciliation sweep will recover", {
          err,
          orderId,
          reservationIds: reservationsWithFinancialTerms.map(
            (reservation) => reservation.id
          ),
        });
        void recordAlert({
          alertKey: "payment:timeout_enqueue_failure",
          category: "payment",
          severity: "error",
          message: "Payment timeout queue enqueue failed",
          metadata: {
            orderId,
            reservationIds: reservationsWithFinancialTerms.map(
              (reservation) => reservation.id
            ),
            message: err?.message,
          },
        });
      });

    void recordOperationalEvent({
      category: "payment",
      severity: "info",
      eventName: "payment_initiated",
      metadata: {
        orderId,
        reservationIds: reservationsWithFinancialTerms.map(
          (reservation) => reservation.id
        ),
        amount: roundMoney(totalAmount),
      },
    });

    return {
      order_id: orderId,
      payment_session_id: paymentSessionId,
      amount: roundMoney(totalAmount),
      food_amount: roundMoney(totalFoodAmount ?? totalAmount),
      reliability_deposit_amount: roundMoney(reliabilityDepositAmount),
    };
  } catch (err) {
    await markPaymentOrderAttemptFailed({ client, orderId, err }).catch((markErr) => {
      logger.warn("Payment order attempt failure mark failed", {
        err: markErr,
        orderId,
      });
    });
    const paymentError = new PaymentError("Cashfree order creation failed", {
      details: { orderId },
    });
    logger.error("Cashfree order creation failed", {
      err,
      userId: user?.id,
      reservationIds: reservationsWithFinancialTerms.map(
        (reservation) => reservation.id
      ),
      amount: totalAmount,
    });
    void recordAlert({
      alertKey: "payment:order_creation_failure",
      category: "payment",
      severity: "error",
      message: "Cashfree order creation failed",
      metadata: {
        orderId,
        userId: user?.id,
        reservationIds: reservationsWithFinancialTerms.map(
          (reservation) => reservation.id
        ),
        message: err?.message,
      },
    });
    throw paymentError;
  }
}

async function createReservationPayment(options) {
  const reservations = options.reservations.map((reservation) => ({
    ...reservation,
    food_amount: roundMoney(reservation.food_amount),
    reliability_deposit_amount: roundMoney(reservation.reliability_deposit_amount),
  }));

  assertPaymentAuthorization({
    user: options.user,
    reservations,
  });

  const totalFoodAmount = reservations.reduce(
    (sum, reservation) => sum + roundMoney(reservation.food_amount),
    0
  );
  const reliabilityDepositAmount = reservations.reduce(
    (sum, reservation) => sum + roundMoney(reservation.reliability_deposit_amount),
    0
  );

  return createPayment({
    ...options,
    reservations,
    totalFoodAmount,
    reliabilityDepositAmount,
    totalAmount: totalFoodAmount + reliabilityDepositAmount,
  });
}

function createReliabilityDeposit({ role, amount }) {
  const depositAmount = roundMoney(amount);
  return {
    role,
    amount: depositAmount,
    required: depositAmount > 0,
    refundable: true,
  };
}

async function refundReliabilityDeposit(refundQueue, reservationId, options = {}) {
  await refundQueue.add(
    "refund-reliability-deposit",
    {
      reservationId,
      refundType: "reliability_deposit",
      operationSource: options.operationSource || options.operation_source || null,
    },
    jobOptions("critical", {
      jobId: `deposit-refund-${reservationId}`,
    })
  );
}

async function retainReliabilityDeposit(client, reservationId, options = {}) {
  await ensureRestrictionSchema(client);
  const paymentRes = await client.query(
    `
    SELECT *
    FROM payments
    WHERE reservation_id=$1
    ORDER BY created_at NULLS LAST, id
    LIMIT 1
    FOR UPDATE
    `,
    [reservationId]
  );

  if (!paymentRes.rows.length) return;

  const payment = paymentRes.rows[0];
  const reservation = {
    id: reservationId,
    ...(options.reservation || {}),
  };
  const accounting = await prepareLifecycleAccounting({
    client,
    reservation,
    payment,
    terminalReason: options.terminalReason || "user_failed_pickup",
    actorContext: options.actorContext || { role: "system" },
    metadata: {
      service: "payment.service",
      reason: "reliability_deposit_retained",
    },
  });

  if (accounting.operationType === "lifecycle_accounting") return;
  if (!accounting.shouldExecute) return;

  const retained = await client.query(
    `
    UPDATE payments
    SET reliability_deposit_status='retained',
        reliability_deposit_retained_at=NOW(),
        updated_at=NOW()
    WHERE id=$1
    AND reliability_deposit_amount > 0
    AND reliability_deposit_status IN ('held','refund_failed','retained')
    `,
    [payment.id]
  );

  if (!retained.rowCount) {
    throw new Error("Reliability deposit is not in a retainable state");
  }

  await markFinancialOperationStatus({
    client,
    operationId: accounting.operation.id,
    status: "retained",
    metadata: {
      retained_at: new Date().toISOString(),
    },
  });
  logger.payment("Reliability deposit retained from ownership snapshot", {
    reservationId,
    paymentId: payment.id,
    paymentOwnershipId: accounting.paymentOwnership.id,
    amount: accounting.operation.amount,
    operationSource: accounting.operationSource,
  });
  void recordOperationalEvent({
    category: "payment",
    severity: "info",
    eventName: "reliability_deposit_retained",
    metadata: {
      reservationId,
      paymentId: payment.id,
      paymentOwnershipId: accounting.paymentOwnership.id,
      amount: accounting.operation.amount,
      operationSource: accounting.operationSource,
    },
  });
}

async function cancelPayment(client, reservationId) {
  await ensurePaymentHardeningSchema(client);
  await ensureRestrictionSchema(client);
  const paymentRes = await client.query(
    `SELECT * FROM payments WHERE reservation_id=$1 FOR UPDATE`,
    [reservationId]
  );

  if (!paymentRes.rows.length) return;

  const payment = paymentRes.rows[0];

  if (["paid", "refunded"].includes(payment.status)) return;

  await client.query(
    `UPDATE payments SET status='failed', updated_at=NOW() WHERE id=$1`,
    [payment.id]
  );

  logger.payment("Payment cancelled", { reservationId, paymentId: payment.id });
  void recordOperationalEvent({
    category: "payment",
    severity: "warning",
    eventName: "payment_cancelled",
    metadata: { reservationId, paymentId: payment.id },
  });
}

module.exports = {
  createPayment,
  createReservationPayment,
  createReliabilityDeposit,
  refundReliabilityDeposit,
  retainReliabilityDeposit,
  cancelPayment,
};
