const pool = require("../config/db");

const blockingReservationStatuses = [
  "reserved",
  "pending",
  "volunteer_started",
  "picked_from_provider",
  "delivered",
  "picked_up",
  "completed",
];

const blockingTaskStatuses = [
  "self_pickup",
  "pending",
  "assigned",
  "in_progress",
  "volunteer_started",
  "picked_from_provider",
  "delivered",
];

const nonBlockingReservationStatuses = [
  "cancelled",
  "expired",
  "failed",
  "payment_failed",
  "abandoned_payment",
];

const nonBlockingPaymentStatuses = ["failed", "expired"];

function sqlList(values) {
  return values.map((value) => `'${value}'`).join(", ");
}

function column(alias, name) {
  return alias ? `${alias}.${name}` : name;
}

function blockingReservationWhere(alias = "") {
  const status = column(alias, "status");
  const taskStatus = column(alias, "task_status");
  const paymentStatus = column(alias, "payment_status");

  return `
    (
      ${status} IN (${sqlList(blockingReservationStatuses)})
      OR ${taskStatus} IN (${sqlList(blockingTaskStatuses)})
    )
    AND NOT (${status}='payment_pending' AND ${paymentStatus}='pending')
    AND COALESCE(${status}, '') NOT IN (${sqlList(nonBlockingReservationStatuses)})
    AND COALESCE(${paymentStatus}, '') NOT IN (${sqlList(nonBlockingPaymentStatuses)})
  `;
}

async function ensureReservationInteractionLockSchema(client = pool) {
  await client.query(
    `
    ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS payment_context JSONB DEFAULT '{}'::jsonb
    `
  );
  await client.query(`DROP INDEX IF EXISTS unique_active_reservation`);
  await client.query(
    `
    CREATE UNIQUE INDEX IF NOT EXISTS unique_active_reservation
    ON reservations (user_id, listing_id)
    WHERE ${blockingReservationWhere()}
    `
  );
}

module.exports = {
  blockingReservationWhere,
  ensureReservationInteractionLockSchema,
};
