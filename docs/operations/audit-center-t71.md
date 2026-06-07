# T7.1 Audit Center

## Architecture Analysis

The Audit Center is a read-only aggregate over existing audit-producing systems. It does not own trust, moderation, appeals, verification, governance, notification, or financial records. It normalizes those records into one operational timeline with source lineage fields.

Primary sources:

- Trust: `trust_events`, `admin_trust_actions`; `trust_event_effects` is supporting lineage summarized on trust events.
- Moderation: `provider_reports`, `provider_report_attachments`, `moderation_cases`, `moderation_case_events`.
- Appeals: `moderation_appeals`, `moderation_appeal_events`.
- Verification: NGO and provider approval/rejection events in `operational_events`.
- Governance: derived read models from `governanceIntelligence.service` and `governanceDashboard.service`, plus future `operational_events` with governance category.
- Financial: `financial_ledger_entries`, `settlement_allocation_snapshots`, `provider_settlements`, `settlement_batches`, `financial_operations`, `financial_state_transitions`, `financial_refund_terminal_records`, `cashfree_webhook_audit_log`, `payment_order_attempts`.
- Notifications: `notifications`.

## Gap Analysis

- Governance intelligence signals are generated read-model evidence, not persisted immutable signal rows.
- Notification delivery attempts do not have a dedicated delivery record table.
- Verification action history currently relies on `operational_events`, which is append-style but not protected by an immutability trigger.

## Reuse Analysis

The implementation reuses existing audit tables and services. It avoids duplicate trust event rendering by not listing `trust_event_effects` as independent timeline rows. Effects are exposed as supporting lineage counts on `trust_events`.

The Audit Center does not call trust projection logic, moderation transition logic, appeal transition logic, or financial mutation services. Export uses the same read-only query path as the timeline.

## Risk Analysis

- Query efficiency: branch selection limits the union to selected domains; migration `022` adds timeline indexes for timestamp and id ordering.
- Pagination: keyset cursor pagination avoids large offsets for 100k+ records.
- Export performance: exports are capped at 5000 rows and use the same filters.
- Audit consistency: source identifiers and record identifiers remain visible for every row.
- Duplicate rendering: cross-domain events can describe the same business activity; source lineage makes this explainable.
- Cross-domain correlation: free-text search helps investigation, but source-specific views remain better for deep forensic work.

## Schema Changes

Migration `022_audit_center_t71` adds indexes only. It creates no new mutable audit table and does not alter existing audit record semantics.

## Backend Audit APIs

- `GET /api/v1/admin/audit-center`
- `GET /api/v1/admin/audit-center/export.csv`
- `GET /api/v1/admin/audit-center/export.json`

Supported filters:

- `domains`: comma-separated domains.
- `actorType`: user, provider, ngo, volunteer, admin, system, gateway.
- `actorId`: exact actor/target/source id search.
- `q`: event search across case ids, appeal ids, trust event ids, subject ids, payment ids, and source identifiers.
- `limit`: capped at 100 for timeline and 5000 for export.
- `cursor`: keyset pagination cursor returned by the API.

## Export Architecture

CSV and JSON exports are read-only. Metadata is sanitized to remove raw payloads, signatures, tokens, secrets, cookies, OTP values, authorization values, and gateway response blobs. Idempotency keys and payload hashes remain because they support lineage and do not expose credentials.

## Frontend Audit Center

The page is available at `/admin/audit-center`. It provides domain filters, actor/entity filters, event search, keyset pagination, selected-event details, source lineage, recent admin actions, source inventory, and CSV/JSON export buttons.

Navigation into Audit Center is available from:

- Governance Dashboard
- Trust Explainability
- Provider Reports
- Moderation Appeals
- Moderation Case Detail

## Manual Test Plan

1. Open `/admin/audit-center` as an admin and confirm the global timeline loads.
2. Filter each domain and verify unrelated domains disappear.
3. Search by a known moderation case id, appeal id, trust event key, subject id, payment order id, and provider report id.
4. Select a row and verify source table, event identifier, record identifier, actor, target, event type, timestamp, and metadata are visible.
5. Use actor type `admin` and verify recent admin actions agree with the dedicated panel.
6. Export CSV and JSON for a narrow filter and confirm no raw payloads, signatures, tokens, or secrets appear.
7. Use "Load more" and confirm rows append without duplicates.
8. Navigate from Governance Dashboard, Trust, Provider Reports, Appeals, and Moderation Case Detail into filtered Audit Center views.
9. Confirm no trust formulas, moderation workflows, appeal workflows, or financial workflows changed during validation.
