const pool = require("../config/db");
const { providerDisplaySelect } = require("./providerDisplay.service");
const {
  getGovernanceIntelligenceSummary,
  normalizeFilters,
} = require("./governanceIntelligence.service");

const ACTIVE_CASE_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "AWAITING_RESPONSE",
  "ESCALATED",
];

const GOVERNANCE_NOTIFICATION_TYPES = [
  "provider_report_submitted",
  "provider_report_submitted_against_provider",
  "moderation_case_escalated",
  "moderation_provider_response_submitted",
  "moderation_appeal_submitted",
  "moderation_appeal_withdrawn",
  "moderation_case_awaiting_response",
  "moderation_case_validated",
  "moderation_case_dismissed",
  "moderation_appeal_under_review",
  "moderation_appeal_accepted",
  "moderation_appeal_rejected",
];

function toInt(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toFloat(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeDashboardFilters(options = {}) {
  const queueLimit = Number(options.queueLimit || options.queue_limit || 10);
  const activityLimit = Number(options.activityLimit || options.activity_limit || 12);
  const filters = normalizeFilters({
    windowDays: options.windowDays || options.window_days || options.days,
    limit: options.limit,
    risk: options.risk || options.riskLevel || options.risk_level,
    reporterId: options.reporterId || options.reporter_id,
    providerId: options.providerId || options.provider_id,
  });

  return {
    ...filters,
    queueLimit: Number.isFinite(queueLimit)
      ? Math.max(1, Math.min(Math.trunc(queueLimit), 25))
      : 10,
    activityLimit: Number.isFinite(activityLimit)
      ? Math.max(1, Math.min(Math.trunc(activityLimit), 50))
      : 12,
  };
}

function governanceWindow(filters, generatedAt = new Date()) {
  const generated = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  return {
    days: filters.windowDays,
    start_at: new Date(
      generated.getTime() - filters.windowDays * 24 * 60 * 60 * 1000
    ).toISOString(),
    end_at: generated.toISOString(),
  };
}

function publicFilters(filters) {
  return {
    window_days: filters.windowDays,
    limit: filters.limit,
    queue_limit: filters.queueLimit,
    activity_limit: filters.activityLimit,
    risk: filters.risk,
    reporter_id: filters.reporterId,
    provider_id: filters.providerId,
  };
}

function source(table, predicate, windowed = false) {
  return {
    table,
    predicate,
    windowed,
  };
}

function metricCard({ id, label, value, href, source: metricSource, detail = null }) {
  return {
    id,
    label,
    value: toInt(value),
    detail,
    href,
    source: metricSource,
  };
}

function activeCasePredicate(alias = "mc") {
  return `${alias}.status IN ('${ACTIVE_CASE_STATUSES.join("','")}')`;
}

function actorTrustHref(row) {
  if (!row?.subject_type || !row?.subject_id) return "/admin/trust";
  return `/admin/trust?subjectType=${encodeURIComponent(row.subject_type)}&subjectId=${encodeURIComponent(String(row.subject_id))}`;
}

function caseHref(caseId) {
  return caseId ? `/admin/moderation-cases/${caseId}` : "/admin/provider-reports";
}

function appealHref(status = "open") {
  return `/admin/moderation-appeals?status=${encodeURIComponent(status)}`;
}

function intelligenceHref(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `/admin/governance-intelligence?${query}` : "/admin/governance-intelligence";
}

async function getCaseStatusCounts(client = pool) {
  const result = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_cases,
      COUNT(*) FILTER (WHERE status = 'UNDER_REVIEW')::int AS under_review_cases,
      COUNT(*) FILTER (WHERE status = 'AWAITING_RESPONSE')::int AS awaiting_response_cases,
      COUNT(*) FILTER (WHERE status = 'ESCALATED')::int AS escalated_cases,
      COUNT(*) FILTER (
        WHERE status IN ('OPEN', 'UNDER_REVIEW', 'AWAITING_RESPONSE', 'ESCALATED')
      )::int AS active_cases
    FROM moderation_cases
  `);

  const row = result.rows[0] || {};
  return {
    open_cases: toInt(row.open_cases),
    under_review_cases: toInt(row.under_review_cases),
    awaiting_response_cases: toInt(row.awaiting_response_cases),
    escalated_cases: toInt(row.escalated_cases),
    active_cases: toInt(row.active_cases),
  };
}

async function getAppealStatusCounts({ client = pool, filters }) {
  const result = await client.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'SUBMITTED')::int AS appeals_pending_review,
      COUNT(*) FILTER (WHERE status = 'UNDER_REVIEW')::int AS appeals_under_review,
      COUNT(*) FILTER (
        WHERE status = 'ACCEPTED'
        AND COALESCE(reviewed_at, updated_at, created_at) >= NOW() - ($1::int * INTERVAL '1 day')
      )::int AS appeals_accepted,
      COUNT(*) FILTER (
        WHERE status = 'REJECTED'
        AND COALESCE(reviewed_at, updated_at, created_at) >= NOW() - ($1::int * INTERVAL '1 day')
      )::int AS appeals_rejected
    FROM moderation_appeals
    `,
    [filters.windowDays]
  );

  const row = result.rows[0] || {};
  return {
    appeals_pending_review: toInt(row.appeals_pending_review),
    appeals_under_review: toInt(row.appeals_under_review),
    appeals_accepted: toInt(row.appeals_accepted),
    appeals_rejected: toInt(row.appeals_rejected),
  };
}

async function listModerationCases({ client = pool, status = null, limit = 10, oldestOnly = false }) {
  const result = await client.query(
    `
    SELECT mc.id,
           mc.case_type,
           mc.subject_type,
           mc.subject_id,
           ${providerDisplaySelect("restaurant", "subject_user")} AS subject_name,
           mc.status,
           mc.reason,
           mc.summary,
           mc.source_report_id,
           mc.created_at,
           mc.updated_at,
           mc.closed_at,
           pr.id AS report_id,
           pr.reason AS report_reason,
           pr.status AS report_status,
           pr.created_at AS report_created_at,
           reporter.name AS reporter_name,
           reporter.role AS reporter_role,
           f.title AS listing_title,
           COALESCE(response_counts.provider_response_count, 0)::int AS provider_response_count,
           COALESCE(appeal_counts.appeal_count, 0)::int AS appeal_count,
           latest_event.event_type AS latest_event_type,
           latest_event.created_at AS latest_event_at
    FROM moderation_cases mc
    JOIN users subject_user ON subject_user.id = mc.subject_id
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id = subject_user.id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    LEFT JOIN LATERAL (
      SELECT pr_inner.*
      FROM provider_reports pr_inner
      WHERE pr_inner.id = mc.source_report_id
         OR pr_inner.moderation_case_id = mc.id
      ORDER BY CASE WHEN pr_inner.id = mc.source_report_id THEN 0 ELSE 1 END,
               pr_inner.created_at DESC
      LIMIT 1
    ) pr ON true
    LEFT JOIN users reporter ON reporter.id = pr.reported_by
    LEFT JOIN reservations r ON r.id = pr.reservation_id
    LEFT JOIN food_listings f ON f.id = r.listing_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS provider_response_count
      FROM provider_case_responses pcr
      WHERE pcr.case_id = mc.id
    ) response_counts ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS appeal_count
      FROM moderation_appeals ma
      WHERE ma.case_id = mc.id
    ) appeal_counts ON true
    LEFT JOIN LATERAL (
      SELECT mce.event_type, mce.created_at
      FROM moderation_case_events mce
      WHERE mce.case_id = mc.id
      ORDER BY mce.created_at DESC, mce.id DESC
      LIMIT 1
    ) latest_event ON true
    WHERE (
      $1::text IS NULL
      AND ${activeCasePredicate("mc")}
    )
    OR mc.status = $1::text
    ORDER BY
      CASE
        WHEN mc.status = 'OPEN' THEN 0
        WHEN mc.status = 'AWAITING_RESPONSE' THEN 1
        WHEN mc.status = 'UNDER_REVIEW' THEN 2
        WHEN mc.status = 'ESCALATED' THEN 3
        ELSE 4
      END,
      mc.created_at ASC,
      mc.updated_at ASC
    LIMIT $2
    `,
    [status, oldestOnly ? 1 : limit]
  );

  return result.rows.map((row) => ({
    ...row,
    href: caseHref(row.id),
    source: source("moderation_cases", status ? `status = '${status}'` : activeCasePredicate("moderation_cases")),
  }));
}

async function listRecentModerationActivity({ client = pool, filters }) {
  const result = await client.query(
    `
    SELECT *
    FROM (
      SELECT 'moderation_case_event' AS source_type,
             mce.id,
             mce.case_id,
             NULL::uuid AS appeal_id,
             mce.actor_user_id,
             actor.name AS actor_name,
             actor.role AS actor_role,
             mce.event_type,
             mce.from_status,
             mce.to_status,
             mce.note,
             mce.metadata,
             mce.created_at,
             mc.status AS case_status,
             mc.subject_id,
             ${providerDisplaySelect("case_restaurant", "case_subject")} AS subject_name
      FROM moderation_case_events mce
      JOIN moderation_cases mc ON mc.id = mce.case_id
      JOIN users case_subject ON case_subject.id = mc.subject_id
      LEFT JOIN users actor ON actor.id = mce.actor_user_id
      LEFT JOIN LATERAL (
        SELECT restaurant_name,
               NULL::text AS business_name
        FROM restaurants
        WHERE user_id = case_subject.id
        ORDER BY is_verified DESC, id DESC
        LIMIT 1
      ) case_restaurant ON true
      WHERE mce.created_at >= NOW() - ($1::int * INTERVAL '1 day')

      UNION ALL

      SELECT 'moderation_appeal_event' AS source_type,
             mae.id,
             mae.case_id,
             mae.appeal_id,
             mae.actor_user_id,
             actor.name AS actor_name,
             actor.role AS actor_role,
             mae.event_type,
             mae.from_status,
             mae.to_status,
             mae.note,
             mae.metadata,
             mae.created_at,
             mc.status AS case_status,
             mc.subject_id,
             ${providerDisplaySelect("appeal_restaurant", "appeal_subject")} AS subject_name
      FROM moderation_appeal_events mae
      JOIN moderation_cases mc ON mc.id = mae.case_id
      JOIN users appeal_subject ON appeal_subject.id = mc.subject_id
      LEFT JOIN users actor ON actor.id = mae.actor_user_id
      LEFT JOIN LATERAL (
        SELECT restaurant_name,
               NULL::text AS business_name
        FROM restaurants
        WHERE user_id = appeal_subject.id
        ORDER BY is_verified DESC, id DESC
        LIMIT 1
      ) appeal_restaurant ON true
      WHERE mae.created_at >= NOW() - ($1::int * INTERVAL '1 day')
    ) activity
    ORDER BY activity.created_at DESC, activity.id DESC
    LIMIT $2
    `,
    [filters.windowDays, filters.activityLimit]
  );

  return result.rows.map((row) => ({
    ...row,
    href: caseHref(row.case_id),
    source: source(row.source_type === "moderation_case_event" ? "moderation_case_events" : "moderation_appeal_events", "created_at within selected window", true),
  }));
}

async function listAppealsByStatus({ client = pool, status, filters, limit = 8 }) {
  const terminal = ["ACCEPTED", "REJECTED", "WITHDRAWN"].includes(status);
  const result = await client.query(
    `
    SELECT ma.id,
           ma.case_id,
           ma.provider_id,
           ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
           ma.status,
           ma.submitted_at,
           ma.reviewed_at,
           ma.updated_at,
           ma.decision_note,
           mc.status AS case_status,
           mc.reason AS case_reason,
           mc.summary AS case_summary,
           pr.reason AS report_reason,
           f.title AS listing_title
    FROM moderation_appeals ma
    JOIN moderation_cases mc ON mc.id = ma.case_id
    JOIN users provider ON provider.id = ma.provider_id
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id = provider.id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    LEFT JOIN provider_reports pr ON pr.id = mc.source_report_id
      OR pr.moderation_case_id = mc.id
    LEFT JOIN reservations r ON r.id = pr.reservation_id
    LEFT JOIN food_listings f ON f.id = r.listing_id
    WHERE ma.status = $1
    AND (
      $2::boolean = false
      OR COALESCE(ma.reviewed_at, ma.updated_at, ma.created_at) >= NOW() - ($3::int * INTERVAL '1 day')
    )
    ORDER BY
      CASE WHEN $2::boolean THEN COALESCE(ma.reviewed_at, ma.updated_at, ma.created_at) ELSE ma.submitted_at END DESC,
      ma.id DESC
    LIMIT $4
    `,
    [status, terminal, filters.windowDays, limit]
  );

  return result.rows.map((row) => ({
    ...row,
    href: caseHref(row.case_id),
    source: source("moderation_appeals", terminal ? `status = '${status}' and reviewed in selected window` : `status = '${status}'`, terminal),
  }));
}

async function getTrustVisibilitySummary(client = pool) {
  const result = await client.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE GREATEST(projected_restriction_level, restriction_level) > 0
      )::int AS restricted_actors,
      COUNT(*) FILTER (
        WHERE COALESCE(projected_cooldown_until, cooldown_until) > NOW()
      )::int AS cooldown_actors,
      COUNT(*) FILTER (
        WHERE GREATEST(projected_deposit_multiplier, deposit_multiplier) > 1
      )::int AS high_deposit_multiplier_actors,
      COUNT(*) FILTER (
        WHERE risk_category IN ('high', 'severe', 'critical')
      )::int AS high_risk_trust_actors
    FROM trust_scores
  `);

  const row = result.rows[0] || {};
  return {
    restricted_actors: toInt(row.restricted_actors),
    cooldown_actors: toInt(row.cooldown_actors),
    high_deposit_multiplier_actors: toInt(row.high_deposit_multiplier_actors),
    high_risk_trust_actors: toInt(row.high_risk_trust_actors),
  };
}

async function listTrustActors({ client = pool, mode, limit = 8 }) {
  const predicates = {
    restricted: "GREATEST(ts.projected_restriction_level, ts.restriction_level) > 0",
    cooldown: "COALESCE(ts.projected_cooldown_until, ts.cooldown_until) > NOW()",
    deposit: "GREATEST(ts.projected_deposit_multiplier, ts.deposit_multiplier) > 1",
  };
  const predicate = predicates[mode] || predicates.restricted;

  const result = await client.query(
    `
    SELECT ts.subject_type,
           ts.subject_id,
           actor.name AS actor_name,
           actor.role AS actor_role,
           ts.trust_score,
           ts.penalty_level,
           GREATEST(ts.projected_restriction_level, ts.restriction_level) AS restriction_level,
           COALESCE(ts.projected_cooldown_until, ts.cooldown_until) AS cooldown_until,
           GREATEST(ts.projected_deposit_multiplier, ts.deposit_multiplier) AS deposit_multiplier,
           ts.risk_category,
           ts.recovery_progress,
           ts.updated_at,
           ts.last_event_at
    FROM trust_scores ts
    LEFT JOIN users actor ON actor.id = ts.subject_id
    WHERE ${predicate}
    ORDER BY
      GREATEST(ts.projected_restriction_level, ts.restriction_level) DESC,
      GREATEST(ts.projected_deposit_multiplier, ts.deposit_multiplier) DESC,
      ts.trust_score ASC,
      ts.updated_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return result.rows.map((row) => ({
    ...row,
    trust_score: toFloat(row.trust_score),
    penalty_level: toInt(row.penalty_level),
    restriction_level: toInt(row.restriction_level),
    deposit_multiplier: toFloat(row.deposit_multiplier),
    recovery_progress: toFloat(row.recovery_progress),
    href: actorTrustHref(row),
    source: source("trust_scores", predicate),
  }));
}

