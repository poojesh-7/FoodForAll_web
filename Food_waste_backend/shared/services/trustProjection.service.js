const crypto = require("crypto");
const logger = require("../utils/logger");
const {
  incrementCounter,
  observeHistogram,
} = require("./metrics.service");

const RECOVERY_STREAK_TARGET = 3;
const RECOVERY_PENALTY_CREDIT = 2;
const RECOVERY_SCORE_RECOVERY_PER_PENALTY = 2;
const DECAY_INTERVAL_DAYS = Number(process.env.TRUST_DECAY_INTERVAL_DAYS || 14);
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RESTRICTION_THRESHOLDS = [
  { level: 5, penaltyLevel: 14, scoreAtOrBelow: 40, failureStreak: 7 },
  { level: 4, penaltyLevel: 9, scoreAtOrBelow: 55, failureStreak: 5 },
  { level: 3, penaltyLevel: 6, scoreAtOrBelow: 70, failureStreak: 3 },
  { level: 2, penaltyLevel: 4, scoreAtOrBelow: 80, failureStreak: 2 },
  { level: 1, penaltyLevel: 1, scoreBelow: 95, failureStreak: null },
];
const ANALYTICS_ONLY_EVENT_TYPES = new Set([
  "provider_listing_expired",
]);
const PROVIDER_DIVERSITY_EVENT_TYPES = new Set([
  "user_pickup_completed",
  "ngo_delivery_completed",
  "volunteer_delivery_completed",
]);
const DOMAIN_RECOVERY_EVENT_TYPES = new Set([
  "ngo_delivery_completed",
  "volunteer_delivery_completed",
]);

function getTrustFarmingConfig() {
  const rawDecay = String(process.env.TRUST_PROVIDER_REPEAT_DECAY || "1,0.5,0")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    maxGainPerDay: clamp(Number(process.env.TRUST_MAX_GAIN_PER_DAY || 10), 0, 100),
    providerRepeatDecay: rawDecay.length ? rawDecay : [1, 0.5, 0],
  };
}

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

function booleanMetadata(metadata, keys) {
  return keys.some((key) => {
    const value = metadata[key];
    return value === true || String(value).toLowerCase() === "true";
  });
}

