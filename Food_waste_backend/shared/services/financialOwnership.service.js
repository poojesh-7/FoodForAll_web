const crypto = require("crypto");
const pool = require("../config/db");
const logger = require("../utils/logger");
const {
  incrementCounter,
} = require("./metrics.service");

const OWNERSHIP_VERSION = 1;
const DEFAULT_CURRENCY = "INR";

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function compactText(value, fallback = null, maxLength = 80) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function stableNormalize(value) {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = stableNormalize(value[key]);
      return acc;
    }, {});
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableNormalize(value)))
    .digest("hex");
}

function normalizeRole(role, fallback) {
  return compactText(role, fallback, 40);
}

function inferPayerRole({ payer, reservation }) {
  return normalizeRole(
    payer?.role,
    reservation?.pickup_type === "ngo" ? "ngo" : "user"
  );
}

function platformAccountId() {
  return (
    compactText(process.env.PLATFORM_ACCOUNT_ID, null, 160) ||
    compactText(process.env.CASHFREE_PLATFORM_ACCOUNT_ID, null, 160)
  );
}

function buildFinancialOwnershipSnapshot({
  reservation,
  payment = {},
  payer = {},
  providerId,
  foodAmount,
  depositAmount,
  commissionAmount = 0,
  currency = DEFAULT_CURRENCY,
  ownershipVersion = OWNERSHIP_VERSION,
  sourceMetadata = {},
}) {
  if (!reservation?.id) throw new Error("reservation_id is required for ownership snapshot");

  const paymentSessionId = compactText(
    payment.payment_session_id || payment.paymentSessionId,
    null,
    240
  );
  if (!paymentSessionId) {
    throw new Error("payment_session_id is required for ownership snapshot");
  }

  const payerUserId = payer.id || payer.user_id || reservation.user_id;
  if (!payerUserId) throw new Error("payer_user_id is required for ownership snapshot");

  const payerRole = inferPayerRole({ payer, reservation });
  const frozenProviderId = providerId || reservation.provider_id || null;
  const frozenFoodAmount = roundMoney(
    foodAmount ?? payment.food_amount ?? reservation.food_amount
  );
  const frozenDepositAmount = roundMoney(
    depositAmount ??
      payment.reliability_deposit_amount ??
      reservation.reliability_deposit_amount
  );
  const frozenCommissionAmount = roundMoney(commissionAmount);
  const beneficiaryUserId = frozenFoodAmount > 0 ? frozenProviderId : null;
  const commissionReceiverRole =
    frozenCommissionAmount > 0 ? "platform" : null;
  const snapshot = {
    reservation_id: String(reservation.id),
    payment_session_id: paymentSessionId,
    payer_user_id: String(payerUserId),
    payer_role: payerRole,
    provider_id: frozenProviderId ? String(frozenProviderId) : null,
    beneficiary_user_id: beneficiaryUserId ? String(beneficiaryUserId) : null,
    beneficiary_role: beneficiaryUserId ? "provider" : null,
    platform_account_id: platformAccountId(),
    deposit_owner_user_id:
      frozenDepositAmount > 0 ? String(payerUserId) : null,
    deposit_owner_role: frozenDepositAmount > 0 ? payerRole : null,
    refund_target_user_id: String(payerUserId),
    refund_target_role: payerRole,
    commission_receiver_user_id: null,
    commission_receiver_role: commissionReceiverRole,
    food_amount: frozenFoodAmount,
    deposit_amount: frozenDepositAmount,
    commission_amount: frozenCommissionAmount,
    currency: compactText(currency, DEFAULT_CURRENCY, 12).toUpperCase(),
    ownership_version: Number(ownershipVersion) || OWNERSHIP_VERSION,
    source_metadata: {
      source: "payment_creation",
      order_id: payment.order_id || payment.orderId || null,
      payment_id: payment.id || null,
      listing_id: reservation.listing_id || null,
      pickup_type: reservation.pickup_type || null,
      ...sourceMetadata,
    },
  };

  snapshot.snapshot_hash = stableHash({
    reservation_id: snapshot.reservation_id,
    payment_session_id: snapshot.payment_session_id,
    payer_user_id: snapshot.payer_user_id,
    payer_role: snapshot.payer_role,
    provider_id: snapshot.provider_id,
    beneficiary_user_id: snapshot.beneficiary_user_id,
    beneficiary_role: snapshot.beneficiary_role,
    platform_account_id: snapshot.platform_account_id,
    deposit_owner_user_id: snapshot.deposit_owner_user_id,
    deposit_owner_role: snapshot.deposit_owner_role,
    refund_target_user_id: snapshot.refund_target_user_id,
    refund_target_role: snapshot.refund_target_role,
    commission_receiver_user_id: snapshot.commission_receiver_user_id,
    commission_receiver_role: snapshot.commission_receiver_role,
    food_amount: snapshot.food_amount,
    deposit_amount: snapshot.deposit_amount,
    commission_amount: snapshot.commission_amount,
    currency: snapshot.currency,
    ownership_version: snapshot.ownership_version,
  });

  return snapshot;
}

async function loadReservationOwnershipContext(client, reservation) {
  if (!reservation?.id) throw new Error("reservation_id is required");

  if (reservation.provider_id) return reservation;

  const result = await client.query(
    `
    SELECT r.id, r.user_id, r.listing_id, r.pickup_type,
           r.assigned_volunteer_id, f.provider_id
    FROM reservations r
    LEFT JOIN food_listings f ON f.id=r.listing_id
    WHERE r.id=$1
    `,
    [reservation.id]
  );

  return {
    ...reservation,
    ...(result.rows[0] || {}),
  };
}

