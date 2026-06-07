const pool = require("../config/db");
const { sanitizePlainText } = require("../utils/sanitize");
const { providerDisplaySelect } = require("./providerDisplay.service");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH"]);
const RISK_RANK = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function withStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function boundedInt(value, defaultValue, min, max) {
  if (value === null || value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function optionalUuid(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = sanitizePlainText(value, { maxLength: 80 });
  if (!UUID_RE.test(normalized)) {
    throw withStatus(`Invalid ${label}`, 400);
  }
  return normalized;
}

function optionalRisk(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = sanitizePlainText(value, { maxLength: 20 }).toUpperCase();
  if (!RISK_LEVELS.has(normalized)) {
    throw withStatus("Invalid governance risk filter", 400);
  }
  return normalized;
}

function normalizeFilters(options = {}) {
  return {
    windowDays: boundedInt(
      options.windowDays || options.window_days || options.days,
      90,
      1,
      365
    ),
    limit: boundedInt(options.limit, 25, 1, 100),
    reporterId: optionalUuid(
      options.reporterId || options.reporter_id,
      "reporter filter"
    ),
    providerId: optionalUuid(
      options.providerId || options.provider_id,
      "provider filter"
    ),
    risk: optionalRisk(options.risk || options.riskLevel || options.risk_level),
  };
}

function toInt(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toFloat(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function percent(numerator, denominator) {
  const den = toInt(denominator);
  if (den <= 0) return 0;
  return Math.round((toInt(numerator) / den) * 10000) / 100;
}

function maxRisk(current, candidate) {
  if (!candidate) return current || "LOW";
  if (!current) return candidate;
  return RISK_RANK[candidate] > RISK_RANK[current] ? candidate : current;
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
    risk: filters.risk,
    reporter_id: filters.reporterId,
    provider_id: filters.providerId,
  };
}

function signalId(...parts) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .map((part) => String(part).toLowerCase().replace(/[^a-z0-9_-]+/g, "_"))
    .join(":");
}

function signal({
  actorType,
  actorId,
  actorName = null,
  actorRole = null,
  signalType,
  title,
  riskLevel,
  reason,
  recommendation,
  metrics = {},
  supportingCounts = [],
  context,
}) {
  return {
    id: signalId(actorType, actorId, signalType),
    actor_type: actorType,
    actor_id: actorId,
    actor_name: actorName,
    actor_role: actorRole,
    signal_type: signalType,
    title,
    risk_level: riskLevel,
    reason,
    recommendation,
    metrics,
    supporting_counts: supportingCounts,
    window: context.window,
    generated_at: context.generatedAt,
    informational_only: true,
    enforcement_action: null,
  };
}

function explainCount(label, value) {
  return { label, value: toInt(value) };
}

function decorateReporter(row) {
  const reportsSubmitted = toInt(row.reports_submitted);
  const reportsValidated = toInt(row.reports_validated);
  const reportsDismissed = toInt(row.reports_dismissed);
  const reportsPending = toInt(row.reports_pending);
  const validationRate = percent(reportsValidated, reportsSubmitted);
  const dismissalRate = percent(reportsDismissed, reportsSubmitted);

  return {
    reporter_id: row.reporter_id,
    reporter_name: row.reporter_name,
    reporter_role: row.reporter_role,
    reports_submitted: reportsSubmitted,
    reports_validated: reportsValidated,
    reports_dismissed: reportsDismissed,
    reports_pending: reportsPending,
    validation_rate: validationRate,
    dismissal_rate: dismissalRate,
    unique_providers_reported: toInt(row.unique_providers_reported),
    repeated_target_count: toInt(row.repeated_target_count),
    max_reports_against_single_provider: toInt(
      row.max_reports_against_single_provider
    ),
    linked_appeals_submitted: toInt(row.linked_appeals_submitted),
    accepted_appeal_reversals: toInt(row.accepted_appeal_reversals),
    first_report_at: row.first_report_at || null,
    last_report_at: row.last_report_at || null,
  };
}

function buildReporterSignals(reporter, context) {
  const signals = [];
  const submitted = reporter.reports_submitted;
  const dismissed = reporter.reports_dismissed;
  const maxTarget = reporter.max_reports_against_single_provider;
  const reversalCount = reporter.accepted_appeal_reversals;

  if (submitted >= 5) {
    const riskLevel = submitted >= 20 ? "HIGH" : submitted >= 10 ? "MEDIUM" : "LOW";
    signals.push(
      signal({
        actorType: "reporter",
        actorId: reporter.reporter_id,
        actorName: reporter.reporter_name,
        actorRole: reporter.reporter_role,
        signalType: "FREQUENT_REPORTER",
        title: "Frequent Reporter",
        riskLevel,
        reason: `${submitted} reports submitted in the selected window.`,
        recommendation: "Review report context before relying on volume alone.",
        metrics: {
          reports_submitted: submitted,
          unique_providers_reported: reporter.unique_providers_reported,
        },
        supportingCounts: [
          explainCount("Reports submitted", submitted),
          explainCount("Unique providers reported", reporter.unique_providers_reported),
        ],
        context,
      })
    );
  }

  if (submitted >= 5 && reporter.dismissal_rate >= 75) {
    const riskLevel = submitted >= 10 || reporter.dismissal_rate >= 90 ? "HIGH" : "MEDIUM";
    signals.push(
      signal({
        actorType: "reporter",
        actorId: reporter.reporter_id,
        actorName: reporter.reporter_name,
        actorRole: reporter.reporter_role,
        signalType: "HIGH_DISMISSAL_REPORTER",
        title: "High Dismissal Reporter",
        riskLevel,
        reason: `${dismissed} of ${submitted} reports were dismissed (${reporter.dismissal_rate}%).`,
        recommendation: "Investigate reliability before prioritizing future reports from this reporter.",
        metrics: {
          reports_submitted: submitted,
          reports_dismissed: dismissed,
          dismissal_rate: reporter.dismissal_rate,
          validation_rate: reporter.validation_rate,
        },
        supportingCounts: [
          explainCount("Reports submitted", submitted),
          explainCount("Reports dismissed", dismissed),
          explainCount("Reports validated", reporter.reports_validated),
        ],
        context,
      })
    );
  }

  if (maxTarget >= 3) {
    const riskLevel = maxTarget >= 5 ? "HIGH" : "MEDIUM";
    signals.push(
      signal({
        actorType: "reporter",
        actorId: reporter.reporter_id,
        actorName: reporter.reporter_name,
        actorRole: reporter.reporter_role,
        signalType: "REPEATED_TARGETING",
        title: "Repeated Targeting",
        riskLevel,
        reason: `A single provider received ${maxTarget} reports from this reporter.`,
        recommendation: "Review whether repeated reports share independent evidence.",
        metrics: {
          max_reports_against_single_provider: maxTarget,
          repeated_target_count: reporter.repeated_target_count,
        },
        supportingCounts: [
          explainCount("Max reports against one provider", maxTarget),
          explainCount("Repeated target providers", reporter.repeated_target_count),
        ],
        context,
      })
    );
  }

  if (reversalCount >= 1) {
    const riskLevel = reversalCount >= 3 ? "HIGH" : "MEDIUM";
    signals.push(
      signal({
        actorType: "reporter",
        actorId: reporter.reporter_id,
        actorName: reporter.reporter_name,
        actorRole: reporter.reporter_role,
        signalType: "APPEAL_REVERSAL_PATTERN",
        title: "Appeal Reversal Pattern",
        riskLevel,
        reason: `${reversalCount} linked appeal(s) were accepted after this reporter's reports.`,
        recommendation: "Compare report evidence with accepted appeal rationale.",
        metrics: {
          linked_appeals_submitted: reporter.linked_appeals_submitted,
          accepted_appeal_reversals: reversalCount,
        },
        supportingCounts: [
          explainCount("Linked appeals submitted", reporter.linked_appeals_submitted),
          explainCount("Accepted appeal reversals", reversalCount),
        ],
        context,
      })
    );
  }

  return signals;
}

function decorateProvider(row) {
  const totalCases = toInt(row.total_cases);
  const casesEscalated = toInt(row.cases_escalated);
  const appealsSubmitted = toInt(row.appeals_submitted);
  const appealsAccepted = toInt(row.appeals_accepted);

  return {
    provider_id: row.provider_id,
    provider_name: row.provider_name,
    reports_received: toInt(row.reports_received),
    reports_validated: toInt(row.reports_validated),
    reports_dismissed: toInt(row.reports_dismissed),
    reports_pending: toInt(row.reports_pending),
    total_cases: totalCases,
    open_cases: toInt(row.open_cases),
    validated_cases: toInt(row.validated_cases),
    dismissed_cases: toInt(row.dismissed_cases),
    cases_escalated: casesEscalated,
    escalation_events: toInt(row.escalation_events),
    escalation_rate: percent(casesEscalated, totalCases),
    appeals_submitted: appealsSubmitted,
    appeals_accepted: appealsAccepted,
    appeals_rejected: toInt(row.appeals_rejected),
    appeal_acceptance_rate: percent(appealsAccepted, appealsSubmitted),
    first_case_at: row.first_case_at || null,
    last_case_at: row.last_case_at || null,
  };
}

function buildProviderSignals(provider, context) {
  const signals = [];

  if (provider.appeals_submitted >= 3) {
    const riskLevel =
      provider.appeals_accepted >= 2 || provider.appeals_submitted >= 6
        ? "HIGH"
        : "MEDIUM";
    signals.push(
      signal({
        actorType: "provider",
        actorId: provider.provider_id,
        actorName: provider.provider_name,
        signalType: "FREQUENTLY_APPEALED_PROVIDER",
        title: "Frequently Appealed Provider",
        riskLevel,
        reason: `${provider.appeals_submitted} appeal(s) were submitted for this provider.`,
        recommendation: "Review whether moderation outcomes need additional provider context.",
        metrics: {
          appeals_submitted: provider.appeals_submitted,
          appeals_accepted: provider.appeals_accepted,
          appeal_acceptance_rate: provider.appeal_acceptance_rate,
        },
        supportingCounts: [
          explainCount("Appeals submitted", provider.appeals_submitted),
          explainCount("Appeals accepted", provider.appeals_accepted),
          explainCount("Appeals rejected", provider.appeals_rejected),
        ],
        context,
      })
    );
  }

  if (provider.cases_escalated >= 2 || provider.escalation_rate >= 25) {
    const riskLevel =
      provider.cases_escalated >= 3 || provider.escalation_rate >= 40
        ? "HIGH"
        : "MEDIUM";
    signals.push(
      signal({
        actorType: "provider",
        actorId: provider.provider_id,
        actorName: provider.provider_name,
        signalType: "HIGH_ESCALATION_PROVIDER",
        title: "High Escalation Provider",
        riskLevel,
        reason: `${provider.cases_escalated} case(s) escalated (${provider.escalation_rate}%).`,
        recommendation: "Inspect escalated cases for repeated operational themes.",
        metrics: {
          total_cases: provider.total_cases,
          cases_escalated: provider.cases_escalated,
          escalation_events: provider.escalation_events,
          escalation_rate: provider.escalation_rate,
        },
        supportingCounts: [
          explainCount("Total cases", provider.total_cases),
          explainCount("Cases escalated", provider.cases_escalated),
          explainCount("Escalation events", provider.escalation_events),
        ],
        context,
      })
    );
  }

  if (
    provider.total_cases >= 5 ||
    (provider.reports_received >= 5 && provider.appeals_submitted >= 2)
  ) {
    const riskLevel =
      provider.total_cases >= 10 ||
      (provider.reports_received >= 8 && provider.appeals_submitted >= 4)
        ? "HIGH"
        : "MEDIUM";
    signals.push(
      signal({
        actorType: "provider",
        actorId: provider.provider_id,
        actorName: provider.provider_name,
        signalType: "REPEATED_GOVERNANCE_DISPUTES",
        title: "Repeated Governance Disputes",
        riskLevel,
        reason: `${provider.total_cases} governance case(s) and ${provider.appeals_submitted} appeal(s) in the selected window.`,
        recommendation: "Review case history for patterns requiring manual investigation.",
        metrics: {
          total_cases: provider.total_cases,
          reports_received: provider.reports_received,
          appeals_submitted: provider.appeals_submitted,
        },
        supportingCounts: [
          explainCount("Governance cases", provider.total_cases),
          explainCount("Reports received", provider.reports_received),
          explainCount("Appeals submitted", provider.appeals_submitted),
        ],
        context,
      })
    );
  }

  return signals;
}

function decorateReporterWithRisk(row, context) {
  const reporter = decorateReporter(row);
  const signals = buildReporterSignals(reporter, context);
  reporter.risk_level = signals.reduce(
    (risk, item) => maxRisk(risk, item.risk_level),
    "LOW"
  );
  reporter.signals = signals;
  reporter.informational_only = true;
  return reporter;
}

function decorateProviderWithRisk(row, context) {
  const provider = decorateProvider(row);
  const signals = buildProviderSignals(provider, context);
  provider.risk_level = signals.reduce(
    (risk, item) => maxRisk(risk, item.risk_level),
    "LOW"
  );
  provider.signals = signals;
  provider.informational_only = true;
  return provider;
}

function filterByRisk(rows, risk) {
  if (!risk) return rows;
  return rows.filter((row) => row.risk_level === risk);
}

function sortSignals(signals) {
  return signals.sort((left, right) => {
    const riskDelta = RISK_RANK[right.risk_level] - RISK_RANK[left.risk_level];
    if (riskDelta) return riskDelta;
    return String(left.title).localeCompare(String(right.title));
  });
}

function contextFromFilters(filters) {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    window: governanceWindow(filters, generatedAt),
  };
}

async function listReporterReputations(options = {}) {
  const filters = normalizeFilters(options);
  const context = contextFromFilters(filters);
  const client = options.client || pool;

  const result = await client.query(
    `
    WITH report_base AS (
      SELECT pr.id,
             pr.provider_id,
             pr.reported_by,
             pr.status,
             pr.created_at,
             moderation_case.id AS case_id
      FROM provider_reports pr
      LEFT JOIN LATERAL (
        SELECT mc.id
        FROM moderation_cases mc
        WHERE mc.id = pr.moderation_case_id
           OR mc.source_report_id = pr.id
        ORDER BY CASE WHEN mc.id = pr.moderation_case_id THEN 0 ELSE 1 END,
                 mc.created_at DESC
        LIMIT 1
      ) moderation_case ON true
      WHERE pr.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND ($2::uuid IS NULL OR pr.reported_by = $2::uuid)
    ),
    target_counts AS (
      SELECT reported_by,
             provider_id,
             COUNT(*)::int AS report_count
      FROM report_base
      GROUP BY reported_by, provider_id
    ),
    appeal_rollup AS (
      SELECT rb.id AS report_id,
             COUNT(DISTINCT ma.id)::int AS appeals_submitted,
             COUNT(DISTINCT ma.id) FILTER (WHERE ma.status = 'ACCEPTED')::int
               AS appeals_accepted,
             COUNT(DISTINCT ma.id) FILTER (WHERE ma.status = 'REJECTED')::int
               AS appeals_rejected
      FROM report_base rb
      LEFT JOIN moderation_appeals ma ON ma.case_id = rb.case_id
      GROUP BY rb.id
    )
    SELECT rb.reported_by AS reporter_id,
           COALESCE(reporter_ngo.organization_name, reporter.name) AS reporter_name,
           reporter.role AS reporter_role,
           COUNT(DISTINCT rb.id)::int AS reports_submitted,
           COUNT(DISTINCT rb.id) FILTER (WHERE rb.status = 'validated')::int
             AS reports_validated,
           COUNT(DISTINCT rb.id) FILTER (WHERE rb.status = 'dismissed')::int
             AS reports_dismissed,
           COUNT(DISTINCT rb.id) FILTER (WHERE rb.status = 'pending')::int
             AS reports_pending,
           COUNT(DISTINCT rb.provider_id)::int AS unique_providers_reported,
           COUNT(DISTINCT rb.provider_id) FILTER (WHERE tc.report_count >= 3)::int
             AS repeated_target_count,
           COALESCE(MAX(tc.report_count), 0)::int
             AS max_reports_against_single_provider,
           COALESCE(SUM(ar.appeals_submitted), 0)::int
             AS linked_appeals_submitted,
           COALESCE(SUM(ar.appeals_accepted), 0)::int
             AS accepted_appeal_reversals,
           MIN(rb.created_at) AS first_report_at,
           MAX(rb.created_at) AS last_report_at
    FROM report_base rb
    JOIN users reporter ON reporter.id = rb.reported_by
    LEFT JOIN ngos reporter_ngo ON reporter_ngo.user_id = reporter.id
    LEFT JOIN target_counts tc
      ON tc.reported_by = rb.reported_by
     AND tc.provider_id = rb.provider_id
    LEFT JOIN appeal_rollup ar ON ar.report_id = rb.id
    GROUP BY rb.reported_by, reporter_ngo.organization_name, reporter.name, reporter.role
    ORDER BY reports_submitted DESC, reports_dismissed DESC, last_report_at DESC
    LIMIT $3
    `,
    [filters.windowDays, filters.reporterId, filters.limit]
  );

  return filterByRisk(
    result.rows.map((row) => decorateReporterWithRisk(row, context)),
    filters.risk
  );
}

async function listProviderGovernanceMetrics(options = {}) {
  const filters = normalizeFilters(options);
  const context = contextFromFilters(filters);
  const client = options.client || pool;

  const result = await client.query(
    `
    WITH case_base AS (
      SELECT mc.id,
             mc.subject_id AS provider_id,
             mc.status,
             mc.created_at,
             pr.id AS report_id,
             pr.status AS report_status
      FROM moderation_cases mc
      LEFT JOIN provider_reports pr
        ON pr.id = mc.source_report_id
        OR pr.moderation_case_id = mc.id
      WHERE mc.subject_type = 'provider'
      AND mc.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND ($2::uuid IS NULL OR mc.subject_id = $2::uuid)
    ),
    appeal_counts AS (
      SELECT ma.case_id,
             COUNT(*)::int AS appeals_submitted,
             COUNT(*) FILTER (WHERE ma.status = 'ACCEPTED')::int AS appeals_accepted,
             COUNT(*) FILTER (WHERE ma.status = 'REJECTED')::int AS appeals_rejected
      FROM moderation_appeals ma
      WHERE ma.submitted_at >= NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY ma.case_id
    ),
    escalation_events AS (
      SELECT mce.case_id,
             COUNT(*)::int AS escalation_events
      FROM moderation_case_events mce
      WHERE mce.event_type = 'CASE_STATUS_CHANGED'
      AND mce.to_status = 'ESCALATED'
      AND mce.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY mce.case_id
    )
    SELECT cb.provider_id,
           ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
           COUNT(DISTINCT cb.report_id)::int AS reports_received,
           COUNT(DISTINCT cb.report_id) FILTER (WHERE cb.report_status = 'validated')::int
             AS reports_validated,
           COUNT(DISTINCT cb.report_id) FILTER (WHERE cb.report_status = 'dismissed')::int
             AS reports_dismissed,
           COUNT(DISTINCT cb.report_id) FILTER (WHERE cb.report_status = 'pending')::int
             AS reports_pending,
           COUNT(DISTINCT cb.id)::int AS total_cases,
           COUNT(DISTINCT cb.id) FILTER (
             WHERE cb.status IN ('OPEN', 'UNDER_REVIEW', 'AWAITING_RESPONSE', 'ESCALATED')
           )::int AS open_cases,
           COUNT(DISTINCT cb.id) FILTER (WHERE cb.status = 'VALIDATED')::int
             AS validated_cases,
           COUNT(DISTINCT cb.id) FILTER (WHERE cb.status = 'DISMISSED')::int
             AS dismissed_cases,
           COUNT(DISTINCT cb.id) FILTER (
             WHERE cb.status = 'ESCALATED'
                OR COALESCE(ee.escalation_events, 0) > 0
           )::int AS cases_escalated,
           COALESCE(SUM(ee.escalation_events), 0)::int AS escalation_events,
           COALESCE(SUM(ac.appeals_submitted), 0)::int AS appeals_submitted,
           COALESCE(SUM(ac.appeals_accepted), 0)::int AS appeals_accepted,
           COALESCE(SUM(ac.appeals_rejected), 0)::int AS appeals_rejected,
           MIN(cb.created_at) AS first_case_at,
           MAX(cb.created_at) AS last_case_at
    FROM case_base cb
    JOIN users provider ON provider.id = cb.provider_id
    LEFT JOIN LATERAL (
      SELECT restaurant_name,
             NULL::text AS business_name
      FROM restaurants
      WHERE user_id = provider.id
      ORDER BY is_verified DESC, id DESC
      LIMIT 1
    ) restaurant ON true
    LEFT JOIN appeal_counts ac ON ac.case_id = cb.id
    LEFT JOIN escalation_events ee ON ee.case_id = cb.id
    GROUP BY cb.provider_id, restaurant.restaurant_name, restaurant.business_name, provider.name
    ORDER BY cases_escalated DESC, reports_received DESC, last_case_at DESC
    LIMIT $3
    `,
    [filters.windowDays, filters.providerId, filters.limit]
  );

  return filterByRisk(
    result.rows.map((row) => decorateProviderWithRisk(row, context)),
    filters.risk
  );
}

async function getModerationGovernanceMetrics(options = {}) {
  const filters = normalizeFilters(options);
  const client = options.client || pool;

  const [casesResult, appealsResult, adminResult] = await Promise.all([
    client.query(
      `
      SELECT COUNT(*)::int AS total_cases,
             COUNT(*) FILTER (
               WHERE status IN ('OPEN', 'UNDER_REVIEW', 'AWAITING_RESPONSE', 'ESCALATED')
             )::int AS open_cases,
             COUNT(*) FILTER (WHERE status = 'VALIDATED')::int AS validated_cases,
             COUNT(*) FILTER (WHERE status = 'DISMISSED')::int AS dismissed_cases,
             COUNT(*) FILTER (WHERE status = 'ESCALATED')::int AS escalated_cases,
             COALESCE(
               ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 3600), 2),
               0
             )::numeric AS average_resolution_hours
      FROM moderation_cases
      WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
      `,
      [filters.windowDays]
    ),
    client.query(
      `
      SELECT COUNT(*)::int AS appeals_submitted,
             COUNT(*) FILTER (WHERE status = 'UNDER_REVIEW')::int AS appeals_under_review,
             COUNT(*) FILTER (WHERE status = 'ACCEPTED')::int AS appeals_accepted,
             COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS appeals_rejected,
             COUNT(*) FILTER (WHERE status = 'WITHDRAWN')::int AS appeals_withdrawn
      FROM moderation_appeals
      WHERE submitted_at >= NOW() - ($1::int * INTERVAL '1 day')
      `,
      [filters.windowDays]
    ),
    client.query(
      `
      SELECT mc.assigned_admin_id AS admin_id,
             admin.name AS admin_name,
             COUNT(*) FILTER (WHERE mc.status IN ('VALIDATED', 'DISMISSED', 'ESCALATED'))::int
               AS cases_reviewed,
             COUNT(*) FILTER (WHERE mc.status = 'VALIDATED')::int AS cases_validated,
             COUNT(*) FILTER (WHERE mc.status = 'DISMISSED')::int AS cases_dismissed,
             COUNT(*) FILTER (WHERE mc.status = 'ESCALATED')::int AS cases_escalated,
             COALESCE(
               ROUND(AVG(EXTRACT(EPOCH FROM (mc.closed_at - mc.created_at)) / 3600), 2),
               0
             )::numeric AS average_resolution_hours
      FROM moderation_cases mc
      LEFT JOIN users admin ON admin.id = mc.assigned_admin_id
      WHERE mc.assigned_admin_id IS NOT NULL
      AND mc.updated_at >= NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY mc.assigned_admin_id, admin.name
      ORDER BY cases_reviewed DESC, cases_escalated DESC
      LIMIT $2
      `,
      [filters.windowDays, filters.limit]
    ),
  ]);

  const cases = casesResult.rows[0] || {};
  const appeals = appealsResult.rows[0] || {};

  return {
    total_cases: toInt(cases.total_cases),
    open_cases: toInt(cases.open_cases),
    validated_cases: toInt(cases.validated_cases),
    dismissed_cases: toInt(cases.dismissed_cases),
    escalated_cases: toInt(cases.escalated_cases),
    appeals_submitted: toInt(appeals.appeals_submitted),
    appeals_under_review: toInt(appeals.appeals_under_review),
    appeals_accepted: toInt(appeals.appeals_accepted),
    appeals_rejected: toInt(appeals.appeals_rejected),
    appeals_withdrawn: toInt(appeals.appeals_withdrawn),
    average_resolution_hours: toFloat(cases.average_resolution_hours),
    admin_performance: adminResult.rows.map((row) => ({
      admin_id: row.admin_id,
      admin_name: row.admin_name,
      cases_reviewed: toInt(row.cases_reviewed),
      cases_validated: toInt(row.cases_validated),
      cases_dismissed: toInt(row.cases_dismissed),
      cases_escalated: toInt(row.cases_escalated),
      average_resolution_hours: toFloat(row.average_resolution_hours),
    })),
    informational_only: true,
  };
}

async function getEscalationAnalytics(options = {}) {
  const filters = normalizeFilters(options);
  const client = options.client || pool;

  const [summaryResult, repeatedResult] = await Promise.all([
    client.query(
      `
      WITH case_base AS (
        SELECT mc.id,
               mc.subject_id AS provider_id,
               mc.status
        FROM moderation_cases mc
        WHERE mc.subject_type = 'provider'
        AND mc.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND ($2::uuid IS NULL OR mc.subject_id = $2::uuid)
      ),
      escalation_events AS (
        SELECT mce.case_id,
               COUNT(*)::int AS escalation_events
        FROM moderation_case_events mce
        JOIN case_base cb ON cb.id = mce.case_id
        WHERE mce.event_type = 'CASE_STATUS_CHANGED'
        AND mce.to_status = 'ESCALATED'
        AND mce.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY mce.case_id
      )
      SELECT COUNT(DISTINCT cb.id)::int AS total_cases,
             COUNT(DISTINCT cb.id) FILTER (
               WHERE cb.status = 'ESCALATED'
                  OR COALESCE(ee.escalation_events, 0) > 0
             )::int AS cases_escalated,
             COALESCE(SUM(ee.escalation_events), 0)::int AS escalation_events
      FROM case_base cb
      LEFT JOIN escalation_events ee ON ee.case_id = cb.id
      `,
      [filters.windowDays, filters.providerId]
    ),
    client.query(
      `
      WITH provider_escalations AS (
        SELECT mc.subject_id AS provider_id,
               COUNT(DISTINCT mc.id) FILTER (
                 WHERE mc.status = 'ESCALATED'
                    OR mce.id IS NOT NULL
               )::int AS cases_escalated,
               COUNT(mce.id)::int AS escalation_events
        FROM moderation_cases mc
        LEFT JOIN moderation_case_events mce
          ON mce.case_id = mc.id
         AND mce.event_type = 'CASE_STATUS_CHANGED'
         AND mce.to_status = 'ESCALATED'
         AND mce.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        WHERE mc.subject_type = 'provider'
        AND mc.created_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND ($2::uuid IS NULL OR mc.subject_id = $2::uuid)
        GROUP BY mc.subject_id
      )
      SELECT pe.provider_id,
             ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
             pe.cases_escalated,
             pe.escalation_events
      FROM provider_escalations pe
      JOIN users provider ON provider.id = pe.provider_id
      LEFT JOIN LATERAL (
        SELECT restaurant_name,
               NULL::text AS business_name
        FROM restaurants
        WHERE user_id = provider.id
        ORDER BY is_verified DESC, id DESC
        LIMIT 1
      ) restaurant ON true
      WHERE pe.cases_escalated >= 2
         OR pe.escalation_events >= 2
      ORDER BY pe.cases_escalated DESC, pe.escalation_events DESC
      LIMIT $3
      `,
      [filters.windowDays, filters.providerId, filters.limit]
    ),
  ]);

  const summary = summaryResult.rows[0] || {};
  const totalCases = toInt(summary.total_cases);
  const casesEscalated = toInt(summary.cases_escalated);

  return {
    total_cases: totalCases,
    cases_escalated: casesEscalated,
    escalation_events: toInt(summary.escalation_events),
    escalation_rate: percent(casesEscalated, totalCases),
    repeated_escalations: repeatedResult.rows.length,
    repeated_escalation_providers: repeatedResult.rows.map((row) => ({
      provider_id: row.provider_id,
      provider_name: row.provider_name,
      cases_escalated: toInt(row.cases_escalated),
      escalation_events: toInt(row.escalation_events),
    })),
    informational_only: true,
  };
}

async function listGovernanceSignals(options = {}) {
  const filters = normalizeFilters(options);
  const [reporters, providers] = await Promise.all([
    listReporterReputations({ ...filters, client: options.client }),
    listProviderGovernanceMetrics({ ...filters, client: options.client }),
  ]);

  const signals = sortSignals([
    ...reporters.flatMap((reporter) => reporter.signals || []),
    ...providers.flatMap((provider) => provider.signals || []),
  ]);

  return signals.filter((item) => !filters.risk || item.risk_level === filters.risk);
}

async function getGovernanceIntelligenceSummary(options = {}) {
  const filters = normalizeFilters(options);
  const context = contextFromFilters(filters);
  const [moderation, reporters, providers, escalation] = await Promise.all([
    getModerationGovernanceMetrics({ ...filters, client: options.client }),
    listReporterReputations({ ...filters, client: options.client }),
    listProviderGovernanceMetrics({ ...filters, client: options.client }),
    getEscalationAnalytics({ ...filters, client: options.client }),
  ]);

  const signals = sortSignals([
    ...reporters.flatMap((reporter) => reporter.signals || []),
    ...providers.flatMap((provider) => provider.signals || []),
  ]).filter((item) => !filters.risk || item.risk_level === filters.risk);

  return {
    generated_at: context.generatedAt,
    filters: publicFilters(filters),
    window: context.window,
    informational_only: true,
    enforcement_action: null,
    moderation,
    reporters,
    providers,
    escalation,
    signals,
  };
}

module.exports = {
  buildProviderSignals,
  buildReporterSignals,
  getEscalationAnalytics,
  getGovernanceIntelligenceSummary,
  getModerationGovernanceMetrics,
  listGovernanceSignals,
  listProviderGovernanceMetrics,
  listReporterReputations,
  normalizeFilters,
};
