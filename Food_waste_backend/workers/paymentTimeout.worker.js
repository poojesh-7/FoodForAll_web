const { Worker } = require("bullmq");
const connection = require("../shared/config/bullmq");
const pool = require("../shared/config/db");
const logger = require("../shared/utils/logger");
const { registerWorkerEvents } = require("../shared/utils/queueEvents");
const { workerOptions } = require("../shared/utils/queueOptions");
const {
  getReservationSnapshot,
  publishListingUpdated,
  publishPaymentUpdated,
  publishReservationUpdated,
} = require("../shared/services/realtime.service");

logger.info("Payment timeout worker started");

const paymentTimeoutWorker = new Worker(
  "payment-queue",
  async (job) => {
    const { reservationIds } = job.data;

    const client = await pool.connect();
    const changedReservationIds = new Set();

    try {
      await client.query("BEGIN");

      for (const reservationId of reservationIds) {
        const reservationResult = await client.query(
          `
          SELECT *
          FROM reservations
          WHERE id=$1
          FOR UPDATE
          `,
          [reservationId]
        );

        if (!reservationResult.rows.length) continue;

        const reservation = reservationResult.rows[0];

        if (
          reservation.status !== "payment_pending" ||
          reservation.payment_status !== "pending"
        ) {
          continue;
        }

        const paymentResult = await client.query(
          `
          SELECT *
          FROM payments
          WHERE reservation_id=$1
          FOR UPDATE
          `,
          [reservationId]
        );

        if (
          paymentResult.rows.some((payment) =>
            ["paid", "success", "refunded"].includes(payment.status)
          )
        ) {
          continue;
        }

        await client.query(
          `
          UPDATE reservations
          SET status='cancelled',
              payment_status='expired'
          WHERE id=$1
          `,
          [reservationId]
        );

        await client.query(
          `
          UPDATE payments
          SET status='expired',
              updated_at=NOW()
          WHERE reservation_id=$1
          AND status='pending'
          `,
          [reservationId]
        );

        await client.query(
          `
          UPDATE food_listings
          SET remaining_quantity = remaining_quantity + $1,
              status = CASE
                WHEN pickup_end_time > NOW() AND status='completed' THEN 'active'
                ELSE status
              END
          WHERE id=$2
          `,
          [reservation.quantity_reserved, reservation.listing_id]
        );

        changedReservationIds.add(reservationId);
        logger.info("Payment timeout expired reservation", { reservationId });
      }

      await client.query("COMMIT");
      await Promise.all(
        [...changedReservationIds].map(async (reservationId) => {
          const reservation = await getReservationSnapshot(reservationId);
          await Promise.all([
            publishReservationUpdated(reservationId, {
              action: "expired",
              reservation,
            }),
            publishPaymentUpdated(reservationId, {
              action: "expired",
              reservation,
            }),
            reservation?.listing_id
              ? publishListingUpdated(reservation.listing_id, {
                  action: "quantity_updated",
                })
              : Promise.resolve(),
          ]);
        })
      );
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
  workerOptions(connection, {
    attempts: 5,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
  })
);

registerWorkerEvents(paymentTimeoutWorker, "payment-queue");
