const cashfree = require("../config/cashfree");
const paymentQueue = require("../../queues/payment.queue");

async function createPayment({
  client,
  user,
  reservations,
  totalAmount,
}) {

  const orderId = `order_${Date.now()}`;

  /*
  1️⃣ Create Cashfree Order
  */
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
          return_url: `${process.env.FRONTEND_URL}/payment-success?order_id=${orderId}`,
        },
      });

    const paymentSessionId = response.data.payment_session_id;

    /*
    2️⃣ Store payments (ONE order → MANY reservations)
    */
    for (const r of reservations) {
      await client.query(
        `
        INSERT INTO payments
        (reservation_id, order_id, payment_session_id, amount, status)
        VALUES ($1,$2,$3,$4,'pending')
        `,
        [r.id, orderId, paymentSessionId, totalAmount]
      );
    }

    /*
    3️⃣ Set timeout
    */
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

    for (const r of reservations) {
      await client.query(
        `UPDATE reservations SET payment_expires_at=$1 WHERE id=$2`,
        [expiryTime, r.id]
      );
    }

    await paymentQueue.add(
      "payment-timeout",
      { reservationIds: reservations.map(r => r.id) },
      {
        delay: 10 * 60 * 1000,
        jobId: `payment-batch-${orderId}`,
      }
    );

    return {
      order_id: orderId,
      payment_session_id: paymentSessionId,
      amount: totalAmount,
    };
  } catch (err) {
    console.error("Cashfree error:", err.response?.data || err.message);
    console.log(err.response?.data);
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

  /*
  🛑 If already success → don't cancel, refund instead
  */
  if (payment.status === "success") return;

  /*
  ❌ Mark as cancelled
  */
  await client.query(
    `UPDATE payments SET status='cancelled' WHERE id=$1`,
    [payment.id]
  );

  console.log("💳 Payment cancelled:", reservationId);
}

module.exports = { createPayment, cancelPayment };