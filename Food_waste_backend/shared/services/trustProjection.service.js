const crypto = require("crypto");

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

async function insertEffectOnce(client, event, effect, hash) {
  const inserted = await client.query(
    `
    INSERT INTO trust_event_effects (event_id, subject_type, subject_id, effect_hash)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT DO NOTHING
    RETURNING event_id
    `,
    [event.id, effect.subjectType, effect.subjectId, hash]
  );

  return inserted.rows.length > 0;
}

async function upsertTrustScore(client, event, effect) {
  const eventTime = event.created_at || new Date();
  const initialScore = clamp(100 + effect.scoreDelta, 0, 100);
  const initialPenalty = Math.max(0, effect.penaltyDelta);
  const initialDepositMultiplier = Math.max(1, 1 + effect.depositMultiplierDelta);
  const initialRestriction = Math.max(
    0,
    effect.explicitRestrictionLevel ?? effect.restrictionLevelDelta
  );

  const result = await client.query(
    `
    INSERT INTO trust_scores (
      subject_type, subject_id, trust_score, penalty_level,
      deposit_multiplier, cooldown_until, restriction_level,
      last_event_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (subject_type, subject_id)
    DO UPDATE SET
      trust_score = LEAST(100, GREATEST(0, trust_scores.trust_score + $9::numeric)),
      penalty_level = GREATEST(0, trust_scores.penalty_level + $10::integer),
      deposit_multiplier = GREATEST(1, trust_scores.deposit_multiplier + $11::numeric),
      cooldown_until = CASE
        WHEN $12::timestamp IS NULL THEN trust_scores.cooldown_until
        WHEN trust_scores.cooldown_until IS NULL THEN $12::timestamp
        WHEN trust_scores.cooldown_until < $12::timestamp THEN $12::timestamp
        ELSE trust_scores.cooldown_until
      END,
      restriction_level = GREATEST(
        0,
        GREATEST(
          trust_scores.restriction_level + $13::integer,
          COALESCE($14::integer, trust_scores.restriction_level)
        )
      ),
      last_event_at = CASE
        WHEN trust_scores.last_event_at IS NULL THEN $15::timestamp
        WHEN trust_scores.last_event_at < $15::timestamp THEN $15::timestamp
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
      eventTime,
      effect.scoreDelta,
      effect.penaltyDelta,
      effect.depositMultiplierDelta,
      effect.cooldownUntil,
      effect.restrictionLevelDelta,
      effect.explicitRestrictionLevel,
      eventTime,
    ]
  );

  return result.rows[0] || null;
}

async function upsertRestriction(client, effect) {
  if (!effect.restrictionType && !effect.activeUntil) return null;

  const restrictionType = effect.restrictionType || "cooldown";
  const result = await client.query(
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
    ]
  );

  return result.rows[0] || null;
}

async function applyTrustEventProjection(client, event) {
  const effect = buildTrustEffect(event);
  const hash = effectHash(event, effect);
  const shouldApply = await insertEffectOnce(client, event, effect, hash);

  if (!shouldApply) {
    return {
      applied: false,
      effectHash: hash,
      score: null,
      restriction: null,
    };
  }

  const score = await upsertTrustScore(client, event, effect);
  const restriction = await upsertRestriction(client, effect);

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
