# T6.5 Governance Intelligence

## Architecture Analysis

The existing governance stack already records the durable history needed for intelligence:

- `provider_reports` captures reporter, provider, status, reason, reservation, and admin review result.
- `moderation_cases` provides the case lifecycle and current administrative state.
- `moderation_case_events` provides explainable case history, including escalation transitions.
- `provider_case_responses` captures provider rebuttal context without changing trust state.
- `moderation_appeals` and `moderation_appeal_events` capture dispute outcomes and appeal reversals.
- `admin_trust_actions` and trust explainability remain separate from governance intelligence.
- Notifications and operational events already inform actors and admins, but they are not analytics sources of record.

T6.5 uses a read-only service layer, `governanceIntelligence.service.js`, exposed through admin-only GET routes. It does not call trust projection, trust enforcement, moderation transition, notification, queue, or restriction services.

## Gap Analysis

Before T6.5 there was no reusable admin API for:

- Reporter reliability metrics.
- False-reporting risk signals.
- Provider governance metrics.
- Escalation rates and repeated escalation visibility.
- Combined dashboard data for T6.6.

The implemented APIs fill those gaps with aggregated counts, rates, and explainable signals.

## Reuse Analysis

T6.5 reuses existing immutable or append-only history:

- Report review outcomes from `provider_reports.status`.
- Case lifecycle from `moderation_cases.status`.
- Escalation evidence from `moderation_case_events`.
- Appeal outcomes from `moderation_appeals.status`.
- Provider display helpers already used by moderation admin views.

No trust formulas, trust projections, moderation workflows, or enforcement paths were changed.

## Risk Analysis

False positives remain possible because high report volume, high dismissal rate, or repeated disputes can have legitimate explanations. For that reason every signal includes supporting counts, rates, a time window, and a recommendation to investigate rather than punish.

Misleading analytics are reduced by exposing numerator and denominator counts with each signal. The system avoids black-box scoring and does not persist opaque risk scores.

Performance risk is addressed with additive indexes on reporter, provider, appeal, case, and escalation-event lookup paths. The APIs also bound `windowDays` and `limit`.

Historical consistency depends on existing event history. Migrated cases without detailed event history still contribute case/report counts; escalation-event counts only reflect recorded escalation events.

## Schema Changes

Migration `020_governance_intelligence_t65` adds indexes only. It does not add mutable signal tables and does not alter existing behavior.

## Backend Services And APIs

Service:

- `shared/services/governanceIntelligence.service.js`

Admin APIs:

- `GET /api/v1/admin/governance-intelligence`
- `GET /api/v1/admin/governance-intelligence/reporters`
- `GET /api/v1/admin/governance-intelligence/providers`
- `GET /api/v1/admin/governance-intelligence/signals`
- `GET /api/v1/admin/governance-intelligence/metrics`
- `GET /api/v1/admin/governance-intelligence/escalations`

Supported filters:

- `windowDays`
- `limit`
- `risk`
- `reporterId`
- `providerId`

## Admin UI

The admin dashboard includes `/admin/governance-intelligence`, with summary metrics, explainable risk signals, reporter reputation rows, provider governance rows, and escalation analytics. The UI treats all signals as informational.

## Manual Test Plan

1. Apply migrations and confirm `020_governance_intelligence_t65` succeeds.
2. Open `/admin/governance-intelligence` as an admin.
3. Change the time window and confirm metrics refresh.
4. Review each signal and confirm supporting counts explain the reason.
5. Confirm no action buttons exist that modify trust, restrictions, cooldowns, penalties, deposits, or moderation outcomes.
6. Compare sample reporter counts against `/admin/provider-reports?status=all`.
7. Compare sample provider appeal counts against `/admin/moderation-appeals?status=all`.
