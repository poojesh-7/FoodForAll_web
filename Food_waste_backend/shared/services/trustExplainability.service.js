const crypto = require("crypto");
const pool = require("../config/db");
const {
  SUBJECT_TYPES,
  appendTrustEventIfMissing,
  getTrustEvents,
  getTrustSubject,
  isUuid,
} = require("./trustEvent.service");
const {
  getTrustProjectionBreakdown,
} = require("./trustObservability.service");
const { buildTrustEffect } = require("./trustProjection.service");

const ADMIN_TRUST_ACTION_TYPES = new Set([
  "MANUAL_RESTRICTION",
  "MANUAL_COOLDOWN",
  "MANUAL_RECOVERY_CREDIT",
  "VERIFIED_GOOD_BEHAVIOR",
  "TRUST_REVIEW_FLAG",
]);

const ACTION_LABELS = {
  MANUAL_RESTRICTION: "Manual Restriction",
  MANUAL_COOLDOWN: "Manual Cooldown",
  MANUAL_RECOVERY_CREDIT: "Manual Recovery Credit",
  VERIFIED_GOOD_BEHAVIOR: "Verified Good Behavior",
  TRUST_REVIEW_FLAG: "Trust Review Flag",
};

const EVENT_LABELS = {
  admin_manual_restriction: "Manual restriction recorded",
  admin_manual_cooldown: "Manual cooldown recorded",
  admin_trust_review_flag: "Trust review flag added",
  verified_good_behavior: "Verified good behavior",
  provider_report_validated: "Validated provider report",
  provider_successful_fulfillment: "Provider fulfillment completed",
  provider_listing_expired: "Listing expiry observed",
  user_pickup_completed: "Pickup completed",
  user_pickup_failed: "Pickup failed",
  user_cancelled_reservation: "Reservation cancelled",
  user_payment_timeout: "Payment timeout",
  ngo_delivery_completed: "NGO delivery completed",
  ngo_delivery_failed: "NGO delivery failed",
  ngo_cancelled_reservation: "NGO reservation cancelled",
  ngo_unpicked_expired: "NGO pickup expired",
  volunteer_delivery_completed: "Volunteer delivery completed",
  volunteer_delivery_failed: "Volunteer delivery failed",
  volunteer_assignment_timeout: "Volunteer assignment timeout",
};

function invalid(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function compactText(value, maxLength = 500) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : "";
}

function normalizeSubject(subjectType, subjectId) {
  if (!SUBJECT_TYPES.has(subjectType) || subjectType === "system" || !isUuid(subjectId)) {
    throw invalid("Invalid trust subject");
  }

  return { subjectType, subjectId: String(subjectId) };
}

function normalizeActionType(value) {
  const actionType = String(value || "").trim().toUpperCase();
  if (!ADMIN_TRUST_ACTION_TYPES.has(actionType)) {
    throw invalid("Invalid admin trust action type");
  }
  return actionType;
}

function normalizeDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function boundedLevel(value, fallback = null, min = 1, max = 5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.trunc(number), max));
}

