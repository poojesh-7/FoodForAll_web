# T7.4 Business Metrics

## Architecture Analysis

Business Metrics is a read-only analytics layer over existing production records. It does not own platform state, trigger workflows, or recalculate ledgers. The dashboard and exports are produced from one shared service so exported values match the displayed values.

T7.4.1 aligns metric definitions into two groups:

- Historical Activity Metrics: window-based counts/sums using creation or completion timestamps.
- Current Inventory Metrics: current-state listing/trust visibility counts using existing state fields.

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
- T7.4 initially counted non-deleted listings under the `Total Food Listings` label. T7.4.1 corrects this to all listings created in the selected window and surfaces inventory state separately.

## Definition Classification

| Metric | Classification | Correct definition |
| --- | --- | --- |
| Total Food Listings | Historical Activity Metrics | `COUNT(*)` from `food_listings` by `created_at` window. |
| Total Reservations | Historical Activity Metrics | `COUNT(*)` from `reservations` by `reserved_at` window. |
| Completed Pickups | Historical Activity Metrics | `COUNT(*)` from `reservations` by `picked_up_at` window. |
| Completed Deliveries | Historical Activity Metrics | delivered/volunteer reservation completions by `completed_at` window. |
| Food Rescued | Historical Activity Metrics | `SUM(reservations.quantity_reserved)` for completed/picked-up reservations in window. |
| Provider Participation | Historical Activity Metrics | provider listing/reservation/fulfillment activity in window. |
| NGO Participation | Historical Activity Metrics | NGO reservation/delivery activity in window. |
| Volunteer Participation | Historical Activity Metrics | volunteer assignment/completion activity in window. |
| Reservation Performance | Historical Activity Metrics | reservation created/completed/cancelled/expired counts in window. |
| Governance Insights | Historical Activity Metrics | reports/cases/appeals by submission or review timestamps in window. |
| Financial Insights | Historical Activity Metrics | settlements/refund terminal records in window. |
| Trend Analytics | Historical Activity Metrics | daily activity counts in trend window. |
| Active Listings | Current Inventory Metrics | non-deleted active listings with future pickup window and positive remaining quantity. |
| Archived Listings | Current Inventory Metrics | listings with `is_deleted`, `deleted_at`, or `status='deleted'`. |
| Expired Listings | Current Inventory Metrics | non-archived listings with `status='expired'` or active listings past pickup window. |
| Fulfilled Listings | Current Inventory Metrics | non-archived listings with `status='completed'` or zero remaining quantity. |
| Trust Insights | Current Inventory Metrics | aggregate current `trust_scores` state. |

## Reuse Analysis

The implementation reuses existing read models and avoids duplicate calculations:

- Platform summary uses listing creation, reservation creation, pickup timestamps, and delivery completion timestamps.
- Current listing inventory reuses existing listing visibility fields: `status`, `is_deleted`, `deleted_at`, `pickup_end_time`, and `remaining_quantity`.
- Food rescue uses completed or picked-up reservations and their reserved quantities.
- Participation rankings use the same reservation/listing records that power operational dashboards.
- Trust insights expose only aggregate counts, average score, and deposit distribution.
- Financial insights count settlement and refund terminal records instead of deriving balances from payments.

## Risk Analysis

- Metric correctness: each metric includes source lineage in the API response.
- Definition drift: historical listing metrics no longer use archive/current-state filters; inventory metrics carry separate labels and lineage.
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
- Current Listing Inventory
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

T7.4.1 export alignment:

- `Total Food Listings` exports historical created-listing counts.
- `Active Listings`, `Archived Listings`, `Expired Listings`, and `Fulfilled Listings` export under `listing_inventory`.
- Trend listing rows count all created listings for the trend date.

## Audit Integration

Business metrics export actions are recorded as `business_metrics_exported` in `operational_events` with category `governance`. Audit Center includes these records in the governance domain and the dashboard links to `/admin/audit-center?domains=governance&q=business_metrics_exported&limit=50`.

## Schema Changes

Migration `024_business_metrics_t74` adds indexes only. It creates no metric table, materialized view, trigger, or mutation path.

T7.4.1 keeps this as an index-only migration. Listing-created indexes are full historical activity indexes, not partial non-deleted inventory indexes.

## Manual Test Plan

1. Open `/admin/business-metrics` as an admin and confirm every section loads.
2. Switch `30d`, `90d`, `180d`, `365d`, and `All Time`; verify section values change consistently.
3. Compare platform counts against raw `food_listings` and `reservations` counts for the same windows.
4. Verify `Total Food Listings` matches listings created in the selected period, including archived/deleted historical rows.
5. Verify `Active Listings` matches current available inventory using existing listing visibility rules.
6. Verify `Archived Listings` matches deleted/archived inventory.
7. Compare food rescued with completed/picked-up reservation `quantity_reserved` sums.
8. Verify historical metrics remain stable when a listing is later archived.
9. Verify trust metrics are aggregate-only and do not expose score breakdowns or event payloads.
10. Verify settlement metrics match provider settlement and refund terminal records.
11. Export CSV and JSON and confirm values match the dashboard for the selected filter.
12. Open Audit Center from the dashboard and confirm export actions are visible after an export.
13. Confirm no trust, reservation, governance, financial, or operational remediation action is available from the page.
