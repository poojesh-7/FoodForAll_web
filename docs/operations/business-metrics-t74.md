# T7.4 Business Metrics

## Architecture Analysis

Business Metrics is a read-only analytics layer over existing production records. It does not own platform state, trigger workflows, or recalculate ledgers. The dashboard and exports are produced from one shared service so exported values match the displayed values.

Primary sources:

- Listings: `food_listings`.
- Reservations, pickups, deliveries, volunteer assignments: `reservations`.
- Providers: `users`, `restaurants`, `food_listings`, `reservations`.
- NGOs: `users`, `ngos`, `reservations`.
- Volunteers: `users`, `reservations`.
- Trust: aggregate fields in `trust_scores`.
- Governance: `provider_reports`, `moderation_cases`, `moderation_appeals`.
- Financial: `provider_settlements`, `settlement_batches`, `financial_refund_terminal_records`.
- Audit integration: export actions are written to `operational_events` and shown in Audit Center governance events.

## Gap Analysis

- The schema has listing quantity units, not canonical weight. Food rescued is therefore reported as platform quantity units from `reservations.quantity_reserved`.
- Provider and NGO verification is stored as current state without `verified_at`, so filtered verified counts use profile creation time.
- Volunteer delivery is reservation state, not a dedicated delivery table.
- Governance intelligence is a derived service model, not an immutable signal table.

## Reuse Analysis

The implementation reuses existing read models and avoids duplicate calculations:

- Platform summary uses listing creation, reservation creation, pickup timestamps, and delivery completion timestamps.
- Food rescue uses completed or picked-up reservations and their reserved quantities.
- Participation rankings use the same reservation/listing records that power operational dashboards.
- Trust insights expose only aggregate counts, average score, and deposit distribution.
- Financial insights count settlement and refund terminal records instead of deriving balances from payments.

## Risk Analysis

- Metric correctness: each metric includes source lineage in the API response.
- Double counting: deliveries are limited to volunteer/delivered task rows; pickups use `picked_up_at`.
- Historical drift: current-state metrics without transition timestamps are documented.
- Trust privacy: sensitive trust internals, score breakdowns, and action history are not exposed.
- Financial consistency: settlement/refund metrics reuse existing F4 tables and do not recalculate ledgers.

## Metrics Design

Supported windows:

- `30d`
- `90d`
- `180d`
- `365d`
- `all`

Platform overview always returns period summaries for 30, 90, 180, 365 days, and all time. Other sections use the selected filter. Trend analytics supports 30, 90, 180, and 365 days; all-time dashboards show a bounded 365-day trend.

## Backend APIs

- `GET /api/v1/admin/business-metrics`
- `GET /api/v1/admin/business-metrics/export.csv`
- `GET /api/v1/admin/business-metrics/export.json`

All routes are admin-only through the existing admin router. Dashboard reads do not write any state. Export routes record an auditable export action in `operational_events`.

## Frontend Dashboard

The dashboard is available at `/admin/business-metrics` and includes:

- Platform Overview
- Food Rescue Metrics
- Provider Participation
- NGO Participation
- Volunteer Participation
- Reservation Performance
- Trust Insights
- Governance Insights
- Financial Insights
- Trend Analytics

## Export Design

CSV and JSON exports use the same read-only service response as the dashboard. CSV flattens dashboard metric values with source table and predicate lineage. JSON returns the full metrics model.

## Audit Integration

Business metrics export actions are recorded as `business_metrics_exported` in `operational_events` with category `governance`. Audit Center includes these records in the governance domain and the dashboard links to `/admin/audit-center?domains=governance&q=business_metrics_exported&limit=50`.

## Schema Changes

Migration `024_business_metrics_t74` adds indexes only. It creates no metric table, materialized view, trigger, or mutation path.

## Manual Test Plan

1. Open `/admin/business-metrics` as an admin and confirm every section loads.
2. Switch `30d`, `90d`, `180d`, `365d`, and `All Time`; verify section values change consistently.
3. Compare platform counts against raw `food_listings` and `reservations` counts for the same windows.
4. Compare food rescued with completed/picked-up reservation `quantity_reserved` sums.
5. Verify trust metrics are aggregate-only and do not expose score breakdowns or event payloads.
6. Verify settlement metrics match provider settlement and refund terminal records.
7. Export CSV and JSON and confirm values match the dashboard for the selected filter.
8. Open Audit Center from the dashboard and confirm export actions are visible after an export.
9. Confirm no trust, reservation, governance, financial, or operational remediation action is available from the page.