function parseFutureDate(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return null;
  return date > new Date() ? date : null;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function humanize(value) {
  return String(value || "-")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventLabel(eventType) {
  return EVENT_LABELS[eventType] || humanize(eventType);
}

function effectImpact(event) {
  const effect = buildTrustEffect(event);
  const impact = [];

  if (effect.analyticsOnly) impact.push("Audit only");
  if (effect.rawScoreDelta !== effect.scoreDelta && effect.rawScoreDelta > 0) {
    impact.push("Score gain suppressed");
  }
  if (effect.scoreDelta !== 0) {
    impact.push(`Trust score ${effect.scoreDelta > 0 ? "+" : ""}${effect.scoreDelta}`);
  }
  if (effect.penaltyDelta > 0) impact.push(`Penalty +${effect.penaltyDelta}`);
  if (effect.failureDelta > 0) impact.push(`Failure +${effect.failureDelta}`);
  if (effect.cancellationDelta > 0) impact.push(`Cancellation +${effect.cancellationDelta}`);
  if (effect.timeoutDelta > 0) impact.push(`Timeout +${effect.timeoutDelta}`);
  if (effect.completionDelta > 0) impact.push(`Completion +${effect.completionDelta}`);
  if (effect.fulfillmentDelta > 0) impact.push(`Fulfillment +${effect.fulfillmentDelta}`);
  if (effect.refundDelta > 0) impact.push(`Refund +${effect.refundDelta}`);
  if (effect.explicitRestrictionLevel !== null) {
    impact.push(`Restriction level ${effect.explicitRestrictionLevel}`);
  }
  if (effect.cooldownUntil) {
    impact.push(`Cooldown until ${effect.cooldownUntil.toISOString()}`);
  }
  if (effect.depositMultiplierDelta > 0) {
    impact.push(`Deposit multiplier adjustment +${effect.depositMultiplierDelta}`);
  }

  return {
    effect,
    impact: impact.length ? impact : ["No direct projection impact"],
  };
}

function timelineEvent(event) {
  const { effect, impact } = effectImpact(event);
  return {
    id: event.id,
    eventKey: event.event_key,
    eventType: event.event_type,
    title: eventLabel(event.event_type),
    timestamp: event.created_at,
    sourceType: event.source_type,
    sourceId: event.source_id,
    processingStatus: event.processing_status,
    impact,
    polarity:
      effect.failureDelta > 0 ||
      effect.timeoutDelta > 0 ||
      effect.cancellationDelta > 0 ||
      effect.scoreDelta < 0 ||
      effect.penaltyDelta > 0
        ? "negative"
        : effect.completionDelta > 0 ||
            effect.fulfillmentDelta > 0 ||
            effect.refundDelta > 0 ||
            effect.scoreDelta > 0
          ? "positive"
          : "neutral",
  };
}

function pickRecent(events, predicate, limit = 5) {
  return events
    .filter(predicate)
    .slice(-limit)
    .reverse()
    .map((event) => ({
      eventType: event.eventType,
      title: event.title,
      timestamp: event.timestamp,
      impact: event.impact,
    }));
}

function restrictionReason(score, triggerSources) {
  if (Number(score?.projected_restriction_level ?? score?.restriction_level ?? 0) <= 0) {
    return "No active trust restriction.";
  }
  if (triggerSources.includes("manual")) {
    return "Administrative trust restriction is active.";
  }
  if (triggerSources.includes("streak")) {
    return "Repeated failures occurred without enough successful recovery activity.";
  }
  if (triggerSources.includes("penalty")) {
    return "Accumulated trust penalties from operational issues crossed a restriction threshold.";
  }
  if (triggerSources.includes("score")) {
    return "Trust score is below the active restriction threshold.";
  }
  return "Current trust risk state requires a restriction.";
}

function buildExplanations(score, timeline) {
  const riskState = score?.risk_state || {};
  const projectedActions = score?.projected_actions || {};
  const recoveryState = score?.recovery_state || {};
  const scoreBreakdown = score?.score_breakdown || {};
  const triggerSources =
    riskState.restriction_trigger_sources ||
    projectedActions.restriction_trigger_sources ||
    [];
  const restrictionLevel = Number(score?.projected_restriction_level ?? score?.restriction_level ?? 0);
  const cooldownUntil = score?.projected_cooldown_until ?? score?.cooldown_until ?? null;
  const depositMultiplier = Number(
    score?.projected_deposit_multiplier ?? score?.deposit_multiplier ?? 1
  );
  const negativeEvents = pickRecent(timeline, (event) => event.polarity === "negative");
  const manualEvents = pickRecent(
    timeline,
    (event) => String(event.sourceType) === "admin_trust_action"
  );
  const scoreEvents = pickRecent(
    timeline,
    (event) => event.impact.some((item) => item.startsWith("Trust score"))
  );

  return {
    restriction: {
      active: restrictionLevel > 0,
      current: restrictionLevel > 0 ? `Level ${restrictionLevel} Restriction` : "No Restriction",
      reason: restrictionReason(score, triggerSources),
      triggerSources,
      sourceEvents: manualEvents.length ? manualEvents : negativeEvents,
    },
    cooldown: {
      active: Boolean(cooldownUntil),
      current: cooldownUntil ? `Cooldown until ${new Date(cooldownUntil).toISOString()}` : "No Cooldown",
      reason: cooldownUntil
        ? "Recent trust risk requires a temporary pause before more platform actions."
        : "No active trust cooldown.",
      sourceEvents: negativeEvents,
    },
    deposit: {
      active: depositMultiplier > 1,
      current: `${depositMultiplier}x`,
      reason:
        depositMultiplier > 1
          ? "Current trust risk level requires an additional reliability deposit."
          : "No extra reliability deposit multiplier is active.",
      sourceEvents: negativeEvents,
    },
    scoreChange: {
      current: Number(score?.trust_score ?? 100),
      reason: scoreBreakdown.event_type
        ? `Latest processed event: ${eventLabel(scoreBreakdown.event_type)}.`
        : "No processed trust score change is available yet.",
      previousScore: scoreBreakdown.previous_score ?? null,
      projectedScore: scoreBreakdown.projected_score ?? score?.trust_score ?? null,
      recoveryCredit: scoreBreakdown.recovery_credit ?? 0,
      decayCredit: scoreBreakdown.decay_credit ?? 0,
      sourceEvents: scoreEvents,
    },
    recovery: {
      progress: Number(score?.recovery_progress ?? 100),
      successStreak: Number(score?.success_streak ?? 0),
      failureStreak: Number(score?.failure_streak ?? 0),
      requirements:
        riskState.recovery_requirements ||
        recoveryState.recovery_requirements ||
        projectedActions.recovery_requirements ||
        {},
    },
  };
}

function currentState(score) {
  return {
    trustScore: Number(score?.trust_score ?? 100),
    penaltyLevel: Number(score?.penalty_level ?? 0),
    restrictionLevel: Number(score?.projected_restriction_level ?? score?.restriction_level ?? 0),
    cooldownUntil: score?.projected_cooldown_until ?? score?.cooldown_until ?? null,
    depositMultiplier: Number(score?.projected_deposit_multiplier ?? score?.deposit_multiplier ?? 1),
    riskCategory: score?.risk_category || "normal",
    recoveryProgress: Number(score?.recovery_progress ?? 100),
    successStreak: Number(score?.success_streak ?? 0),
    failureStreak: Number(score?.failure_streak ?? 0),
    lastEventAt: score?.last_event_at || null,
    updatedAt: score?.updated_at || null,
  };
}

async function listAdminTrustActions({ db = pool, subjectType, subjectId, limit = 50 }) {
  const result = await db.query(
    `
    SELECT ata.id, ata.admin_user_id, u.name AS admin_name, u.role AS admin_role,
           ata.subject_type, ata.subject_id, ata.action_type, ata.reason,
           ata.trust_event_key, ata.details, ata.created_at,
           te.id AS trust_event_id, te.event_type, te.processing_status,
           te.processed_at
    FROM admin_trust_actions ata
    LEFT JOIN users u ON u.id=ata.admin_user_id
    LEFT JOIN trust_events te ON te.event_key=ata.trust_event_key
    WHERE ata.subject_type=$1
    AND ata.subject_id=$2
    ORDER BY ata.created_at DESC
    LIMIT $3
    `,
    [subjectType, subjectId, Math.max(1, Math.min(Number(limit || 50), 100))]
  );

  return result.rows.map((row) => ({
    ...row,
    action_label: ACTION_LABELS[row.action_type] || humanize(row.action_type),
  }));
}

async function loadAdminTrustActionByIdempotencyKey(client, idempotencyKey) {
  if (!idempotencyKey) return null;

  const result = await client.query(
    `
    SELECT ata.*, te.id AS trust_event_id, te.event_key, te.event_type,
           te.processing_status, te.processed_at
    FROM admin_trust_actions ata
    LEFT JOIN trust_events te ON te.event_key=ata.trust_event_key
    WHERE ata.idempotency_key=$1
    LIMIT 1
    `,
    [idempotencyKey]
  );
  const row = result.rows[0] || null;
  if (!row) return null;

  return {
    action: {
      ...row,
      action_label: ACTION_LABELS[row.action_type] || humanize(row.action_type),
    },
    trustEvent: row.event_key
      ? {
          id: row.trust_event_id,
          event_key: row.event_key,
          event_type: row.event_type,
          processing_status: row.processing_status,
          processed_at: row.processed_at,
        }
      : null,
  };
}

async function getTrustExplainability(options = {}) {
  const db = options.db || pool;
  const { subjectType, subjectId } = normalizeSubject(
    options.subjectType || options.subject_type,
    options.subjectId || options.subject_id
  );
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 200));

  const [trust, events, projection, auditHistory] = await Promise.all([
    getTrustSubject({ subjectType, subjectId, db }),
    getTrustEvents({ subjectType, subjectId, limit, db }),
    getTrustProjectionBreakdown({ subjectType, subjectId, db }),
    listAdminTrustActions({ db, subjectType, subjectId }),
  ]);

  const timeline = [...events]
    .sort((left, right) => {
      const leftTime = new Date(left.created_at || 0).getTime();
      const rightTime = new Date(right.created_at || 0).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.id || "").localeCompare(String(right.id || ""));
    })
    .map(timelineEvent);
  const score = trust.score || projection.projection || null;

  return {
    subject: { subjectType, subjectId },
    currentState: currentState(score),
    explanations: buildExplanations(score, timeline),
    timeline,
    eventBreakdown: timeline.map((event) => ({
      eventType: event.eventType,
      title: event.title,
      timestamp: event.timestamp,
      impact: event.impact,
      processingStatus: event.processingStatus,
    })),
    projectionDiagnostics: {
      currentTrustState: currentState(score),
      generatedFromEventCount: projection.replayLineage?.eventCount || timeline.length,
      firstEventAt: projection.replayLineage?.firstEventAt || timeline[0]?.timestamp || null,
      lastEventAt:
        projection.replayLineage?.lastEventAt ||
        timeline[timeline.length - 1]?.timestamp ||
        null,
      replayConsistent: Boolean(projection.diagnostics?.consistent),
      mismatchCount: Number(projection.diagnostics?.mismatchCount || 0),
      checksumMatch: Boolean(projection.diagnostics?.checksumMatch),
    },
    auditHistory,
  };
}