function amountMetadata(metadata, keys) {
  for (const key of keys) {
    if (metadata[key] === undefined || metadata[key] === null || metadata[key] === "") continue;
    const number = Number(metadata[key]);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function positiveGainSuppressionReason(payload, metadata, rawScoreDelta) {
  if (rawScoreDelta <= 0) return null;

  if (
    booleanMetadata(metadata, [
      "is_free",
      "free_listing",
      "listing_is_free",
      "zero_value_reservation",
      "internal",
      "system_generated",
      "systemGenerated",
    ]) ||
    booleanMetadata(payload, ["internal", "system_generated", "systemGenerated"])
  ) {
    return "non_qualifying_source";
  }

  const amount = amountMetadata(metadata, [
    "food_amount",
    "reservation_amount",
    "total_amount",
    "payment_amount",
    "price",
  ]);
  if (amount !== null && amount <= 0) return "zero_value_reservation";

  return null;
}

function recoverySuppressionReason(payload, metadata) {
  if (
    booleanMetadata(metadata, ["internal", "system_generated", "systemGenerated"]) ||
    booleanMetadata(payload, ["internal", "system_generated", "systemGenerated"])
  ) {
    return "non_qualifying_source";
  }

  return null;
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isoOrNull(value) {
  const date = parseDateOrNull(value);
  return date ? date.toISOString() : null;
}

function eventTime(event) {
  return parseDateOrNull(event.created_at) || new Date(0);
}

function dayBucket(date) {
  return eventTime({ created_at: date }).toISOString().slice(0, 10);
}

function addMs(date, ms) {
  return new Date(date.getTime() + ms);
}

function buildTrustEffect(event) {
  const payload = normalizePayload(event.event_payload);
  const metadata = normalizePayload(payload.metadata);
  const analyticsOnly =
    ANALYTICS_ONLY_EVENT_TYPES.has(event.event_type) ||
    payload.analytics_only === true ||
    payload.analyticsOnly === true;
  const rawScoreDelta = numberDelta(payload.score_delta ?? payload.trust_delta ?? payload.scoreDelta);
  const gainSuppressionReason = analyticsOnly
    ? null
    : positiveGainSuppressionReason(payload, metadata, rawScoreDelta);
  const recoverySuppression = analyticsOnly ? null : recoverySuppressionReason(payload, metadata);
  const scoreDelta = gainSuppressionReason ? 0 : rawScoreDelta;
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
  if (gainSuppressionReason) {
    incrementCounter("food_rescue_trust_farming_guard_events_total", {
      event: "suspicious_gain_patterns",
      reason: gainSuppressionReason,
      event_type: event.event_type || "unknown",
      subject_type: event.subject_type || "unknown",
    });
  }

  return {
    subjectType: event.subject_type,
    subjectId: event.subject_id,
    scoreDelta: analyticsOnly ? 0 : scoreDelta,
    rawScoreDelta: analyticsOnly ? 0 : rawScoreDelta,
    gainSuppressionReason,
    recoverySuppressionReason: recoverySuppression,
    penaltyDelta: analyticsOnly ? 0 : penaltyDelta,
    failureDelta: analyticsOnly ? 0 : failureDelta,
    cancellationDelta: analyticsOnly ? 0 : cancellationDelta,
    completionDelta: analyticsOnly ? 0 : completionDelta,
    timeoutDelta: analyticsOnly ? 0 : timeoutDelta,
    fulfillmentDelta: analyticsOnly ? 0 : fulfillmentDelta,
    refundDelta: analyticsOnly ? 0 : refundDelta,
    depositMultiplierDelta: analyticsOnly ? 0 : depositMultiplierDelta,
    restrictionLevelDelta: analyticsOnly ? 0 : restrictionLevelDelta,
    explicitRestrictionLevel:
      analyticsOnly || explicitRestrictionLevel === undefined || explicitRestrictionLevel === null
        ? null
        : Math.max(0, intDelta(explicitRestrictionLevel)),
    restrictionType: analyticsOnly || !restrictionType ? null : String(restrictionType).slice(0, 120),
    activeUntil: analyticsOnly ? null : activeUntil,
    cooldownUntil: analyticsOnly ? null : cooldownUntil,
    metadata,
    analyticsOnly,
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
        analyticsOnly: effect.analyticsOnly,
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

function isSuccessEffect(effect) {
  return (
    effect.completionDelta > 0 ||
    effect.fulfillmentDelta > 0 ||
    effect.refundDelta > 0 ||
    effect.scoreDelta > 0
  );
}

function isDomainRecoverySuccess(event, effect) {
  return (
    DOMAIN_RECOVERY_EVENT_TYPES.has(event.event_type) &&
    effect.completionDelta > 0 &&
    !effect.analyticsOnly &&
    !effect.recoverySuppressionReason
  );
}

function isQualifyingRecoverySuccess(event, effect, trustQuality) {
  if (isDomainRecoverySuccess(event, effect)) return true;
  if (effect.analyticsOnly || effect.gainSuppressionReason) return false;

  const rawScoreDelta = Number(trustQuality.raw_score_delta || effect.rawScoreDelta || 0);
  const appliedScoreDelta = Number(trustQuality.applied_score_delta || 0);
  if (rawScoreDelta > 0 && appliedScoreDelta <= 0) return false;

  return isSuccessEffect({
    ...effect,
    scoreDelta: appliedScoreDelta,
  });
}

function isNegativeEffect(effect) {
  return (
    effect.failureDelta > 0 ||
    effect.timeoutDelta > 0 ||
    effect.cancellationDelta > 0 ||
    effect.scoreDelta < 0
  );
}

function providerIdFromEffect(effect) {
  return effect.metadata?.provider_id || effect.metadata?.providerId || null;
}

function decayFactorForRepeat(repeatCount, decayConfig) {
  if (!decayConfig.length) return 1;
  return decayConfig[Math.min(repeatCount, decayConfig.length - 1)];
}

function applyTrustGainQuality(event, effect, context = {}) {
  if (!context.dailyPositiveGain) context.dailyPositiveGain = new Map();
  if (!context.providerRepeatCounts) context.providerRepeatCounts = new Map();

  const scoreDelta = Number(effect.scoreDelta || 0);
  const quality = {
    raw_score_delta: effect.rawScoreDelta ?? scoreDelta,
    score_delta_before_cap: scoreDelta,
    applied_score_delta: scoreDelta,
    provider_repeat_count: 0,
    provider_decay_factor: 1,
    daily_gain_before_event: 0,
    daily_gain_after_event: 0,
    daily_cap_applied: false,
    suppression_reason: effect.gainSuppressionReason || null,
  };

  if (scoreDelta <= 0) return quality;

  const config = context.config || getTrustFarmingConfig();
  const eventDate = eventTime(event);
  const day = dayBucket(eventDate);
  const subjectKey = `${effect.subjectType}:${effect.subjectId}`;
  const providerId = providerIdFromEffect(effect);
  let adjustedGain = scoreDelta;

  if (PROVIDER_DIVERSITY_EVENT_TYPES.has(event.event_type) && providerId) {
    const providerKey = `${subjectKey}:${day}:${providerId}`;
    const repeatCount = context.providerRepeatCounts.get(providerKey) || 0;
    const decayFactor = decayFactorForRepeat(repeatCount, config.providerRepeatDecay);
    adjustedGain *= decayFactor;
    context.providerRepeatCounts.set(providerKey, repeatCount + 1);
    quality.provider_repeat_count = repeatCount + 1;
    quality.provider_decay_factor = decayFactor;
    quality.score_delta_before_cap = adjustedGain;

    if (repeatCount > 0 || decayFactor < 1) {
      incrementCounter("food_rescue_trust_farming_guard_events_total", {
        event: "repeated_same_provider_gains",
        event_type: event.event_type || "unknown",
        subject_type: effect.subjectType || "unknown",
      });
    }
  }

  const dailyKey = `${subjectKey}:${day}`;
  const previousDailyGain = context.dailyPositiveGain.get(dailyKey) || 0;
  const remainingDailyGain = Math.max(0, config.maxGainPerDay - previousDailyGain);
  const appliedGain = Math.min(adjustedGain, remainingDailyGain);

  context.dailyPositiveGain.set(dailyKey, previousDailyGain + appliedGain);
  quality.daily_gain_before_event = previousDailyGain;
  quality.daily_gain_after_event = previousDailyGain + appliedGain;
  quality.applied_score_delta = appliedGain;
  quality.daily_cap_applied = appliedGain < adjustedGain;

  if (quality.daily_cap_applied) {
    incrementCounter("food_rescue_trust_farming_guard_events_total", {
      event: "rapid_trust_growth",
      event_type: event.event_type || "unknown",
      subject_type: effect.subjectType || "unknown",
    });
  }

  if (appliedGain <= 0 && adjustedGain > 0) {
    incrementCounter("food_rescue_trust_farming_guard_events_total", {
      event: "suspicious_gain_patterns",
      event_type: event.event_type || "unknown",
      subject_type: effect.subjectType || "unknown",
    });
  }

  return quality;
}

function penaltyFromEffect(effect) {
  return Math.max(0, effect.penaltyDelta) +
    Math.max(0, effect.failureDelta) * 2 +
    Math.max(0, effect.timeoutDelta) +
    Math.max(0, effect.cancellationDelta);
}

function scoreTriggersThreshold(score, threshold) {
  if (threshold.scoreBelow !== undefined) return score < threshold.scoreBelow;
  return score <= threshold.scoreAtOrBelow;
}

function thresholdForLevel(level) {
  return RESTRICTION_THRESHOLDS.find((threshold) => threshold.level === level) || null;
}

function restrictionTriggerSources({ score, penaltyLevel, failureStreak }, level) {
  const threshold = thresholdForLevel(level);
  if (!threshold) return [];

  const sources = [];
  if (penaltyLevel >= threshold.penaltyLevel) sources.push("penalty");
  if (scoreTriggersThreshold(score, threshold)) sources.push("score");
  if (
    threshold.failureStreak !== null &&
    failureStreak >= threshold.failureStreak
  ) {
    sources.push("streak");
  }
  return sources;
}

function penaltyPointsToDropBelowLevel(penaltyLevel, level) {
  const threshold = thresholdForLevel(level);
  if (!threshold) return 0;
  return Math.max(0, penaltyLevel - (threshold.penaltyLevel - 1));
}

function scorePointsToClearLevelTrigger(score, level) {
  const threshold = thresholdForLevel(level);
  if (!threshold || !scoreTriggersThreshold(score, threshold)) return 0;

  const targetScore =
    threshold.scoreBelow !== undefined
      ? threshold.scoreBelow
      : threshold.scoreAtOrBelow + 1;
  return Math.round(Math.max(0, targetScore - score) * 100) / 100;
}

function recoveryCyclesForPenaltyPoints(penaltyPoints) {
  return Math.ceil(Math.max(0, penaltyPoints) / RECOVERY_PENALTY_CREDIT);
}

function successesNeededForRecoveryCycles(cycles, successStreak) {
  if (cycles <= 0) return 0;
  const successesToNext =
    successStreak > 0
      ? Math.max(0, RECOVERY_STREAK_TARGET - successStreak)
      : RECOVERY_STREAK_TARGET;
  return successesToNext + Math.max(0, cycles - 1) * RECOVERY_STREAK_TARGET;
}

function buildRecoveryRequirements(state, level) {
  const penaltyPointsRemaining = Math.max(0, state.penalty_level);
  const recoveryCyclesToClearPenalty = recoveryCyclesForPenaltyPoints(penaltyPointsRemaining);
  const penaltyPointsToDropCurrentRestriction =
    level > 0 ? penaltyPointsToDropBelowLevel(penaltyPointsRemaining, level) : 0;
  const recoveryCyclesToDropCurrentRestriction =
    recoveryCyclesForPenaltyPoints(penaltyPointsToDropCurrentRestriction);

  return {
    recovery_target: RECOVERY_STREAK_TARGET,
    penalty_credit_per_target: RECOVERY_PENALTY_CREDIT,
    score_recovery_per_penalty_credit: RECOVERY_SCORE_RECOVERY_PER_PENALTY,
    penalty_points_remaining: penaltyPointsRemaining,
    recovery_cycles_to_clear_penalty: recoveryCyclesToClearPenalty,
    successes_to_next_recovery:
      penaltyPointsRemaining === 0
        ? 0
        : successesNeededForRecoveryCycles(1, state.success_streak),
    successes_to_clear_penalty: successesNeededForRecoveryCycles(
      recoveryCyclesToClearPenalty,
      state.success_streak
    ),
    penalty_points_to_drop_current_restriction: penaltyPointsToDropCurrentRestriction,
    recovery_cycles_to_drop_current_restriction:
      recoveryCyclesToDropCurrentRestriction,
    successes_to_drop_current_restriction: successesNeededForRecoveryCycles(
      recoveryCyclesToDropCurrentRestriction,
      state.success_streak
    ),
    score_points_to_clear_current_score_trigger: scorePointsToClearLevelTrigger(
      state.trust_score,
      level
    ),
    failure_streak_clears_on_next_qualifying_success: state.failure_streak > 0,
  };
}

function buildBlockedActorRecoveryStatus({ level, cooldownUntil, recoveryRequirements }) {
  const levelBlocked = level >= 5;
  const cooldownBlocked = Boolean(cooldownUntil);
  const blocked = levelBlocked || cooldownBlocked;

  return {
    blocked,
    blocked_by: levelBlocked
      ? "restriction_level"
      : cooldownBlocked
        ? "cooldown"
        : null,
    manual_db_edit_required: false,
    deterministic_recovery_route: levelBlocked
      ? "verified_good_behavior"
      : "qualifying_positive_lifecycle_event",
    requires_admin_recovery_event: levelBlocked,
    can_recover_through_lifecycle_action: !levelBlocked,
    recovery_event_type: levelBlocked ? "verified_good_behavior" : null,
    successes_to_next_recovery: recoveryRequirements.successes_to_next_recovery,
    successes_to_drop_current_restriction:
      recoveryRequirements.successes_to_drop_current_restriction,
    successes_to_clear_penalty: recoveryRequirements.successes_to_clear_penalty,
  };
}

function cooldownDurationMs(level, failureStreak) {
  if (level < 3) return 0;
  if (level === 3) return failureStreak >= 3 ? 12 * HOUR_MS : 2 * HOUR_MS;
  if (level === 4) return 12 * HOUR_MS;
  return 24 * HOUR_MS;
}

function depositMultiplierForLevel(level) {
  if (level <= 1) return 1;
  if (level === 2) return 1.5;
  if (level === 3) return 2;
  return 3;
}

function riskCategoryForLevel(level) {
  return ["normal", "watch", "elevated", "high", "severe", "critical"][level] || "critical";
}

function calculateRestrictionLevel({ score, penaltyLevel, failureStreak }) {
  for (const threshold of RESTRICTION_THRESHOLDS) {
    if (
      penaltyLevel >= threshold.penaltyLevel ||
      scoreTriggersThreshold(score, threshold) ||
      (
        threshold.failureStreak !== null &&
        failureStreak >= threshold.failureStreak
      )
    ) {
      return threshold.level;
    }
  }
  return 0;
}

function initialProjection(subjectType, subjectId) {
  return {
    subject_type: subjectType,
    subject_id: subjectId,
    trust_score: 100,
    penalty_level: 0,
    deposit_multiplier: 1,
    cooldown_until: null,
    restriction_level: 0,
    failure_count: 0,
    cancellation_count: 0,
    completion_count: 0,
    timeout_count: 0,
    fulfillment_count: 0,
    refund_count: 0,
    projected_restriction_level: 0,
    projected_cooldown_until: null,
    projected_deposit_multiplier: 1,
    recovery_progress: 100,
    risk_category: "normal",
    success_streak: 0,
    failure_streak: 0,
    last_success_at: null,
    last_failure_at: null,
    last_decay_at: null,
    last_event_at: null,
    updated_at: null,
    score_breakdown: {},
    projected_actions: {},
    recovery_state: {},
    decay_state: {},
    risk_state: {},
  };
}

function calculateOperationalProjection(state, event, effect, context) {
  const levelFloor = Math.max(
    0,
    state.manual_restriction_floor || 0,
    effect.explicitRestrictionLevel || 0
  );
  const restrictionMetrics = {
    score: state.trust_score,
    penaltyLevel: state.penalty_level,
    failureStreak: state.failure_streak,
  };
  const calculatedLevel = calculateRestrictionLevel(restrictionMetrics);
  const level = Math.max(levelFloor, calculatedLevel);
  const triggerSources =
    levelFloor > calculatedLevel
      ? ["manual"]
      : restrictionTriggerSources(restrictionMetrics, level);
  const recoveryRequirements = buildRecoveryRequirements(state, level);
  const durationMs = cooldownDurationMs(level, state.failure_streak);
  const cooldownUntil = durationMs ? addMs(context.eventTime, durationMs) : null;
  const blockedActorRecoveryStatus = buildBlockedActorRecoveryStatus({
    level,
    cooldownUntil: effect.cooldownUntil || cooldownUntil,
    recoveryRequirements,
  });
  const depositMultiplier = Math.max(
    depositMultiplierForLevel(level),
    1 + Math.max(0, effect.depositMultiplierDelta)
  );
  const riskCategory = riskCategoryForLevel(level);
  const recoveryProgress =
    state.penalty_level === 0
      ? 100
      : clamp((state.success_streak / RECOVERY_STREAK_TARGET) * 100, 0, 99);

  return {
    level,
    cooldownUntil: effect.cooldownUntil || cooldownUntil,
    depositMultiplier,
    riskCategory,
    recoveryProgress,
    projectedActions: {
      enforcement_active: true,
      restriction_level: level,
      restriction_label: riskCategory,
      warning_recommended: level >= 1,
      refundable_deposit_recommended: level >= 2,
      cooldown_recommended: level >= 3,
      temporary_suspension_recommended: level >= 4,
      manual_review_recommended: level >= 5,
      projected_deposit_multiplier: depositMultiplier,
      projected_cooldown_until: isoOrNull(effect.cooldownUntil || cooldownUntil),
      restriction_trigger_source: triggerSources[0] || "none",
      restriction_trigger_sources: triggerSources,
      recovery_requirements: recoveryRequirements,
      blocked_actor_recovery_status: blockedActorRecoveryStatus,
    },
    triggerSources,
    recoveryRequirements,
    blockedActorRecoveryStatus,
  };
}

function projectOperationalTrustState(previous, event, effect, context = {}) {
  const current = {
    ...initialProjection(effect.subjectType, effect.subjectId),
    ...previous,
  };
  const currentEventTime = eventTime(event);
  const trustQuality = applyTrustGainQuality(event, effect, context);
  const effectiveScoreDelta = trustQuality.applied_score_delta;
  const success = isQualifyingRecoverySuccess(event, effect, trustQuality);
  const negative = isNegativeEffect(effect);
  const previousLastEvent = parseDateOrNull(current.last_event_at);
  const decayIntervalMs = Math.max(1, DECAY_INTERVAL_DAYS) * DAY_MS;
  const stableDecay =
    success && !negative && previousLastEvent
      ? Math.floor((currentEventTime.getTime() - previousLastEvent.getTime()) / decayIntervalMs)
      : 0;
  const decayCredit = Math.min(Math.max(0, stableDecay), current.penalty_level);
  const decayScoreRecovery = decayCredit * 2;
  const penaltyAdded = penaltyFromEffect(effect);
  const penaltyBeforeRecovery = Math.max(
    0,
    current.penalty_level +
      penaltyAdded +
      Math.max(0, effect.restrictionLevelDelta) -
      decayCredit
  );

  let successStreak = success && !negative ? current.success_streak + 1 : 0;
  const failureStreak = negative ? current.failure_streak + 1 : 0;
  const recoveryCycles =
    success && !negative && penaltyBeforeRecovery > 0 && successStreak >= RECOVERY_STREAK_TARGET
      ? Math.floor(successStreak / RECOVERY_STREAK_TARGET)
      : 0;
  const recoveryCredit = Math.min(
    penaltyBeforeRecovery,
    recoveryCycles * RECOVERY_PENALTY_CREDIT
  );
  if (recoveryCycles > 0) {
    successStreak %= RECOVERY_STREAK_TARGET;
  }

  const penaltyLevel = Math.max(0, penaltyBeforeRecovery - recoveryCredit);
  const projectedScore = clamp(
    current.trust_score +
      effectiveScoreDelta +
      recoveryCredit * RECOVERY_SCORE_RECOVERY_PER_PENALTY +
      decayScoreRecovery,
    0,
    100
  );

  const next = {
    ...current,
    trust_score: projectedScore,
    penalty_level: penaltyLevel,
    failure_count: Math.max(0, current.failure_count + Math.max(0, effect.failureDelta)),
    cancellation_count: Math.max(
      0,
      current.cancellation_count + Math.max(0, effect.cancellationDelta)
    ),
    completion_count: Math.max(0, current.completion_count + Math.max(0, effect.completionDelta)),
    timeout_count: Math.max(0, current.timeout_count + Math.max(0, effect.timeoutDelta)),
    fulfillment_count: Math.max(
      0,
      current.fulfillment_count + Math.max(0, effect.fulfillmentDelta)
    ),
    refund_count: Math.max(0, current.refund_count + Math.max(0, effect.refundDelta)),
    success_streak: successStreak,
    failure_streak: failureStreak,
    last_success_at: success ? currentEventTime : current.last_success_at,
    last_failure_at: negative ? currentEventTime : current.last_failure_at,
    last_decay_at: decayCredit > 0 ? currentEventTime : current.last_decay_at,
    last_event_at: currentEventTime,
    manual_restriction_floor: Math.max(
      current.manual_restriction_floor || 0,
      effect.explicitRestrictionLevel || 0
    ),
  };

  const projection = calculateOperationalProjection(next, event, effect, {
    eventTime: currentEventTime,
  });

  next.projected_restriction_level = projection.level;
  next.restriction_level = projection.level;
  next.projected_cooldown_until = projection.cooldownUntil;
  next.cooldown_until = projection.cooldownUntil;
  next.projected_deposit_multiplier = projection.depositMultiplier;
  next.deposit_multiplier = projection.depositMultiplier;
  next.recovery_progress = projection.recoveryProgress;
  next.risk_category = projection.riskCategory;
  next.projected_actions = projection.projectedActions;
  next.score_breakdown = {
    event_key: event.event_key,
    event_type: event.event_type,
    score_delta: effectiveScoreDelta,
    raw_score_delta: trustQuality.raw_score_delta,
    analytics_only: effect.analyticsOnly,
    trust_quality: trustQuality,
    previous_score: current.trust_score,
    projected_score: projectedScore,
    penalty_added: penaltyAdded,
    penalty_before_recovery: penaltyBeforeRecovery,
    recovery_credit: recoveryCredit,
    decay_credit: decayCredit,
    restriction_trigger_source: projection.triggerSources[0] || "none",
    restriction_trigger_sources: projection.triggerSources,
    counters: {
      failures: next.failure_count,
      cancellations: next.cancellation_count,
      completions: next.completion_count,
      timeouts: next.timeout_count,
      fulfillments: next.fulfillment_count,
      refunds: next.refund_count,
    },
  };
  next.recovery_state = {
    success_streak: next.success_streak,
    failure_streak: next.failure_streak,
    recovery_target: RECOVERY_STREAK_TARGET,
    penalty_credit_per_target: RECOVERY_PENALTY_CREDIT,
    score_recovery_per_penalty_credit: RECOVERY_SCORE_RECOVERY_PER_PENALTY,
    successes_to_next_recovery:
      next.penalty_level === 0
        ? 0
        : Math.max(0, RECOVERY_STREAK_TARGET - next.success_streak),
    recovery_credit_this_event: recoveryCredit,
    recovery_progress: next.recovery_progress,
    recovery_requirements: projection.recoveryRequirements,
    blocked_actor_recovery_status: projection.blockedActorRecoveryStatus,
    last_success_at: isoOrNull(next.last_success_at),
    last_failure_at: isoOrNull(next.last_failure_at),
  };
  next.decay_state = {
    interval_days: DECAY_INTERVAL_DAYS,
    decay_intervals_observed: stableDecay,
    decay_credit_this_event: decayCredit,
    score_recovered_this_event: decayScoreRecovery,
    last_decay_at: isoOrNull(next.last_decay_at),
  };
  next.risk_state = {
    category: next.risk_category,
    projected_restriction_level: next.projected_restriction_level,
    projected_deposit_multiplier: next.projected_deposit_multiplier,
    projected_cooldown_until: isoOrNull(next.projected_cooldown_until),
    restriction_trigger_source: projection.triggerSources[0] || "none",
    restriction_trigger_sources: projection.triggerSources,
    recovery_requirements: projection.recoveryRequirements,
    blocked_actor_recovery_status: projection.blockedActorRecoveryStatus,
    operational_only: true,
    enforcement_active: true,
  };

  return next;
}

function buildTrustProjectionFromEvents(events, subjectType, subjectId) {
  const ordered = [...events].sort((left, right) => {
    const leftTime = eventTime(left).getTime();
    const rightTime = eventTime(right).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
  const first = ordered[0];
  let projection = initialProjection(
    subjectType || first?.subject_type || "user",
    subjectId || first?.subject_id || null
  );
  const context = {
    config: getTrustFarmingConfig(),
    dailyPositiveGain: new Map(),
    providerRepeatCounts: new Map(),
  };

  for (const event of ordered) {
    projection = projectOperationalTrustState(
      projection,
      event,
      buildTrustEffect(event),
      context
    );
  }

  return projection;
}

async function lockTrustSubject(client, effect, event) {
  return lockTrustSubjectKey(client, effect.subjectType, effect.subjectId, event);
}

async function lockTrustSubjectKey(client, subjectType, subjectId, event) {
  await queryProjectionStep(
    client,
    "lock_subject",
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [`trust:${subjectType}:${subjectId}`],
    event
  );
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

async function loadAppliedSubjectEvents(client, event, effect) {
  const result = await queryProjectionStep(
    client,
    "load_subject_events",
    `
    SELECT te.*
    FROM trust_events te
    JOIN trust_event_effects tee
      ON tee.event_id=te.id
      AND tee.subject_type=$1
      AND tee.subject_id=$2
    WHERE te.subject_type=$1
    AND te.subject_id=$2
    ORDER BY te.created_at ASC, te.id ASC
    `,
    [effect.subjectType, effect.subjectId],
    event
  );

  return result.rows;
}

async function loadSubjectTrustEventsForReplay(client, event, subjectType, subjectId, statuses) {
  const result = await queryProjectionStep(
    client,
    "load_subject_replay_events",
    `
    SELECT *
    FROM trust_events
    WHERE subject_type=$1
    AND subject_id=$2
    AND processing_status = ANY($3::text[])
    ORDER BY created_at ASC, id ASC
    `,
    [subjectType, subjectId, statuses],
    event
  );

  return result.rows;
}

async function upsertTrustScore(client, event, projection) {
  const result = await queryProjectionStep(
    client,
    "upsert_score",
    `
    INSERT INTO trust_scores (
      subject_type, subject_id, trust_score, penalty_level,
      deposit_multiplier, cooldown_until, restriction_level,
      failure_count, cancellation_count, completion_count,
      timeout_count, fulfillment_count, refund_count,
      projected_restriction_level, projected_cooldown_until,
      projected_deposit_multiplier, recovery_progress, risk_category,
      success_streak, failure_streak, last_success_at, last_failure_at, last_decay_at,
      score_breakdown, projected_actions, recovery_state, decay_state, risk_state,
      last_event_at, updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24::jsonb,$25::jsonb,$26::jsonb,$27::jsonb,$28::jsonb,
      $29,NOW()
    )
    ON CONFLICT (subject_type, subject_id)
    DO UPDATE SET
      trust_score=EXCLUDED.trust_score,
      penalty_level=EXCLUDED.penalty_level,
      deposit_multiplier=EXCLUDED.deposit_multiplier,
      cooldown_until=EXCLUDED.cooldown_until,
      restriction_level=EXCLUDED.restriction_level,
      failure_count=EXCLUDED.failure_count,
      cancellation_count=EXCLUDED.cancellation_count,
      completion_count=EXCLUDED.completion_count,
      timeout_count=EXCLUDED.timeout_count,
      fulfillment_count=EXCLUDED.fulfillment_count,
      refund_count=EXCLUDED.refund_count,
      projected_restriction_level=EXCLUDED.projected_restriction_level,
      projected_cooldown_until=EXCLUDED.projected_cooldown_until,
      projected_deposit_multiplier=EXCLUDED.projected_deposit_multiplier,
      recovery_progress=EXCLUDED.recovery_progress,
      risk_category=EXCLUDED.risk_category,
      success_streak=EXCLUDED.success_streak,
      failure_streak=EXCLUDED.failure_streak,
      last_success_at=EXCLUDED.last_success_at,
      last_failure_at=EXCLUDED.last_failure_at,
      last_decay_at=EXCLUDED.last_decay_at,
      score_breakdown=EXCLUDED.score_breakdown,
      projected_actions=EXCLUDED.projected_actions,
      recovery_state=EXCLUDED.recovery_state,
      decay_state=EXCLUDED.decay_state,
      risk_state=EXCLUDED.risk_state,
      last_event_at=EXCLUDED.last_event_at,
      updated_at=NOW()
    RETURNING *
    `,
    [
      projection.subject_type,
      projection.subject_id,
      projection.trust_score,
      projection.penalty_level,
      projection.deposit_multiplier,
      projection.cooldown_until,
      projection.restriction_level,
      projection.failure_count,
      projection.cancellation_count,
      projection.completion_count,
      projection.timeout_count,
      projection.fulfillment_count,
      projection.refund_count,
      projection.projected_restriction_level,
      projection.projected_cooldown_until,
      projection.projected_deposit_multiplier,
      projection.recovery_progress,
      projection.risk_category,
      projection.success_streak,
      projection.failure_streak,
      projection.last_success_at,
      projection.last_failure_at,
      projection.last_decay_at,
      JSON.stringify(projection.score_breakdown || {}),
      JSON.stringify(projection.projected_actions || {}),
      JSON.stringify(projection.recovery_state || {}),
      JSON.stringify(projection.decay_state || {}),
      JSON.stringify(projection.risk_state || {}),
      projection.last_event_at,
    ],
    event
  );

  return result.rows[0] || null;
}

async function upsertOperationalRestriction(client, event, projection) {
  const result = await queryProjectionStep(
    client,
    "upsert_operational_restriction",
    `
    INSERT INTO trust_restrictions (
      restriction_type, subject_type, subject_id, active_until, metadata
    )
    VALUES ('operational_projection',$1,$2,$3,$4::jsonb)
    ON CONFLICT (restriction_type, subject_type, subject_id)
    DO UPDATE SET
      active_until=EXCLUDED.active_until,
      metadata=EXCLUDED.metadata,
      updated_at=NOW()
    RETURNING *
    `,
    [
      projection.subject_type,
      projection.subject_id,
      projection.projected_cooldown_until,
      JSON.stringify({
        passive: false,
        enforcement_active: true,
        risk_category: projection.risk_category,
        projected_actions: projection.projected_actions,
        recovery_state: projection.recovery_state,
        decay_state: projection.decay_state,
        risk_state: projection.risk_state,
        score_breakdown: projection.score_breakdown,
      }),
    ],
    event
  );

  return result.rows[0] || null;
}

function recordOperationalProjectionMetrics(projection) {
  if (projection.projected_restriction_level > 0) {
    incrementCounter("food_rescue_trust_projected_restrictions_total", {
      subject_type: projection.subject_type,
      level: String(projection.projected_restriction_level),
      risk_category: projection.risk_category,
    });
  }
  if (projection.projected_actions?.cooldown_recommended) {
    incrementCounter("food_rescue_trust_projected_cooldowns_total", {
      subject_type: projection.subject_type,
      level: String(projection.projected_restriction_level),
    });
  }
  if (projection.projected_actions?.temporary_suspension_recommended) {
    incrementCounter("food_rescue_trust_projected_suspensions_total", {
      subject_type: projection.subject_type,
      risk_category: projection.risk_category,
    });
  }
  if (Number(projection.decay_state?.decay_credit_this_event || 0) > 0) {
    incrementCounter("food_rescue_trust_score_decay_operations_total", {
      subject_type: projection.subject_type,
    });
  }
  if (Number(projection.recovery_state?.recovery_credit_this_event || 0) > 0) {
    incrementCounter("food_rescue_trust_recovery_operations_total", {
      subject_type: projection.subject_type,
    });
  }
}

async function applyTrustEventProjection(client, event) {
  const effect = buildTrustEffect(event);
  const hash = effectHash(event, effect);

  await lockTrustSubject(client, effect, event);
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

  const appliedEvents = await loadAppliedSubjectEvents(client, event, effect);
  const projection = buildTrustProjectionFromEvents(
    appliedEvents,
    effect.subjectType,
    effect.subjectId
  );
  const score = await upsertTrustScore(client, event, projection);
  const restriction = await upsertOperationalRestriction(client, event, projection);
  recordOperationalProjectionMetrics(projection);

  return {
    applied: true,
    effect,
    effectHash: hash,
    projection,
    score,
    restriction,
  };
}

async function rebuildTrustProjectionForSubject(client, options = {}) {
  const startedAt = Date.now();
  const subjectType = options.subjectType || options.subject_type;
  const subjectId = options.subjectId || options.subject_id;
  const statuses = options.statuses || ["processed"];
  const replayEvent = {
    id: null,
    event_key: `trust:rebuild:${subjectType}:${subjectId}`,
    event_type: "trust_projection_rebuild",
  };

  try {
    await lockTrustSubjectKey(client, subjectType, subjectId, replayEvent);
    const events = await loadSubjectTrustEventsForReplay(
      client,
      replayEvent,
      subjectType,
      subjectId,
      statuses
    );
    const projection = buildTrustProjectionFromEvents(events, subjectType, subjectId);
    const score = await upsertTrustScore(client, replayEvent, projection);
    const restriction = await upsertOperationalRestriction(client, replayEvent, projection);

    incrementCounter("food_rescue_trust_projection_rebuilds_total", {
      subject_type: subjectType,
      status: "success",
    });
    observeHistogram("food_rescue_trust_projection_rebuild_duration_ms", {
      subject_type: subjectType,
      status: "success",
    }, Date.now() - startedAt);

    return {
      subjectType,
      subjectId,
      eventCount: events.length,
      projection,
      score,
      restriction,
    };
  } catch (err) {
    incrementCounter("food_rescue_trust_projection_rebuilds_total", {
      subject_type: subjectType || "unknown",
      status: "failure",
    });
    observeHistogram("food_rescue_trust_projection_rebuild_duration_ms", {
      subject_type: subjectType || "unknown",
      status: "failure",
    }, Date.now() - startedAt);
    throw err;
  }
}

module.exports = {
  applyTrustEventProjection,
  buildTrustEffect,
  buildTrustProjectionFromEvents,
  calculateRestrictionLevel,
  effectHash,
  getTrustFarmingConfig,
  projectOperationalTrustState,
  rebuildTrustProjectionForSubject,
  RESTRICTION_THRESHOLDS,
};