async function listRecentAdminTrustActions({ client = pool, filters }) {
  const result = await client.query(
    `
    SELECT ata.id,
           ata.admin_user_id,
           admin.name AS admin_name,
           ata.subject_type,
           ata.subject_id,
           subject_user.name AS subject_name,
           subject_user.role AS subject_role,
           ata.action_type,
           ata.reason,
           ata.trust_event_key,
           ata.details,
           ata.created_at
    FROM admin_trust_actions ata
    LEFT JOIN users admin ON admin.id = ata.admin_user_id
    LEFT JOIN users subject_user ON subject_user.id = ata.subject_id
    WHERE ata.created_at >= NOW() - ($1::int * INTERVAL '1 day')
    ORDER BY ata.created_at DESC, ata.id DESC
    LIMIT $2
    `,
    [filters.windowDays, filters.activityLimit]
  );

  return result.rows.map((row) => ({
    ...row,
    href: actorTrustHref(row),
    source: source("admin_trust_actions", "created_at within selected window", true),
  }));
}

function notificationHref(type) {
  if (String(type || "").includes("appeal")) return "/admin/moderation-appeals";
  if (String(type || "").includes("trust")) return "/admin/trust";
  if (String(type || "").includes("provider_report")) return "/admin/provider-reports";
  return "/admin/provider-reports";
}