async function loadCurrentRestrictionLevel(client, subjectType, subjectId) {
  const result = await client.query(
    `
    SELECT projected_restriction_level, restriction_level
    FROM trust_scores
    WHERE subject_type=$1 AND subject_id=$2
    `,
    [subjectType, subjectId]
  );
  const row = result.rows[0] || {};
  return Number(row.projected_restriction_level ?? row.restriction_level ?? 0);
}

function normalizeAdminTrustAction({ actionType, reason, details, currentRestrictionLevel = 0 }) {
  const normalizedActionType = normalizeActionType(actionType);
  const normalizedReason = compactText(reason, 1000);
  if (!normalizedReason) throw invalid("Action reason is required");

  const inputDetails = normalizeDetails(details);
  const normalizedDetails = {};

  if (normalizedActionType === "MANUAL_RESTRICTION") {
    normalizedDetails.restriction_level = boundedLevel(
      inputDetails.restriction_level ?? inputDetails.restrictionLevel,
      null
    );
    if (normalizedDetails.restriction_level === null) {
      throw invalid("Restriction level is required");
    }
  }

  if (normalizedActionType === "MANUAL_COOLDOWN") {
    const cooldownUntil = parseFutureDate(
      inputDetails.cooldown_until ?? inputDetails.cooldownUntil
    );
    if (!cooldownUntil) throw invalid("Future cooldown timestamp is required");

    const requestedLevel = boundedLevel(
      inputDetails.restriction_level ?? inputDetails.restrictionLevel,
      3,
      3,
      5
    );
    normalizedDetails.cooldown_until = cooldownUntil.toISOString();
    normalizedDetails.restriction_level = Math.max(
      requestedLevel,
      Math.min(5, numberOrZero(currentRestrictionLevel) + 1)
    );
  }

  if (normalizedActionType === "TRUST_REVIEW_FLAG") {
    normalizedDetails.review_flag = true;
  }

  return {
    actionType: normalizedActionType,
    reason: normalizedReason,
    details: {
      ...inputDetails,
      ...normalizedDetails,
    },
  };
}

