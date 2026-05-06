const pool = require("../shared/config/db");
const crypto = require("crypto");

exports.cashfreeWebhook = async (req, res) => {
  const rawBody = req.body.toString(); // because express.raw()
  const signature = req.headers["x-webhook-signature"];
  const secret = process.env.CASHFREE_WEBHOOK_SECRET;

  console.log("📩 Raw webhook:", rawBody);

  /*
  ========================
  1️⃣ SIGNATURE VERIFY (SAFE)
  ========================
  */
  if (secret) {
    try {
      const generatedSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("base64");

      if (generatedSignature !== signature) {
        console.error("❌ Invalid webhook signature");
        return res.sendStatus(200); // 🔥 NEVER return 400 (Cashfree retries)
      }
    } catch (err) {
      console.error("Signature error:", err);
      return res.sendStatus(200);
    }
  } else {
    console.warn("⚠️ DEV MODE: Skipping signature verification");
  }

  /*
  ========================
  2️⃣ PARSE BODY
  ========================
  */
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error("Invalid JSON");
    return res.sendStatus(200);
  }

  const data = body.data || {};

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
    ========================
    3️⃣ PAYMENT HANDLING
    ========================
    */
    if (data.order_id) {
      const { order_id, order_status, payment_details } = data;

      console.log("💰 Payment webhook:", order_id, order_status);

      const paymentResult = await client.query(
        `SELECT * FROM payments WHERE order_id=$1 FOR UPDATE`,
        [order_id]
      );

      if (!paymentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.sendStatus(200);
      }

      const payment = paymentResult.rows[0];

      // 🛑 idempotency
      if (payment.status === "success") {
        await client.query("ROLLBACK");
        return res.sendStatus(200);
      }

      if (order_status === "PAID") {
        await client.query(
          `
          UPDATE payments
          SET status='success',
              payment_method=$1,
              transaction_id=$2,
              updated_at=NOW()
          WHERE order_id=$3
          `,
          [
            payment_details?.payment_method || null,
            payment_details?.cf_payment_id || null,
            order_id,
          ]
        );

        await client.query(
          `UPDATE reservations SET payment_status='paid' WHERE id=$1`,
          [payment.reservation_id]
        );

        console.log("✅ Payment success:", order_id);
      }

      if (order_status === "FAILED") {
        await client.query(
          `UPDATE payments SET status='failed' WHERE order_id=$1`,
          [order_id]
        );

        console.log("❌ Payment failed:", order_id);
      }
    }

    /*
    ========================
    4️⃣ REFUND HANDLING
    ========================
    */
    if (data.refund) {
      const { refund_id, refund_status } = data.refund;

      console.log("💸 Refund webhook:", refund_id, refund_status);

      const paymentResult = await client.query(
        `SELECT * FROM payments WHERE refund_id=$1 FOR UPDATE`,
        [refund_id]
      );

      if (!paymentResult.rows.length) {
        await client.query("ROLLBACK");
        return res.sendStatus(200);
      }

      const payment = paymentResult.rows[0];

      if (payment.refund_status === "refunded") {
        await client.query("ROLLBACK");
        return res.sendStatus(200);
      }

      if (refund_status === "SUCCESS") {
        await client.query(
          `UPDATE payments SET refund_status='refunded' WHERE id=$1`,
          [payment.id]
        );

        await client.query(
          `UPDATE reservations SET payment_status='refunded' WHERE id=$1`,
          [payment.reservation_id]
        );

        console.log("✅ Refund success:", payment.reservation_id);
      }

      if (refund_status === "FAILED") {
        await client.query(
          `UPDATE payments SET refund_status='failed' WHERE id=$1`,
          [payment.id]
        );

        console.log("❌ Refund failed:", payment.reservation_id);
      }
    }

    await client.query("COMMIT");
    return res.sendStatus(200);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Webhook DB error:", err);
    return res.sendStatus(200); // 🔥 NEVER FAIL WEBHOOK
  } finally {
    client.release();
  }
};