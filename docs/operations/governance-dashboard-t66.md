# T6.6 Governance Dashboard

## Architecture Analysis

T6.6 adds a read-only governance operations center. It aggregates existing governance data without changing trust formulas, moderation workflows, appeal workflows, notification delivery, or enforcement behavior.

The dashboard reads from:

- `moderation_cases` for current case status counts and queue slices.
- `moderation_case_events` for explainable recent moderation activity.
- `moderation_appeals` for current appeal queues and recent accepted/rejected outcomes.
- `moderation_appeal_events` for appeal activity lineage.
- `trust_scores` for restricted, cooldown, high-deposit, and high-risk trust visibility.
- `admin_trust_actions` for recent audited admin trust actions.
- `notifications` for recent governance-related notification activity.
- `governanceIntelligence.service` for T6.5 signal generation, reporter reputation, provider governance metrics, and escalation intelligence.

## Gap Analysis

Existing admin pages covered provider reports, appeal review, trust explainability, and governance intelligence, but there was no single operational dashboard. The missing layer was a read model that could answer current workload, appeal state, trust exposure, recent activity, and highest-priority signals in one response.

## Reuse Analysis

The dashboard reuses:

- Existing admin auth and route structure.
- Existing governance intelligence filters and signal logic.
- Existing moderation case and appeal tables/events.
- Existing trust explainability tables and admin action audit rows.
- Existing notification persistence.
- Existing admin UI shell, formatting helpers, and detailed pages for drilldown.

## Risk Analysis

- Query efficiency: T6.6 adds only supporting indexes. The service limits queue/activity rows and reuses indexed status/date predicates.
- Aggregation performance: expensive intelligence calculations remain in the existing T6.5 service and are bounded by `limit`.
- Stale data: dashboard is live SQL plus generated timestamps, not cached.
- Metric consistency: status counts use current rows; windowed outcomes use existing timestamp fields.
- Double counting: current counts are separated from windowed outcomes and high-risk actor totals are labeled by source.
- Explainability: metrics and rows include source table/predicate metadata and drill down to existing detail pages.

## T6.6.1 Consistency Fix

Root cause:

- Trust Visibility rendered a client-side merge of `restricted_actors`, `cooldown_actors`, and `high_deposit_multiplier_actors`. A subject can legitimately appear in more than one bucket, which produced duplicate React keys for `subject_type + subject_id`.
- High Risk Actors consumed provider/reporter intelligence arrays directly. Defensive de-duplication was missing at the dashboard boundary, so duplicate upstream actor rows could render duplicate keys.
- Appeal dashboard rows had one `provider_reports` join with an `OR` predicate that could amplify rows if historical data linked multiple reports to one moderation case.

Fix:

- The dashboard service now returns `trust.visibility_actors`, a unique subject collection keyed by `subject_type + subject_id`.
- Intelligence providers, reporters, signals, notifications, and recent moderation activity are de-duplicated before dashboard response assembly.
- Appeal row report context now uses a single-row lateral lookup to avoid join amplification.
- React keys remain stable domain identifiers; no index-based keys were introduced.

## Backend API

`GET /api/v1/admin/governance-dashboard`

Supported query parameters:

- `windowDays`, `window_days`, or `days`
- `limit`
- `risk`
- `reporterId` or `reporter_id`
- `providerId` or `provider_id`

The response is informational only and includes `enforcement_action: null`.

## Filtering Architecture

The frontend exposes 30, 90, 180, and 365 day windows. The backend reuses the T6.5 bounded window normalization so direct API calls remain safe within 1 to 365 days.

Current workload counts are current status snapshots. Outcome/activity/signal sections are windowed.

## Navigation Architecture

Dashboard cards link to existing admin detail pages:

- Moderation cards: `/admin/provider-reports`
- Case rows: `/admin/moderation-cases/:id`
- Appeal cards: `/admin/moderation-appeals`
- Trust actor rows: `/admin/trust?subjectType=...&subjectId=...`
- Intelligence signal sections: `/admin/governance-intelligence`
- Notifications: `/notifications`

## Manual Test Plan

1. Run migrations through `021_governance_dashboard_t66`.
2. Log in as an admin and open `/admin/governance-dashboard`.
3. Switch 30, 90, 180, and 365 day windows and confirm windowed activity/signal sections update.
4. Open each metric card and confirm it lands on the existing detailed page.
5. Open a moderation case row and confirm it lands on the case detail page.
6. Open a restricted/cooldown/deposit actor and confirm Trust Explainability preloads that actor.
7. Open submitted, accepted, and rejected appeal drilldowns and confirm terminal appeals are read-only.
8. Confirm no dashboard action creates penalties, restrictions, trust events, case transitions, or appeal transitions.
9. Confirm Trust Visibility does not repeat the same actor when an actor is both restricted and on cooldown or deposit escalation.
10. Confirm High Risk Actors does not repeat the same provider/reporter, and the browser console shows no duplicate React key warnings.