function buildAdminTrustActionEvent({
  actionId,
  adminId,
  subjectType,
  subjectId,
  actionType,
  reason,
  details = {},
}) {
  const eventKey = `trust:${subjectType}:${subjectId}:admin_action:${actionId}`;
  const metadata = {
    admin_action_id: actionId,
    admin_id: adminId || null,
    action_type: actionType,
    reason,
    action_details: details,
    source_lineage: "admin.trust_action",
  };
  const payload = {
    score_delta: 0,
    metadata,
  };
  let eventType = "admin_trust_review_flag";

  if (actionType === "MANUAL_RESTRICTION") {
    eventType = "admin_manual_restriction";
    payload.restriction_level = details.restriction_level;
    payload.restriction_type = "admin_manual_restriction";
  } else if (actionType === "MANUAL_COOLDOWN") {
    eventType = "admin_manual_cooldown";
    payload.restriction_level = details.restriction_level;
    payload.cooldown_until = details.cooldown_until;
    payload.restriction_type = "admin_manual_cooldown";
  } else if (
    actionType === "MANUAL_RECOVERY_CREDIT" ||
    actionType === "VERIFIED_GOOD_BEHAVIOR"
  ) {
    eventType = "verified_good_behavior";
    payload.score_delta = 3;
    payload.completion_delta = 1;
    payload.metadata = {
      ...metadata,
      verified_good_behavior: true,
      recovery_route:
        actionType === "MANUAL_RECOVERY_CREDIT"
          ? "admin_manual_recovery_credit"
          : "admin_verified_good_behavior",
    };
  } else if (actionType === "TRUST_REVIEW_FLAG") {
    payload.analytics_only = true;
    payload.metadata = {
      ...metadata,
      review_flag: true,
    };
  }

  return {
    eventKey,
    subjectType,
    subjectId,
    sourceType: "admin_trust_action",
    sourceId: actionId,
    eventType,
    eventPayload: payload,
  };
}

