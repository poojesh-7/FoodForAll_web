const pool = require("../config/db");
const { providerDisplaySelect } = require("./providerDisplay.service");

const PERIOD_OPTIONS = [
  { key: "30d", label: "Last 30 Days", days: 30 },
  { key: "90d", label: "90 Days", days: 90 },
  { key: "180d", label: "180 Days", days: 180 },
  { key: "365d", label: "365 Days", days: 365 },
  { key: "all", label: "All Time", days: null },
];

const TREND_PERIODS = new Set(["30d", "90d", "180d", "365d"]);
const DEFAULT_PERIOD = "30d";
const TOP_LIMIT = 8;

const ANALYSIS = {
  architecture: [
    "Business Metrics is a read-only analytics layer over existing reservation, listing, trust, governance, and financial read models.",
    "The service owns no workflow state and does not call trust, reservation, settlement, moderation, queue, or payment mutation paths.",
    "All dashboard and export values use the same service queries so CSV/JSON exports match the displayed metrics.",
    "Historical activity metrics are window-based and use creation/completion timestamps without inventory visibility filters.",
    "Current inventory metrics are separate current-state counts using existing listing visibility and lifecycle fields.",
    "Food rescued uses reservation quantity_reserved, which is the existing listing quantity unit reserved from food_listings.quantity.",
    "Export actions are recorded through operational_events for auditability; metric values themselves remain derived.",
  ],
  gaps: [
    "The platform has quantity units but no canonical food weight column, so rescued food is reported as platform quantity units.",
    "Provider and NGO verification has current state but no verified_at timestamp, so period filters use profile creation time for verified entity counts.",
    "Volunteer delivery outcomes are stored on reservations, not a dedicated delivery table.",
    "Financial reporting uses settlement and refund terminal tables; Business Metrics does not recompute ledger balances.",
    "T7.4 initially counted non-deleted listings under the Total Food Listings label; T7.4.1 separates historical listing creation from current inventory state.",
  ],
  reuse: [
    "Listings: food_listings.quantity, remaining_quantity, status, created_at, provider_id.",
    "Reservations: reservations.quantity_reserved, status, task_status, reserved_at, picked_up_at, completed_at, pickup_type, assigned_volunteer_id.",
    "Provider and NGO participation: users, restaurants, ngos, reservations, food_listings.",
    "Volunteer participation: reservations assigned_volunteer_id and volunteer completion timestamps.",
    "Trust insights: trust_scores aggregate fields only; score breakdowns and sensitive internals are not exposed.",
    "Governance insights: provider_reports, moderation_cases, moderation_appeals.",
    "Financial insights: provider_settlements, settlement_batches, financial_refund_terminal_records.",
    "Audit integration: operational_events surfaced through Audit Center governance domain.",
  ],
  risks: [
    "Double counting can occur if one business activity is interpreted as both pickup and delivery; delivery metrics are limited to delivered/volunteer reservations.",
    "Historical drift is possible for current-state counts without event timestamps, especially verified provider/NGO counts.",
    "Trust privacy is protected by exposing only aggregate averages, counts, and deposit multiplier distribution.",
    "Financial consistency is protected by counting settlement/refund records rather than deriving ledger outcomes from payments.",
    "All-time trend charts are intentionally bounded to 365 days to keep analytics queries predictable.",
  ],
  schemaChanges: [
    "No Business Metrics tables are created.",
    "Migration 024 adds indexes only for dashboard timestamp/status lookups.",
  ],
  metricDefinitions: [
    {
      metric: "Total Food Listings",
      classification: "Historical Activity Metrics",
      current_definition: "T7.4 used non-deleted food_listings created within period.",
      intended_definition: "COUNT(*) from food_listings where created_at is within the selected period; all time has no visibility filter.",
      aligned: true,
    },
    {
      metric: "Active Listings",
      classification: "Current Inventory Metrics",
      current_definition: "Not surfaced separately in T7.4.",
      intended_definition: "COUNT(*) where listing is not deleted, status is active, pickup window is open, and remaining_quantity is positive.",
      aligned: true,
    },
    {
      metric: "Archived Listings",
      classification: "Current Inventory Metrics",
      current_definition: "Not surfaced separately in T7.4.",
      intended_definition: "COUNT(*) where is_deleted is true, deleted_at is present, or status is deleted.",
      aligned: true,
    },
    {
      metric: "Expired Listings",
      classification: "Current Inventory Metrics",
      current_definition: "Not surfaced separately in T7.4.",
      intended_definition: "COUNT(*) where listing is not archived and status is expired or active pickup_end_time is in the past.",
      aligned: true,
    },
    {
      metric: "Fulfilled Listings",
      classification: "Current Inventory Metrics",
      current_definition: "Not surfaced separately in T7.4.",
      intended_definition: "COUNT(*) where listing is not archived and status is completed or remaining_quantity is zero.",
      aligned: true,
    },
    {
      metric: "Total Reservations",
      classification: "Historical Activity Metrics",
      current_definition: "COUNT(*) from reservations by reserved_at window.",
      intended_definition: "COUNT(*) from reservations by reserved_at window.",
      aligned: true,
    },
    {
      metric: "Completed Pickups",
      classification: "Historical Activity Metrics",
      current_definition: "COUNT(*) from reservations by picked_up_at window.",
      intended_definition: "COUNT(*) from reservations by picked_up_at window.",
      aligned: true,
    },
    {
      metric: "Completed Deliveries",
      classification: "Historical Activity Metrics",
      current_definition: "COUNT(*) from delivered/volunteer reservations by completed_at window.",
      intended_definition: "COUNT(*) from delivered/volunteer reservations by completed_at window.",
      aligned: true,
    },
    {
      metric: "Food Rescued",
      classification: "Historical Activity Metrics",
      current_definition: "SUM(quantity_reserved) from completed/picked-up reservations by completion/pickup window.",
      intended_definition: "SUM(quantity_reserved) from completed/picked-up reservations by completion/pickup window.",
      aligned: true,
    },
    {
      metric: "Provider Participation",
      classification: "Historical Activity Metrics",
      current_definition: "Provider activity and rankings from listings/reservations/fulfillments within period.",
      intended_definition: "Provider activity and rankings from listings/reservations/fulfillments within period, without archive filters for historical listing counts.",
      aligned: true,
    },
    {
      metric: "NGO Participation",
      classification: "Historical Activity Metrics",
      current_definition: "NGO activity and rankings from reservations/deliveries within period.",
      intended_definition: "NGO activity and rankings from reservations/deliveries within period.",
      aligned: true,
    },
    {
      metric: "Volunteer Participation",
      classification: "Historical Activity Metrics",
      current_definition: "Volunteer assignment/completion metrics from reservations within period.",
      intended_definition: "Volunteer assignment/completion metrics from reservations within period.",
      aligned: true,
    },
    {
      metric: "Reservation Performance",
      classification: "Historical Activity Metrics",
      current_definition: "Created/completed/cancelled/expired reservation counts by selected period.",
      intended_definition: "Created/completed/cancelled/expired reservation counts by selected period.",
      aligned: true,
    },
    {
      metric: "Trust Insights",
      classification: "Current Inventory Metrics",
      current_definition: "Aggregate current trust_scores state.",
      intended_definition: "Aggregate current trust_scores state only; no trust mutations or sensitive internals.",
      aligned: true,
    },
    {
      metric: "Governance Insights",
      classification: "Historical Activity Metrics",
      current_definition: "Reports, cases, and appeals by submission/review timestamps within period.",
      intended_definition: "Reports, cases, and appeals by submission/review timestamps within period.",
      aligned: true,
    },
    {
      metric: "Financial Insights",
      classification: "Historical Activity Metrics",
      current_definition: "Settlement and refund terminal record counts within period.",
      intended_definition: "Settlement and refund terminal record counts within period, reusing settlement tables.",
      aligned: true,
    },
    {
      metric: "Trend Analytics",
      classification: "Historical Activity Metrics",
      current_definition: "Daily listings/reservations/deliveries/reports/settlements within trend window.",
      intended_definition: "Daily listings/reservations/deliveries/reports/settlements within trend window; listing trends count all created listings.",
      aligned: true,
    },
  ],
};

