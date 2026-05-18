const pool = require("../config/db");
const {
  shouldSkipRuntimeSchemaMutation,
} = require("../config/runtimeSchema");

async function ensureReservationPaymentContextSchema(client = pool) {
  if (shouldSkipRuntimeSchemaMutation()) return;

  await client.query(
    `
    ALTER TABLE reservations
    ADD COLUMN IF NOT EXISTS payment_context JSONB DEFAULT '{}'::jsonb
    `
  );
}

function parsePaymentContext(value) {
  if (!value) return {};
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function hasReservedStock(reservation) {
  const context = parsePaymentContext(reservation?.payment_context);
  return context.stock_reserved !== false;
}

module.exports = {
  ensureReservationPaymentContextSchema,
  hasReservedStock,
  parsePaymentContext,
};
