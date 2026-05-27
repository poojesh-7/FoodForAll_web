const crypto = require("crypto");
const logger = require("../utils/logger");
const { incrementCounter } = require("./metrics.service");

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function intDelta(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function numberDelta(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload;
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildTrustEffect(event) {
  const payload = normalizePayload(event.event_payload);
  const scoreDelta = numberDelta(payload.score_delta ?? payload.trust_delta ?? payload.scoreDelta);
  const penaltyDelta = intDelta(payload.penalty_delta ?? payload.penaltyDelta);
  const failureDelta = intDelta(payload.failure_delta ?? payload.failureDelta);
  const cancellationDelta = intDelta(payload.cancellation_delta ?? payload.cancellationDelta);
  const completionDelta = intDelta(payload.completion_delta ?? payload.completionDelta);
  const timeoutDelta = intDelta(payload.timeout_delta ?? payload.timeoutDelta);
  const fulfillmentDelta = intDelta(payload.fulfillment_delta ?? payload.fulfillmentDelta);
  const refundDelta = intDelta(payload.refund_delta ?? payload.refundDelta);
  const depositMultiplierDelta = numberDelta(
    payload.deposit_multiplier_delta ?? payload.depositMultiplierDelta
  );
  const restrictionLevelDelta = intDelta(
    payload.restriction_level_delta ?? payload.restrictionLevelDelta
  );
  const explicitRestrictionLevel = payload.restriction_level ?? payload.restrictionLevel;
  const restrictionType = payload.restriction_type || payload.restrictionType || null;
  const activeUntil = parseDateOrNull(payload.active_until || payload.activeUntil);
  const cooldownUntil = parseDateOrNull(payload.cooldown_until || payload.cooldownUntil);
  const metadata = normalizePayload(payload.metadata);

  return {
    subjectType: event.subject_type,
    subjectId: event.subject_id,
    scoreDelta,
    penaltyDelta,
    failureDelta,
    cancellationDelta,
    completionDelta,
    timeoutDelta,
    fulfillmentDelta,
    refundDelta,
    depositMultiplierDelta,
    restrictionLevelDelta,
    explicitRestrictionLevel:
      explicitRestrictionLevel === undefined || explicitRestrictionLevel === null
        ? null
        : Math.max(0, intDelta(explicitRestrictionLevel)),
    restrictionType: restrictionType ? String(restrictionType).slice(0, 120) : null,
    activeUntil,
    cooldownUntil,
    metadata,
  };
}

function effectHash(event, effect) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        eventId: event.id,
        eventKey: event.event_key,
        subjectType: effect.subjectType,
        subjectId: effect.subjectId,
        scoreDelta: effect.scoreDelta,
        penaltyDelta: effect.penaltyDelta,
        failureDelta: effect.failureDelta,
        cancellationDelta: effect.cancellationDelta,
        completionDelta: effect.completionDelta,
        timeoutDelta: effect.timeoutDelta,
        fulfillmentDelta: effect.fulfillmentDelta,
        refundDelta: effect.refundDelta,
        depositMultiplierDelta: effect.depositMultiplierDelta,
        restrictionLevelDelta: effect.restrictionLevelDelta,
        explicitRestrictionLevel: effect.explicitRestrictionLevel,
        restrictionType: effect.restrictionType,
        activeUntil: effect.activeUntil ? effect.activeUntil.toISOString() : null,
        cooldownUntil: effect.cooldownUntil ? effect.cooldownUntil.toISOString() : null,
      })
    )
    .digest("hex");
}

function compactSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

async function queryProjectionStep(client, step, sql, params, event) {
  try {
    return await client.query(sql, params);
  } catch (err) {
    incrementCounter("food_rescue_trust_projection_sql_failures_total", {
      step,
      code: err.code || "unknown",
    });
    logger.warn("Trust projection SQL failed", {
      err,
      step,
      eventId: event?.id,
      eventKey: event?.event_key,
      eventType: event?.event_type,
      sql: compactSql(sql),
    });
    throw err;
  }
}

async function insertEffectOnce(client, event, effect, hash) {
  const inserted = await queryProjectionStep(
    client,
    "insert_effect",
    `
    INSERT INTO trust_event_effects (event_id, subject_type, subject_id, effect_hash)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT DO NOTHING
    RETURNING event_id
    `,
    [event.id, effect.subjectType, effect.subjectId, hash],
    event
  );

  return inserted.rows.length > 0;
}