function toInt(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function toFloat(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percent(numerator, denominator) {
  const top = toFloat(numerator);
  const bottom = toFloat(denominator);
  if (bottom <= 0) return 0;
  return Number(((top / bottom) * 100).toFixed(2));
}

function normalizePeriod(value) {
  const raw = String(value || DEFAULT_PERIOD).trim().toLowerCase();
  if (raw === "all" || raw === "all_time" || raw === "all-time") return "all";

  const digits = raw.match(/\d+/)?.[0];
  if (digits) {
    const key = `${digits}d`;
    if (PERIOD_OPTIONS.some((period) => period.key === key)) return key;
  }

  return DEFAULT_PERIOD;
}

function normalizeBusinessMetricsFilters(options = {}) {
  const period = normalizePeriod(
    options.period || options.window || options.windowDays || options.window_days || options.days
  );
  return { period };
}

function periodDefinition(periodKey) {
  return PERIOD_OPTIONS.find((period) => period.key === periodKey) || PERIOD_OPTIONS[0];
}

function windowForPeriod(periodKey, generatedAt = new Date()) {
  const definition = periodDefinition(periodKey);
  const generated = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  const end = Number.isNaN(generated.getTime()) ? new Date() : generated;
  const start = definition.days
    ? new Date(end.getTime() - definition.days * 24 * 60 * 60 * 1000)
    : null;

  return {
    period: definition.key,
    label: definition.label,
    days: definition.days,
    start_at: start ? start.toISOString() : null,
    end_at: end.toISOString(),
  };
}

function publicFilters(filters) {
  return { period: filters.period };
}

function source(table, predicate, windowed = true) {
  return { table, predicate, windowed };
}

function metricCard(id, label, value, metricSource, detail = null) {
  return {
    id,
    label,
    value: toFloat(value),
    detail,
    source: metricSource,
  };
}

function windowPredicate(column, param = "$1") {
  return `(${param}::timestamptz IS NULL OR ${column} >= ${param}::timestamptz)`;
}

async function queryOne(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || {};
}

async function getPlatformSummaryForPeriod(client, periodKey, generatedAt) {
  const window = windowForPeriod(periodKey, generatedAt);
  const startAt = window.start_at;
  const row = await queryOne(
    client,
    `
    SELECT
      (
        SELECT COUNT(*)::int
        FROM food_listings fl
        WHERE ${windowPredicate("fl.created_at")}
      ) AS total_food_listings,
      (
        SELECT COUNT(*)::int
        FROM reservations r
        WHERE ${windowPredicate("r.reserved_at")}
      ) AS total_reservations,
      (
        SELECT COUNT(*)::int
        FROM reservations r
        WHERE r.picked_up_at IS NOT NULL
        AND ${windowPredicate("r.picked_up_at")}
      ) AS completed_pickups,
      (
        SELECT COUNT(*)::int
        FROM reservations r
        WHERE r.completed_at IS NOT NULL
        AND (
          r.assigned_volunteer_id IS NOT NULL
          OR r.task_status = 'delivered'
        )
        AND ${windowPredicate("r.completed_at")}
      ) AS completed_deliveries
    `,
    [startAt]
  );

  return {
    ...window,
    total_food_listings: toInt(row.total_food_listings),
    total_reservations: toInt(row.total_reservations),
    completed_pickups: toInt(row.completed_pickups),
    completed_deliveries: toInt(row.completed_deliveries),
    source: source(
      "food_listings, reservations",
      "created_at/reserved_at/picked_up_at/completed_at within period"
    ),
  };
}

async function getPlatformSummary({ client, filters, generatedAt }) {
  const periodSummaries = await Promise.all(
    PERIOD_OPTIONS.map((period) =>
      getPlatformSummaryForPeriod(client, period.key, generatedAt)
    )
  );
  const selected =
    periodSummaries.find((summary) => summary.period === filters.period) ||
    periodSummaries[0];

  return {
    selected,
    period_summaries: periodSummaries,
    cards: [
      metricCard(
        "total_food_listings",
        "Total Food Listings",
        selected.total_food_listings,
        source("food_listings", "created_at within period; includes archived/deleted historical listings")
      ),
      metricCard(
        "total_reservations",
        "Total Reservations",
        selected.total_reservations,
        source("reservations", "reserved_at within period")
      ),
      metricCard(
        "completed_pickups",
        "Completed Pickups",
        selected.completed_pickups,
        source("reservations", "picked_up_at within period")
      ),
      metricCard(
        "completed_deliveries",
        "Completed Deliveries",
        selected.completed_deliveries,
        source(
          "reservations",
          "completed_at within period and assigned volunteer or delivered task"
        )
      ),
    ],
  };
}

async function getListingInventory({ client }) {
  const row = await queryOne(
    client,
    `
    SELECT
      COUNT(*) FILTER (
        WHERE COALESCE(is_deleted, false) = false
        AND deleted_at IS NULL
        AND status = 'active'
        AND pickup_end_time > NOW()
        AND remaining_quantity > 0
      )::int AS active_listings,
      COUNT(*) FILTER (
        WHERE COALESCE(is_deleted, false) = true
        OR deleted_at IS NOT NULL
        OR status = 'deleted'
      )::int AS archived_listings,
      COUNT(*) FILTER (
        WHERE COALESCE(is_deleted, false) = false
        AND deleted_at IS NULL
        AND (
          status = 'expired'
          OR (
            status = 'active'
            AND pickup_end_time <= NOW()
          )
        )
      )::int AS expired_listings,
      COUNT(*) FILTER (
        WHERE COALESCE(is_deleted, false) = false
        AND deleted_at IS NULL
        AND (
          status = 'completed'
          OR remaining_quantity <= 0
        )
      )::int AS fulfilled_listings
    FROM food_listings
    `
  );

  return {
    active_listings: toInt(row.active_listings),
    archived_listings: toInt(row.archived_listings),
    expired_listings: toInt(row.expired_listings),
    fulfilled_listings: toInt(row.fulfilled_listings),
    source: source(
      "food_listings",
      "current listing state using status, is_deleted, deleted_at, pickup_end_time, and remaining_quantity",
      false
    ),
    classification: "Current Inventory Metrics",
  };
}

async function getFoodRescueMetrics({ client, startAt }) {
  const row = await queryOne(
    client,
    `
    SELECT
      COALESCE(SUM(r.quantity_reserved), 0)::numeric AS total_food_rescued,
      COUNT(*)::int AS completed_reservations,
      COALESCE(SUM(fl.quantity), 0)::numeric AS source_listing_quantity_total
    FROM reservations r
    LEFT JOIN food_listings fl ON fl.id = r.listing_id
    WHERE (
      r.completed_at IS NOT NULL
      OR r.picked_up_at IS NOT NULL
      OR r.status IN ('completed','picked_up','delivered')
      OR r.task_status IN ('completed','delivered','picked_up')
    )
    AND ${windowPredicate("COALESCE(r.completed_at, r.picked_up_at, r.reserved_at)")}
    `,
    [startAt]
  );

  return {
    total_food_rescued: toFloat(row.total_food_rescued),
    unit: "platform_quantity_units",
    basis: "SUM(reservations.quantity_reserved) for completed/picked-up reservations",
    completed_reservations: toInt(row.completed_reservations),
    source_listing_quantity_total: toFloat(row.source_listing_quantity_total),
    source: source(
      "reservations, food_listings",
      "quantity_reserved from completed/picked-up reservations; food_listings.quantity is source unit"
    ),
  };
}

async function getProviderParticipation({ client, startAt }) {
  const counts = await queryOne(
    client,
    `
    SELECT
      (
        SELECT COUNT(DISTINCT fl.provider_id)::int
        FROM food_listings fl
        WHERE fl.provider_id IS NOT NULL
        AND ${windowPredicate("fl.created_at")}
      ) AS active_providers,
      (
        SELECT COUNT(*)::int
        FROM restaurants restaurants_new
        WHERE ${windowPredicate("restaurants_new.created_at")}
      ) AS new_providers,
      (
        SELECT COUNT(*)::int
        FROM restaurants restaurants_verified
        WHERE restaurants_verified.is_verified = true
        AND ${windowPredicate("restaurants_verified.created_at")}
      ) AS verified_providers
    `,
    [startAt]
  );

  const [byListings, byReservations, byFulfillments] = await Promise.all([
    client.query(
      `
      SELECT fl.provider_id,
             ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
             COUNT(*)::int AS listings
      FROM food_listings fl
      JOIN users provider ON provider.id = fl.provider_id
      LEFT JOIN LATERAL (
        SELECT restaurant_name, NULL::text AS business_name
        FROM restaurants
        WHERE user_id = provider.id
        ORDER BY is_verified DESC, id DESC
        LIMIT 1
      ) restaurant ON true
      WHERE fl.provider_id IS NOT NULL
      AND ${windowPredicate("fl.created_at")}
      GROUP BY fl.provider_id, provider.name, restaurant.restaurant_name, restaurant.business_name
      ORDER BY listings DESC, provider_name ASC
      LIMIT $2
      `,
      [startAt, TOP_LIMIT]
    ),
    client.query(
      `
      SELECT fl.provider_id,
             ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
             COUNT(r.id)::int AS reservations
      FROM reservations r
      JOIN food_listings fl ON fl.id = r.listing_id
      JOIN users provider ON provider.id = fl.provider_id
      LEFT JOIN LATERAL (
        SELECT restaurant_name, NULL::text AS business_name
        FROM restaurants
        WHERE user_id = provider.id
        ORDER BY is_verified DESC, id DESC
        LIMIT 1
      ) restaurant ON true
      WHERE fl.provider_id IS NOT NULL
      AND ${windowPredicate("r.reserved_at")}
      GROUP BY fl.provider_id, provider.name, restaurant.restaurant_name, restaurant.business_name
      ORDER BY reservations DESC, provider_name ASC
      LIMIT $2
      `,
      [startAt, TOP_LIMIT]
    ),
    client.query(
      `
      SELECT fl.provider_id,
             ${providerDisplaySelect("restaurant", "provider")} AS provider_name,
             COUNT(r.id)::int AS fulfillments
      FROM reservations r
      JOIN food_listings fl ON fl.id = r.listing_id
      JOIN users provider ON provider.id = fl.provider_id
      LEFT JOIN LATERAL (
        SELECT restaurant_name, NULL::text AS business_name
        FROM restaurants
        WHERE user_id = provider.id
        ORDER BY is_verified DESC, id DESC
        LIMIT 1
      ) restaurant ON true
      WHERE fl.provider_id IS NOT NULL
      AND (
        r.completed_at IS NOT NULL
        OR r.picked_up_at IS NOT NULL
        OR r.status IN ('completed','picked_up','delivered')
        OR r.task_status IN ('completed','delivered','picked_up')
      )
      AND ${windowPredicate("COALESCE(r.completed_at, r.picked_up_at, r.reserved_at)")}
      GROUP BY fl.provider_id, provider.name, restaurant.restaurant_name, restaurant.business_name
      ORDER BY fulfillments DESC, provider_name ASC
      LIMIT $2
      `,
      [startAt, TOP_LIMIT]
    ),
  ]);

  return {
    counts: {
      active_providers: toInt(counts.active_providers),
      new_providers: toInt(counts.new_providers),
      verified_providers: toInt(counts.verified_providers),
    },
    top_providers: {
      by_listings: byListings.rows || [],
      by_reservations: byReservations.rows || [],
      by_fulfillments: byFulfillments.rows || [],
    },
    source: source(
      "users, restaurants, food_listings, reservations",
      "provider participation within period; listing counts use created_at without inventory visibility filters"
    ),
  };
}

async function getNgoParticipation({ client, startAt }) {
  const counts = await queryOne(
    client,
    `
    SELECT
      (
        SELECT COUNT(DISTINCT r.user_id)::int
        FROM reservations r
        JOIN users u ON u.id = r.user_id
        WHERE u.role = 'ngo'
        AND ${windowPredicate("r.reserved_at")}
      ) AS active_ngos,
      (
        SELECT COUNT(*)::int
        FROM ngos n_new
        WHERE ${windowPredicate("n_new.created_at")}
      ) AS new_ngos,
      (
        SELECT COUNT(*)::int
        FROM ngos n_verified
        WHERE n_verified.is_verified = true
        AND ${windowPredicate("n_verified.created_at")}
      ) AS verified_ngos,
      (
        SELECT COUNT(*)::int
        FROM reservations r
        JOIN users u ON u.id = r.user_id
        WHERE u.role = 'ngo'
        AND (
          r.completed_at IS NOT NULL
          OR r.task_status IN ('completed','delivered','picked_up')
          OR r.status IN ('completed','picked_up','delivered')
        )
        AND ${windowPredicate("COALESCE(r.completed_at, r.picked_up_at, r.reserved_at)")}
      ) AS successful_deliveries
    `,
    [startAt]
  );

  const [byReservations, byDeliveries] = await Promise.all([
    client.query(
      `
      SELECT r.user_id AS ngo_user_id,
             COALESCE(NULLIF(TRIM(n.organization_name), ''), NULLIF(TRIM(u.name), ''), 'NGO unavailable') AS ngo_name,
             COUNT(r.id)::int AS reservations
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN ngos n ON n.user_id = u.id
      WHERE u.role = 'ngo'
      AND ${windowPredicate("r.reserved_at")}
      GROUP BY r.user_id, u.name, n.organization_name
      ORDER BY reservations DESC, ngo_name ASC
      LIMIT $2
      `,
      [startAt, TOP_LIMIT]
    ),
    client.query(
      `
      SELECT r.user_id AS ngo_user_id,
             COALESCE(NULLIF(TRIM(n.organization_name), ''), NULLIF(TRIM(u.name), ''), 'NGO unavailable') AS ngo_name,
             COUNT(r.id)::int AS deliveries
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN ngos n ON n.user_id = u.id
      WHERE u.role = 'ngo'
      AND (
        r.completed_at IS NOT NULL
        OR r.task_status IN ('completed','delivered','picked_up')
        OR r.status IN ('completed','picked_up','delivered')
      )
      AND ${windowPredicate("COALESCE(r.completed_at, r.picked_up_at, r.reserved_at)")}
      GROUP BY r.user_id, u.name, n.organization_name
      ORDER BY deliveries DESC, ngo_name ASC
      LIMIT $2
      `,
      [startAt, TOP_LIMIT]
    ),
  ]);

  return {
    counts: {
      active_ngos: toInt(counts.active_ngos),
      new_ngos: toInt(counts.new_ngos),
      verified_ngos: toInt(counts.verified_ngos),
      successful_deliveries: toInt(counts.successful_deliveries),
    },
    top_ngos: {
      by_reservations: byReservations.rows || [],
      by_deliveries: byDeliveries.rows || [],
    },
    source: source("users, ngos, reservations", "NGO participation within period"),
  };
}

async function getVolunteerParticipation({ client, startAt }) {
  const counts = await queryOne(
    client,
    `
    SELECT
      COUNT(DISTINCT r.assigned_volunteer_id)::int AS active_volunteers,
      COUNT(*) FILTER (
        WHERE r.completed_at IS NOT NULL
        OR r.task_status = 'delivered'
      )::int AS completed_deliveries,
      COUNT(*)::int AS assigned_deliveries
    FROM reservations r
    WHERE r.assigned_volunteer_id IS NOT NULL
    AND ${windowPredicate("COALESCE(r.assigned_at, r.reserved_at)")}
    `,
    [startAt]
  );

  const top = await client.query(
    `
    SELECT r.assigned_volunteer_id AS volunteer_id,
           COALESCE(NULLIF(TRIM(u.name), ''), r.assigned_volunteer_id::text) AS volunteer_name,
           COUNT(r.id)::int AS deliveries
    FROM reservations r
    LEFT JOIN users u ON u.id = r.assigned_volunteer_id
    WHERE r.assigned_volunteer_id IS NOT NULL
    AND (
      r.completed_at IS NOT NULL
      OR r.task_status = 'delivered'
    )
    AND ${windowPredicate("COALESCE(r.completed_at, r.reserved_at)")}
    GROUP BY r.assigned_volunteer_id, u.name
    ORDER BY deliveries DESC, volunteer_name ASC
    LIMIT $2
    `,
    [startAt, TOP_LIMIT]
  );

  return {
    counts: {
      active_volunteers: toInt(counts.active_volunteers),
      completed_deliveries: toInt(counts.completed_deliveries),
      completion_rate: percent(counts.completed_deliveries, counts.assigned_deliveries),
    },
    top_volunteers: {
      by_deliveries: top.rows || [],
    },
    source: source("reservations, users", "assigned volunteer delivery rows within period"),
  };
}

async function getReservationPerformance({ client, startAt }) {
  const row = await queryOne(
    client,
    `
    SELECT
      COUNT(*) FILTER (WHERE ${windowPredicate("r.reserved_at")})::int AS created,
      COUNT(*) FILTER (
        WHERE (
          r.completed_at IS NOT NULL
          OR r.status IN ('completed','picked_up','delivered')
          OR r.task_status IN ('completed','delivered','picked_up')
        )
        AND ${windowPredicate("COALESCE(r.completed_at, r.picked_up_at, r.reserved_at)")}
      )::int AS completed,
      COUNT(*) FILTER (
        WHERE r.status IN ('cancelled','cancelled_before_confirmation','timeout_cancelled')
        AND ${windowPredicate("r.reserved_at")}
      )::int AS cancelled,
      COUNT(*) FILTER (
        WHERE r.status IN ('expired','expired_payment','payment_expired','abandoned_payment')
        AND ${windowPredicate("r.reserved_at")}
      )::int AS expired
    FROM reservations r
    `,
    [startAt]
  );

  return {
    created: toInt(row.created),
    completed: toInt(row.completed),
    cancelled: toInt(row.cancelled),
    expired: toInt(row.expired),
    completion_rate: percent(row.completed, row.created),
    cancellation_rate: percent(row.cancelled, row.created),
    source: source("reservations", "status, task_status, reserved_at, picked_up_at, completed_at within period"),
  };
}

async function getTrustInsights({ client }) {
  const row = await queryOne(
    client,
    `
    SELECT
      COALESCE(AVG(trust_score), 0)::numeric AS average_trust_score,
      COUNT(*) FILTER (
        WHERE GREATEST(projected_restriction_level, restriction_level) > 0
      )::int AS restricted_entities,
      COUNT(*) FILTER (
        WHERE COALESCE(projected_cooldown_until, cooldown_until) > NOW()
      )::int AS cooldown_entities,
      COUNT(*) FILTER (
        WHERE GREATEST(projected_deposit_multiplier, deposit_multiplier) = 1
      )::int AS deposit_1x,
      COUNT(*) FILTER (
        WHERE GREATEST(projected_deposit_multiplier, deposit_multiplier) > 1
        AND GREATEST(projected_deposit_multiplier, deposit_multiplier) <= 1.5
      )::int AS deposit_1_5x,
      COUNT(*) FILTER (
        WHERE GREATEST(projected_deposit_multiplier, deposit_multiplier) > 1.5
        AND GREATEST(projected_deposit_multiplier, deposit_multiplier) <= 2
      )::int AS deposit_2x,
      COUNT(*) FILTER (
        WHERE GREATEST(projected_deposit_multiplier, deposit_multiplier) > 2
      )::int AS deposit_gt_2x
    FROM trust_scores
    `
  );

  return {
    average_trust_score: Number(toFloat(row.average_trust_score).toFixed(2)),
    restricted_entities: toInt(row.restricted_entities),
    cooldown_entities: toInt(row.cooldown_entities),
    deposit_multiplier_distribution: [
      { bucket: "1x", count: toInt(row.deposit_1x) },
      { bucket: "1.01x-1.5x", count: toInt(row.deposit_1_5x) },
      { bucket: "1.51x-2x", count: toInt(row.deposit_2x) },
      { bucket: ">2x", count: toInt(row.deposit_gt_2x) },
    ],
    source: source("trust_scores", "aggregate current trust state only", false),
    informational_only: true,
    enforcement_action: null,
  };
}

async function getGovernanceInsights({ client, startAt }) {
  const row = await queryOne(
    client,
    `
    SELECT
      (
        SELECT COUNT(*)::int
        FROM provider_reports pr
        WHERE ${windowPredicate("pr.created_at")}
      ) AS reports_submitted,
      (
        SELECT COUNT(*)::int
        FROM provider_reports pr
        WHERE pr.status = 'validated'
        AND ${windowPredicate("COALESCE(pr.resolved_at, pr.created_at)")}
      ) AS reports_validated,
      (
        SELECT COUNT(*)::int
        FROM provider_reports pr
        WHERE pr.status = 'dismissed'
        AND ${windowPredicate("COALESCE(pr.resolved_at, pr.created_at)")}
      ) AS reports_dismissed,
      (
        SELECT COUNT(*)::int
        FROM moderation_cases mc
        WHERE ${windowPredicate("mc.created_at")}
      ) AS moderation_cases,
      (
        SELECT COUNT(*)::int
        FROM moderation_appeals ma
        WHERE ${windowPredicate("ma.submitted_at")}
      ) AS appeals_submitted,
      (
        SELECT COUNT(*)::int
        FROM moderation_appeals ma
        WHERE ma.status = 'ACCEPTED'
        AND ${windowPredicate("COALESCE(ma.reviewed_at, ma.updated_at, ma.submitted_at)")}
      ) AS appeals_accepted,
      (
        SELECT COUNT(*)::int
        FROM moderation_appeals ma
        WHERE ma.status = 'REJECTED'
        AND ${windowPredicate("COALESCE(ma.reviewed_at, ma.updated_at, ma.submitted_at)")}
      ) AS appeals_rejected
    `,
    [startAt]
  );

  return {
    reports_submitted: toInt(row.reports_submitted),
    reports_validated: toInt(row.reports_validated),
    reports_dismissed: toInt(row.reports_dismissed),
    moderation_cases: toInt(row.moderation_cases),
    appeals_submitted: toInt(row.appeals_submitted),
    appeals_accepted: toInt(row.appeals_accepted),
    appeals_rejected: toInt(row.appeals_rejected),
    source: source("provider_reports, moderation_cases, moderation_appeals", "governance records within period"),
    informational_only: true,
    enforcement_action: null,
  };
}

async function getFinancialInsights({ client, startAt }) {
  const row = await queryOne(
    client,
    `
    SELECT
      (
        SELECT COUNT(*)::int
        FROM provider_settlements ps
        WHERE ${windowPredicate("ps.created_at")}
      ) AS settlements_generated,
      (
        SELECT COUNT(*)::int
        FROM provider_settlements ps
        WHERE ps.status IN ('paid','settled')
        AND ${windowPredicate("ps.updated_at")}
      ) AS settlements_completed,
      (
        SELECT COUNT(*)::int
        FROM financial_refund_terminal_records fr
        WHERE fr.terminal_status = 'refunded'
        AND ${windowPredicate("fr.created_at")}
      ) AS refunds_processed
    `,
    [startAt]
  );

  return {
    settlements_generated: toInt(row.settlements_generated),
    settlements_completed: toInt(row.settlements_completed),
    refunds_processed: toInt(row.refunds_processed),
    source: source("provider_settlements, financial_refund_terminal_records", "settlement/refund terminal records within period"),
    recalculates_ledgers: false,
  };
}

async function getTrendAnalytics({ client, filters, generatedAt }) {
  const trendPeriod = TREND_PERIODS.has(filters.period) ? filters.period : "365d";
  const window = windowForPeriod(trendPeriod, generatedAt);
  const result = await client.query(
    `
    WITH days AS (
      SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS bucket
    ),
    listing_counts AS (
      SELECT fl.created_at::date AS bucket, COUNT(*)::int AS count
      FROM food_listings fl
      WHERE fl.created_at >= $1::timestamptz
      GROUP BY fl.created_at::date
    ),
    reservation_counts AS (
      SELECT r.reserved_at::date AS bucket, COUNT(*)::int AS count
      FROM reservations r
      WHERE r.reserved_at >= $1::timestamptz
      GROUP BY r.reserved_at::date
    ),
    delivery_counts AS (
      SELECT r.completed_at::date AS bucket, COUNT(*)::int AS count
      FROM reservations r
      WHERE r.completed_at >= $1::timestamptz
      AND (
        r.assigned_volunteer_id IS NOT NULL
        OR r.task_status = 'delivered'
      )
      GROUP BY r.completed_at::date
    ),
    report_counts AS (
      SELECT pr.created_at::date AS bucket, COUNT(*)::int AS count
      FROM provider_reports pr
      WHERE pr.created_at >= $1::timestamptz
      GROUP BY pr.created_at::date
    ),
    settlement_counts AS (
      SELECT ps.created_at::date AS bucket, COUNT(*)::int AS count
      FROM provider_settlements ps
      WHERE ps.created_at >= $1::timestamptz
      GROUP BY ps.created_at::date
    )
    SELECT
      days.bucket::text AS bucket,
      COALESCE(listing_counts.count, 0)::int AS listings,
      COALESCE(reservation_counts.count, 0)::int AS reservations,
      COALESCE(delivery_counts.count, 0)::int AS deliveries,
      COALESCE(report_counts.count, 0)::int AS reports,
      COALESCE(settlement_counts.count, 0)::int AS settlements
    FROM days
    LEFT JOIN listing_counts ON listing_counts.bucket = days.bucket
    LEFT JOIN reservation_counts ON reservation_counts.bucket = days.bucket
    LEFT JOIN delivery_counts ON delivery_counts.bucket = days.bucket
    LEFT JOIN report_counts ON report_counts.bucket = days.bucket
    LEFT JOIN settlement_counts ON settlement_counts.bucket = days.bucket
    ORDER BY days.bucket ASC
    `,
    [window.start_at, window.end_at]
  );

  return {
    period: trendPeriod,
    window,
    series: result.rows || [],
    source: source(
      "food_listings, reservations, provider_reports, provider_settlements",
      "daily counts for selected trend period"
    ),
  };
}

async function getBusinessMetrics(options = {}) {
  const client = options.client || pool;
  const filters = normalizeBusinessMetricsFilters(options);
  const generatedAt = new Date();
  const window = windowForPeriod(filters.period, generatedAt);
  const startAt = window.start_at;

  const [
    platform,
    listingInventory,
    foodRescue,
    providerParticipation,
    ngoParticipation,
    volunteerParticipation,
    reservationPerformance,
    trustInsights,
    governanceInsights,
    financialInsights,
    trends,
  ] = await Promise.all([
    getPlatformSummary({ client, filters, generatedAt }),
    getListingInventory({ client }),
    getFoodRescueMetrics({ client, startAt }),
    getProviderParticipation({ client, startAt }),
    getNgoParticipation({ client, startAt }),
    getVolunteerParticipation({ client, startAt }),
    getReservationPerformance({ client, startAt }),
    getTrustInsights({ client }),
    getGovernanceInsights({ client, startAt }),
    getFinancialInsights({ client, startAt }),
    getTrendAnalytics({ client, filters, generatedAt }),
  ]);

  return {
    generated_at: generatedAt.toISOString(),
    filters: publicFilters(filters),
    window,
    informational_only: true,
    enforcement_action: null,
    platform,
    listing_inventory: listingInventory,
    food_rescue: foodRescue,
    provider_participation: providerParticipation,
    ngo_participation: ngoParticipation,
    volunteer_participation: volunteerParticipation,
    reservation_performance: reservationPerformance,
    trust_insights: trustInsights,
    governance_insights: governanceInsights,
    financial_insights: financialInsights,
    trend_analytics: trends,
    analysis: ANALYSIS,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function addMetricRows(rows, section, metrics, sourceInfo = {}) {
  for (const [key, value] of Object.entries(metrics || {})) {
    if (value && typeof value === "object") continue;
    rows.push({
      section,
      metric: key,
      value,
      source_table: sourceInfo.table || "",
      source_predicate: sourceInfo.predicate || "",
    });
  }
}

function businessMetricsToCsv(metrics) {
  const rows = [];
  addMetricRows(rows, "platform_overview", metrics.platform?.selected, metrics.platform?.selected?.source);
  addMetricRows(rows, "listing_inventory", metrics.listing_inventory, metrics.listing_inventory?.source);
  addMetricRows(rows, "food_rescue", metrics.food_rescue, metrics.food_rescue?.source);
  addMetricRows(rows, "provider_participation", metrics.provider_participation?.counts, metrics.provider_participation?.source);
  addMetricRows(rows, "ngo_participation", metrics.ngo_participation?.counts, metrics.ngo_participation?.source);
  addMetricRows(rows, "volunteer_participation", metrics.volunteer_participation?.counts, metrics.volunteer_participation?.source);
  addMetricRows(rows, "reservation_performance", metrics.reservation_performance, metrics.reservation_performance?.source);
  addMetricRows(rows, "trust_insights", metrics.trust_insights, metrics.trust_insights?.source);
  addMetricRows(rows, "governance_insights", metrics.governance_insights, metrics.governance_insights?.source);
  addMetricRows(rows, "financial_insights", metrics.financial_insights, metrics.financial_insights?.source);

  for (const summary of metrics.platform?.period_summaries || []) {
    for (const key of [
      "total_food_listings",
      "total_reservations",
      "completed_pickups",
      "completed_deliveries",
    ]) {
      rows.push({
        section: `platform_${summary.period}`,
        metric: key,
        value: summary[key],
        source_table: summary.source?.table || "",
        source_predicate: summary.source?.predicate || "",
      });
    }
  }

  const headers = ["section", "metric", "value", "source_table", "source_predicate"];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function exportBusinessMetrics(options = {}) {
  const metrics = await getBusinessMetrics(options);
  return {
    generated_at: new Date().toISOString(),
    filters: metrics.filters,
    window: metrics.window,
    metrics,
  };
}

module.exports = {
  ANALYSIS,
  PERIOD_OPTIONS,
  businessMetricsToCsv,
  exportBusinessMetrics,
  getBusinessMetrics,
  normalizeBusinessMetricsFilters,
  windowForPeriod,
};