async function listRecentGovernanceNotifications({ client = pool, filters }) {
  const result = await client.query(
    `
    SELECT n.id,
           n.user_id,
           recipient.name AS recipient_name,
           recipient.role AS recipient_role,
           n.type,
           n.title,
           n.message,
           n.is_read,
           n.created_at
    FROM notifications n
    LEFT JOIN users recipient ON recipient.id = n.user_id
    WHERE n.type = ANY($2::text[])
    AND n.created_at >= NOW() - ($1::int * INTERVAL '1 day')
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT $3
    `,
    [filters.windowDays, GOVERNANCE_NOTIFICATION_TYPES, filters.activityLimit]
  );

  return result.rows.map((row) => ({
    ...row,
    href: notificationHref(row.type),
    source: source("notifications", "type is governance-related and created_at within selected window", true),
  }));
}

function signalTypeFilter(signals = [], signalType) {
  return signals.filter((signal) => signal.signal_type === signalType);
}

function topProvidersBy(providers = [], field) {
  return [...providers]
    .filter((provider) => toInt(provider[field]) > 0)
    .sort((left, right) => toInt(right[field]) - toInt(left[field]))
    .slice(0, 8);
}

function buildDashboardCards({ caseCounts, appealCounts, intelligence, trustSummary }) {
  const signalCount = Array.isArray(intelligence?.signals) ? intelligence.signals.length : 0;
  const highRiskActors =
    (intelligence?.providers || []).filter((provider) => provider.risk_level === "HIGH").length +
    (intelligence?.reporters || []).filter((reporter) => reporter.risk_level === "HIGH").length +
    toInt(trustSummary.high_risk_trust_actors);

  return [
    metricCard({
      id: "open_cases",
      label: "Open Cases",
      value: caseCounts.open_cases,
      href: "/admin/provider-reports?status=all&caseStatus=OPEN",
      source: source("moderation_cases", "status = 'OPEN'"),
    }),
    metricCard({
      id: "under_review_cases",
      label: "Under Review Cases",
      value: caseCounts.under_review_cases,
      href: "/admin/provider-reports?status=all&caseStatus=UNDER_REVIEW",
      source: source("moderation_cases", "status = 'UNDER_REVIEW'"),
    }),
    metricCard({
      id: "awaiting_response_cases",
      label: "Awaiting Response Cases",
      value: caseCounts.awaiting_response_cases,
      href: "/admin/provider-reports?status=all&caseStatus=AWAITING_RESPONSE",
      source: source("moderation_cases", "status = 'AWAITING_RESPONSE'"),
    }),
    metricCard({
      id: "escalated_cases",
      label: "Escalated Cases",
      value: caseCounts.escalated_cases,
      href: "/admin/provider-reports?status=all&caseStatus=ESCALATED",
      source: source("moderation_cases", "status = 'ESCALATED'"),
    }),
    metricCard({
      id: "appeals_pending_review",
      label: "Appeals Pending Review",
      value: appealCounts.appeals_pending_review,
      href: appealHref("SUBMITTED"),
      source: source("moderation_appeals", "status = 'SUBMITTED'"),
    }),
    metricCard({
      id: "appeals_accepted",
      label: "Appeals Accepted",
      value: appealCounts.appeals_accepted,
      href: appealHref("ACCEPTED"),
      source: source("moderation_appeals", "status = 'ACCEPTED' and reviewed in selected window", true),
    }),
    metricCard({
      id: "appeals_rejected",
      label: "Appeals Rejected",
      value: appealCounts.appeals_rejected,
      href: appealHref("REJECTED"),
      source: source("moderation_appeals", "status = 'REJECTED' and reviewed in selected window", true),
    }),
    metricCard({
      id: "governance_signals",
      label: "Governance Signals",
      value: signalCount,
      href: intelligenceHref({ windowDays: intelligence?.filters?.window_days || 90 }),
      source: source("governanceIntelligence.service", "signals generated for selected window", true),
    }),
    metricCard({
      id: "high_risk_actors",
      label: "High Risk Actors",
      value: highRiskActors,
      href: intelligenceHref({ risk: "HIGH", windowDays: intelligence?.filters?.window_days || 90 }),
      source: source("governanceIntelligence.service + trust_scores", "HIGH intelligence risk or high trust risk"),
    }),
  ];
}

