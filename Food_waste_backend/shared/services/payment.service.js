const cashfree = require("../config/cashfree");
const paymentQueue = require("../../queues/payment.queue");
const crypto = require("crypto");
const logger = require("../utils/logger");
const { ensureRestrictionSchema } = require("./restrictionSchema.service");

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
  await ensureRestrictionSchema(client);
  const orderId = `order_${crypto.randomUUID()}`;
  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000")
    .replace(/\/+$/, "");
  const returnUrl = new URL("/payment-success", frontendUrl);
  returnUrl.searchParams.set("order_id", orderId);

  if (reservations.length === 1 && reservations[0]?.id) {
    returnUrl.searchParams.set("reservation_id", String(reservations[0].id));
  }

  try {
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

    const fallbackFoodAmount =
      reservations.length === 1 ? roundMoney(totalFoodAmount ?? totalAmount) : 0;
    const fallbackDepositAmount =
      reservations.length === 1 ? roundMoney(reliabilityDepositAmount) : 0;

    for (const reservation of reservations) {
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

      await client.query(
        `
        INSERT INTO payments
        (reservation_id, order_id, payment_session_id, amount, status,
         food_amount, reliability_deposit_amount, reliability_deposit_status)
        VALUES ($1,$2,$3,$4,'pending',$5,$6,$7)
        `,
        [
          reservation.id,
          orderId,
          paymentSessionId,
          rowAmount,
          foodAmount,
          depositAmount,
          depositAmount > 0 ? "held" : "not_required",
        ]
      );
    }

    const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

    for (const reservation of reservations) {
      await client.query(
        `UPDATE reservations SET payment_expires_at=$1 WHERE id=$2`,
        [expiryTime, reservation.id]
      );
    }

    await paymentQueue.add(
      "payment-timeout",
      { reservationIds: reservations.map((reservation) => reservation.id) },
      {
        delay: 10 * 60 * 1000,
        jobId: `payment-batch-${orderId}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 3000 },
      }
    );

    return {
      order_id: orderId,
      payment_session_id: paymentSessionId,
      amount: roundMoney(totalAmount),
      food_amount: roundMoney(totalFoodAmount ?? totalAmount),
      reliability_deposit_amount: roundMoney(reliabilityDepositAmount),
    };
  } catch (err) {
    logger.error("Cashfree order creation failed", {
      err,
      userId: user?.id,
      reservationIds: reservations.map((reservation) => reservation.id),
      amount: totalAmount,
    });
    throw err;
  }
}

async function createReservationPayment(options) {
  const reservations = options.reservations.map((reservation) => ({
    ...reservation,
    food_amount: roundMoney(reservation.food_amount),
    reliability_deposit_amount: roundMoney(reservation.reliability_deposit_amount),
  }));
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

async function refundReliabilityDeposit(refundQueue, reservationId) {
  await refundQueue.add(
    "refund-reliability-deposit",
    { reservationId, refundType: "reliability_deposit" },
    {
      jobId: `deposit-refund-${reservationId}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
    }
  );
}

async function retainReliabilityDeposit(client, reservationId) {
  await ensureRestrictionSchema(client);
  await client.query(
    `
    UPDATE payments
    SET reliability_deposit_status='retained',
        reliability_deposit_retained_at=NOW(),
        updated_at=NOW()
    WHERE reservation_id=$1
    AND reliability_deposit_amount > 0
    AND reliability_deposit_status IN ('held','refund_failed')
    `,
    [reservationId]
  );
}

async function cancelPayment(client, reservationId) {
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

  logger.info("Payment cancelled", { reservationId, paymentId: payment.id });
}

module.exports = {
  createPayment,
  createReservationPayment,
  createReliabilityDeposit,
  refundReliabilityDeposit,
  retainReliabilityDeposit,
  cancelPayment,
};
