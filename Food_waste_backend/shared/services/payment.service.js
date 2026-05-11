const cashfree = require("../config/cashfree");
const paymentQueue = require("../../queues/payment.queue");
const crypto = require("crypto");
const logger = require("../utils/logger");

async function createPayment({
  client,
  user,
  reservations,
  totalAmount,
}) {
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
      order_amount: totalAmount,
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

    for (const reservation of reservations) {
      await client.query(
        `
        INSERT INTO payments
        (reservation_id, order_id, payment_session_id, amount, status)
        VALUES ($1,$2,$3,$4,'pending')
        `,
        [reservation.id, orderId, paymentSessionId, totalAmount]
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
      amount: totalAmount,
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

async function cancelPayment(client, reservationId) {
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

module.exports = { createPayment, cancelPayment };