async function getGovernanceDashboard(options = {}) {
  const filters = normalizeDashboardFilters(options);
  const client = options.client || pool;
  const generatedAt = new Date().toISOString();
  const window = governanceWindow(filters, generatedAt);

  const intelligencePromise =
    options.intelligence ||
    getGovernanceIntelligenceSummary({
      ...filters,
      client,
    });

  const [
    caseCounts,
    appealCounts,
    currentQueue,
    oldestOpenCases,
    awaitingResponseCases,
    escalatedCases,
    recentModerationActivity,
    pendingAppeals,
    underReviewAppeals,
    recentlyAcceptedAppeals,
    recentlyRejectedAppeals,
    trustSummary,
    restrictedActors,
    cooldownActors,
    highDepositMultiplierActors,
    recentAdminTrustActions,
    recentNotifications,
    intelligence,
  ] = await Promise.all([
    getCaseStatusCounts(client),
    getAppealStatusCounts({ client, filters }),
    listModerationCases({ client, limit: filters.queueLimit }),
    listModerationCases({ client, status: "OPEN", oldestOnly: true }),
    listModerationCases({ client, status: "AWAITING_RESPONSE", limit: filters.queueLimit }),
    listModerationCases({ client, status: "ESCALATED", limit: filters.queueLimit }),
    listRecentModerationActivity({ client, filters }),
    listAppealsByStatus({ client, status: "SUBMITTED", filters, limit: filters.queueLimit }),
    listAppealsByStatus({ client, status: "UNDER_REVIEW", filters, limit: filters.queueLimit }),
    listAppealsByStatus({ client, status: "ACCEPTED", filters, limit: filters.queueLimit }),
    listAppealsByStatus({ client, status: "REJECTED", filters, limit: filters.queueLimit }),
    getTrustVisibilitySummary(client),
    listTrustActors({ client, mode: "restricted", limit: filters.queueLimit }),
    listTrustActors({ client, mode: "cooldown", limit: filters.queueLimit }),
    listTrustActors({ client, mode: "deposit", limit: filters.queueLimit }),
    listRecentAdminTrustActions({ client, filters }),
    listRecentGovernanceNotifications({ client, filters }),
    intelligencePromise,
  ]);

  const highEscalationProviders = signalTypeFilter(
    intelligence.signals,
    "HIGH_ESCALATION_PROVIDER"
  );
  const repeatedGovernanceDisputes = signalTypeFilter(
    intelligence.signals,
    "REPEATED_GOVERNANCE_DISPUTES"
  );
  const highDismissalReporters = signalTypeFilter(
    intelligence.signals,
    "HIGH_DISMISSAL_REPORTER"
  );
  const appealReversalPatterns = signalTypeFilter(
    intelligence.signals,
    "APPEAL_REVERSAL_PATTERN"
  );
  const repeatedTargetingSignals = signalTypeFilter(
    intelligence.signals,
    "REPEATED_TARGETING"
  );

  return {
    generated_at: generatedAt,
    filters: publicFilters(filters),
    window,
    informational_only: true,
    enforcement_action: null,
    overview: {
      counts: {
        ...caseCounts,
        ...appealCounts,
        governance_signals: Array.isArray(intelligence.signals)
          ? intelligence.signals.length
          : 0,
        high_risk_actors:
          (intelligence.providers || []).filter((provider) => provider.risk_level === "HIGH").length +
          (intelligence.reporters || []).filter((reporter) => reporter.risk_level === "HIGH").length +
          toInt(trustSummary.high_risk_trust_actors),
      },
      cards: buildDashboardCards({
        caseCounts,
        appealCounts,
        intelligence,
        trustSummary,
      }),
    },
    moderation: {
      counts: caseCounts,
      current_queue: currentQueue,
      oldest_open_case: oldestOpenCases[0] || null,
      awaiting_response_cases: awaitingResponseCases,
      escalated_cases: escalatedCases,
      recent_activity: recentModerationActivity,
      hrefs: {
        queue: "/admin/provider-reports?status=all",
        awaiting_response: "/admin/provider-reports?status=all&caseStatus=AWAITING_RESPONSE",
        escalated: "/admin/provider-reports?status=all&caseStatus=ESCALATED",
      },
    },
    appeals: {
      counts: {
        pending_review: appealCounts.appeals_pending_review,
        under_review: appealCounts.appeals_under_review,
        recently_accepted: appealCounts.appeals_accepted,
        recently_rejected: appealCounts.appeals_rejected,
      },
      pending: pendingAppeals,
      under_review: underReviewAppeals,
      recently_accepted: recentlyAcceptedAppeals,
      recently_rejected: recentlyRejectedAppeals,
      hrefs: {
        pending: appealHref("SUBMITTED"),
        under_review: appealHref("UNDER_REVIEW"),
        accepted: appealHref("ACCEPTED"),
        rejected: appealHref("REJECTED"),
      },
    },
    trust: {
      summary: trustSummary,
      restricted_actors: restrictedActors,
      cooldown_actors: cooldownActors,
      high_deposit_multiplier_actors: highDepositMultiplierActors,
      recent_admin_actions: recentAdminTrustActions,
      hrefs: {
        trust: "/admin/trust",
      },
      informational_only: true,
      enforcement_action: null,
    },
    intelligence: {
      summary: intelligence,
      top_signals: (intelligence.signals || []).slice(0, 10),
      high_escalation_providers: highEscalationProviders,
      repeated_governance_disputes: repeatedGovernanceDisputes,
      high_dismissal_reporters: highDismissalReporters,
      appeal_reversal_patterns: appealReversalPatterns,
      repeated_targeting_signals: repeatedTargetingSignals,
      href: intelligenceHref({ windowDays: filters.windowDays, risk: filters.risk }),
      informational_only: true,
      enforcement_action: null,
    },
    notifications: {
      recent_activity: recentNotifications,
      source: source("notifications", "governance notification types within selected window", true),
    },
    high_risk_actors: {
      providers: (intelligence.providers || [])
        .filter((provider) => provider.risk_level === "HIGH")
        .slice(0, 8),
      reporters: (intelligence.reporters || [])
        .filter((reporter) => reporter.risk_level === "HIGH")
        .slice(0, 8),
      frequently_escalated_entities: topProvidersBy(
        intelligence.providers || [],
        "cases_escalated"
      ),
      frequently_appealed_entities: topProvidersBy(
        intelligence.providers || [],
        "appeals_submitted"
      ),
      source: source("governanceIntelligence.service", "risk and frequency rankings for selected window", true),
      informational_only: true,
      enforcement_action: null,
    },
  };
}

module.exports = {
  GOVERNANCE_NOTIFICATION_TYPES,
  buildDashboardCards,
  getGovernanceDashboard,
  normalizeDashboardFilters,
};