async function insertOwnershipSnapshot(client, snapshot) {
  const result = await client.query(
    `
    INSERT INTO payment_ownership (
      reservation_id, payment_session_id, payer_user_id, payer_role,
      provider_id, beneficiary_user_id, beneficiary_role, platform_account_id,
      deposit_owner_user_id, deposit_owner_role,
      refund_target_user_id, refund_target_role,
      commission_receiver_user_id, commission_receiver_role,
      food_amount, deposit_amount, commission_amount, currency,
      ownership_version, snapshot_hash, source_metadata
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb
    )
    ON CONFLICT (reservation_id, payment_session_id, ownership_version)
    DO NOTHING
    RETURNING *
    `,
    [
      snapshot.reservation_id,
      snapshot.payment_session_id,
      snapshot.payer_user_id,
      snapshot.payer_role,
      snapshot.provider_id,
      snapshot.beneficiary_user_id,
      snapshot.beneficiary_role,
      snapshot.platform_account_id,
      snapshot.deposit_owner_user_id,
      snapshot.deposit_owner_role,
      snapshot.refund_target_user_id,
      snapshot.refund_target_role,
      snapshot.commission_receiver_user_id,
      snapshot.commission_receiver_role,
      snapshot.food_amount,
      snapshot.deposit_amount,
      snapshot.commission_amount,
      snapshot.currency,
      snapshot.ownership_version,
      snapshot.snapshot_hash,
      JSON.stringify(snapshot.source_metadata || {}),
    ]
  );

  return result.rows[0] || null;
}

async function findOwnershipByKey(client, snapshot) {
  const result = await client.query(
    `
    SELECT *
    FROM payment_ownership
    WHERE reservation_id=$1
    AND payment_session_id=$2
    AND ownership_version=$3
    ORDER BY created_at ASC, id ASC
    LIMIT 1
    `,
    [
      snapshot.reservation_id,
      snapshot.payment_session_id,
      snapshot.ownership_version,
    ]
  );

  return result.rows[0] || null;
}

async function createFinancialOwnershipSnapshot(options = {}) {
  const client = options.client || options.db || pool;
  const reservation = await loadReservationOwnershipContext(
    client,
    options.reservation
  );
  const snapshot = buildFinancialOwnershipSnapshot({
    ...options,
    reservation,
    payer: options.payer || options.user,
    providerId: options.providerId || options.provider_id || reservation.provider_id,
  });
  const inserted = await insertOwnershipSnapshot(client, snapshot);

  if (inserted) {
    incrementCounter("food_rescue_payment_ownership_snapshots_total", {
      status: "created",
      payer_role: snapshot.payer_role,
    });
    logger.payment("Financial ownership snapshot created", {
      reservationId: snapshot.reservation_id,
      paymentSessionId: snapshot.payment_session_id,
      payerUserId: snapshot.payer_user_id,
      payerRole: snapshot.payer_role,
      providerId: snapshot.provider_id,
      ownershipVersion: snapshot.ownership_version,
      snapshotHash: snapshot.snapshot_hash,
    });

    return {
      inserted: true,
      snapshot: inserted,
      expectedSnapshot: snapshot,
      duplicateHashMatch: true,
    };
  }

  const existing = await findOwnershipByKey(client, snapshot);
  const duplicateHashMatch = existing?.snapshot_hash === snapshot.snapshot_hash;

  incrementCounter("food_rescue_payment_ownership_snapshots_total", {
    status: duplicateHashMatch ? "duplicate" : "duplicate_mismatch",
    payer_role: snapshot.payer_role,
  });
  logger.warn("Financial ownership snapshot duplicate prevented", {
    reservationId: snapshot.reservation_id,
    paymentSessionId: snapshot.payment_session_id,
    ownershipVersion: snapshot.ownership_version,
    expectedSnapshotHash: snapshot.snapshot_hash,
    existingSnapshotHash: existing?.snapshot_hash || null,
    duplicateHashMatch,
  });

  return {
    inserted: false,
    snapshot: existing,
    expectedSnapshot: snapshot,
    duplicateHashMatch,
  };
}

async function getFinancialOwnership(options = {}) {
  const db = options.db || options.client || pool;
  const reservationId = options.reservationId || options.reservation_id;
  const paymentSessionId = options.paymentSessionId || options.payment_session_id;

  if (!reservationId && !paymentSessionId) {
    throw new Error("reservation_id or payment_session_id is required");
  }

  const params = [];
  const where = [];
  if (reservationId) {
    params.push(reservationId);
    where.push(`reservation_id=$${params.length}`);
  }
  if (paymentSessionId) {
    params.push(paymentSessionId);
    where.push(`payment_session_id=$${params.length}`);
  }

  const result = await db.query(
    `
    SELECT *
    FROM payment_ownership
    WHERE ${where.join(" AND ")}
    ORDER BY created_at ASC, id ASC
    `,
    params
  );

  return result.rows;
}

module.exports = {
  OWNERSHIP_VERSION,
  buildFinancialOwnershipSnapshot,
  createFinancialOwnershipSnapshot,
  getFinancialOwnership,
  loadReservationOwnershipContext,
  roundMoney,
  stableHash,
};