async function upsertTrustScore(client, event, effect) {
  const eventTime = event.created_at || new Date();
  const initialScore = clamp(100 + effect.scoreDelta, 0, 100);
  const initialPenalty = Math.max(0, effect.penaltyDelta);
  const initialFailure = Math.max(0, effect.failureDelta);
  const initialCancellation = Math.max(0, effect.cancellationDelta);
  const initialCompletion = Math.max(0, effect.completionDelta);
  const initialTimeout = Math.max(0, effect.timeoutDelta);
  const initialFulfillment = Math.max(0, effect.fulfillmentDelta);
  const initialRefund = Math.max(0, effect.refundDelta);
  const initialDepositMultiplier = Math.max(1, 1 + effect.depositMultiplierDelta);
  const initialRestriction = Math.max(
    0,
    effect.explicitRestrictionLevel ?? effect.restrictionLevelDelta
  );

  const result = await queryProjectionStep(
    client,
    "upsert_score",
    `
    INSERT INTO trust_scores (
      subject_type, subject_id, trust_score, penalty_level,
      deposit_multiplier, cooldown_until, restriction_level,
      failure_count, cancellation_count, completion_count,
      timeout_count, fulfillment_count, refund_count,
      last_event_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
    ON CONFLICT (subject_type, subject_id)
    DO UPDATE SET
      trust_score = LEAST(100, GREATEST(0, trust_scores.trust_score + $15::numeric)),
      penalty_level = GREATEST(0, trust_scores.penalty_level + $16::integer),
      deposit_multiplier = GREATEST(1, trust_scores.deposit_multiplier + $17::numeric),
      failure_count = GREATEST(0, trust_scores.failure_count + $18::integer),
      cancellation_count = GREATEST(0, trust_scores.cancellation_count + $19::integer),
      completion_count = GREATEST(0, trust_scores.completion_count + $20::integer),
      timeout_count = GREATEST(0, trust_scores.timeout_count + $21::integer),
      fulfillment_count = GREATEST(0, trust_scores.fulfillment_count + $22::integer),
      refund_count = GREATEST(0, trust_scores.refund_count + $23::integer),
      cooldown_until = CASE
        WHEN $24::timestamp IS NULL THEN trust_scores.cooldown_until
        WHEN trust_scores.cooldown_until IS NULL THEN $24::timestamp
        WHEN trust_scores.cooldown_until < $24::timestamp THEN $24::timestamp
        ELSE trust_scores.cooldown_until
      END,
      restriction_level = GREATEST(
        0,
        GREATEST(
          trust_scores.restriction_level + $25::integer,
          COALESCE($26::integer, trust_scores.restriction_level)
        )
      ),
      last_event_at = CASE
        WHEN trust_scores.last_event_at IS NULL THEN $27::timestamp
        WHEN trust_scores.last_event_at < $27::timestamp THEN $27::timestamp
        ELSE trust_scores.last_event_at
      END,
      updated_at = NOW()
    RETURNING *
    `,
    [
      effect.subjectType,
      effect.subjectId,
      initialScore,
      initialPenalty,
      initialDepositMultiplier,
      effect.cooldownUntil,
      initialRestriction,
      initialFailure,
      initialCancellation,
      initialCompletion,
      initialTimeout,
      initialFulfillment,
      initialRefund,
      eventTime,
      effect.scoreDelta,
      effect.penaltyDelta,
      effect.depositMultiplierDelta,
      effect.failureDelta,
      effect.cancellationDelta,
      effect.completionDelta,
      effect.timeoutDelta,
      effect.fulfillmentDelta,
      effect.refundDelta,
      effect.cooldownUntil,
      effect.restrictionLevelDelta,
      effect.explicitRestrictionLevel,
      eventTime,
    ],
    event
  );

  return result.rows[0] || null;
}

async function upsertRestriction(client, event, effect) {
  if (!effect.restrictionType && !effect.activeUntil) return null;

  const restrictionType = effect.restrictionType || "cooldown";
  const result = await queryProjectionStep(
    client,
    "upsert_restriction",
    `
    INSERT INTO trust_restrictions (
      restriction_type, subject_type, subject_id, active_until, metadata
    )
    VALUES ($1,$2,$3,$4,$5::jsonb)
    ON CONFLICT (restriction_type, subject_type, subject_id)
    DO UPDATE SET
      active_until = CASE
        WHEN EXCLUDED.active_until IS NULL THEN trust_restrictions.active_until
        WHEN trust_restrictions.active_until IS NULL THEN EXCLUDED.active_until
        WHEN trust_restrictions.active_until < EXCLUDED.active_until THEN EXCLUDED.active_until
        ELSE trust_restrictions.active_until
      END,
      metadata = trust_restrictions.metadata || EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *
    `,
    [
      restrictionType,
      effect.subjectType,
      effect.subjectId,
      effect.activeUntil || effect.cooldownUntil,
      JSON.stringify(effect.metadata || {}),
    ],
    event
  );

  return result.rows[0] || null;
}

async function applyTrustEventProjection(client, event) {
  const effect = buildTrustEffect(event);
  const hash = effectHash(event, effect);
  const shouldApply = await insertEffectOnce(client, event, effect, hash);

  if (!shouldApply) {
    incrementCounter("food_rescue_trust_projection_conflicts_total", {
      event_type: event.event_type || "unknown",
      subject_type: event.subject_type || "unknown",
    });
    logger.info("Trust projection duplicate effect skipped", {
      eventId: event.id,
      eventKey: event.event_key,
      eventType: event.event_type,
      effectHash: hash,
    });
    return {
      applied: false,
      effectHash: hash,
      score: null,
      restriction: null,
    };
  }

  const score = await upsertTrustScore(client, event, effect);
  const restriction = await upsertRestriction(client, event, effect);

  return {
    applied: true,
    effect,
    effectHash: hash,
    score,
    restriction,
  };
}

module.exports = {
  applyTrustEventProjection,
  buildTrustEffect,
  effectHash,
};