async function recordAdminTrustAction({
  client = pool,
  adminId,
  subjectType,
  subjectId,
  actionType,
  reason,
  details,
  idempotencyKey,
} = {}) {
  const subject = normalizeSubject(subjectType, subjectId);
  const currentRestrictionLevel = await loadCurrentRestrictionLevel(
    client,
    subject.subjectType,
    subject.subjectId
  );
  const action = normalizeAdminTrustAction({
    actionType,
    reason,
    details,
    currentRestrictionLevel,
  });
  const actionId = crypto.randomUUID();
  const normalizedIdempotencyKey = compactText(idempotencyKey, 240) || null;
  const event = buildAdminTrustActionEvent({
    actionId,
    adminId,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    ...action,
  });

  const audit = await client.query(
    `
    INSERT INTO admin_trust_actions (
      id, admin_user_id, subject_type, subject_id, action_type,
      reason, idempotency_key, trust_event_key, details
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING *
    `,
    [
      actionId,
      adminId || null,
      subject.subjectType,
      subject.subjectId,
      action.actionType,
      action.reason,
      normalizedIdempotencyKey,
      event.eventKey,
      JSON.stringify(action.details),
    ]
  );

  if (audit.rowCount === 0 && normalizedIdempotencyKey) {
    const existing = await loadAdminTrustActionByIdempotencyKey(
      client,
      normalizedIdempotencyKey
    );
    if (existing) {
      return {
        subject,
        action: existing.action,
        trustEvent: existing.trustEvent,
        inserted: false,
        duplicate: true,
      };
    }
    throw invalid("Duplicate admin trust action is already being processed", 409);
  }

  const trustEvent = await appendTrustEventIfMissing(event, {
    db: client,
    enqueue: false,
    recordOperationalEvent: false,
  });

  return {
    subject,
    action: {
      ...audit.rows[0],
      action_label: ACTION_LABELS[action.actionType] || humanize(action.actionType),
    },
    trustEvent: trustEvent.event,
    inserted: trustEvent.inserted,
    duplicate: false,
  };
}

module.exports = {
  ADMIN_TRUST_ACTION_TYPES,
  buildAdminTrustActionEvent,
  effectImpact,
  getTrustExplainability,
  normalizeAdminTrustAction,
  recordAdminTrustAction,
};
