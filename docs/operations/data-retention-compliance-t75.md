# T7.5 Data Retention & Compliance

## Architecture Analysis

T7.5 adds a compliance control plane beside the existing validated systems. It does not change trust scoring, financial workflows, moderation transitions, appeal transitions, settlement accounting, or incident state management.

The phase introduces:

- `retention_policies` as the platform-wide policy registry.
- `data_deletion_requests` as the controlled privacy and deletion workflow.
- `data_archive_records` as a discoverable archive inventory.
- `compliance_events` as the immutable compliance audit ledger.
- Archive metadata on provider report evidence, appeal evidence, and notifications.
- `/admin/compliance` as the admin-only dashboard and workflow surface.

Compliance execution is conservative by design. Account deletion requests anonymize user contact fields and archive notifications; they do not delete user ids or any financial, trust, audit, governance, evidence, or incident records required for replay, reconciliation, or investigation.

## Gap Analysis

- Notification delivery attempts are still represented by notification records plus worker observability rather than a dedicated delivery-attempt table.
- Cloudinary assets have durable URLs but no separate cold-storage bucket, so archival currently preserves and marks existing Cloudinary references.
- Data access requests produce a tracked workflow and summary, but not a full downloadable user-data export bundle yet.
- Automatic physical destruction is intentionally absent until legal hold, investigation, and reconciliation blockers are mature enough to evaluate safely.

## Reuse Analysis

- Trust: `trust_events`, `trust_event_effects`, `trust_scores`, and `trust_restrictions` remain retained for replay.
- Financial: ledger entries, settlement snapshots, provider settlements, batches, payment ownership, webhook audit, reconciliation state, and refund terminal records remain protected.
- Governance: provider reports, attachments, moderation cases, case events, appeals, and appeal events remain discoverable.
- Evidence: provider report and appeal attachments reuse existing Cloudinary URLs and gain archive metadata.
- Incidents: immutable incident records, events, notes, and postmortems remain investigation records.
- Audit Center: `compliance_events` is added as a new searchable audit domain.

## Risk Analysis

- Audit loss: mitigated by immutable `compliance_events` and never-delete audit policy.
- Trust replay loss: mitigated by excluding trust replay records from destructive paths.
- Reconciliation loss: mitigated by never deleting financial and settlement records.
- Evidence loss: mitigated by archive markers that preserve Cloudinary references and moderation history.
- Privacy compliance gaps: mitigated by controlled request/review/approval/execution workflow and anonymization.
- Archive discoverability: mitigated by `data_archive_records`, archive status columns, Audit Center links, and Compliance Dashboard inventory.

## Retention Policy Design

- Audit Records: indefinite retention, searchable hot storage, never deleted by default.
- Financial Records: indefinite retention while reconciliation and settlement integrity are required.
- Trust Replay Records: indefinite retention for replay and reconstruction.
- Governance Records: 2555-day retention, archive eligible after 1095 days, not deleted by default.
- Evidence Assets: 1095-day retention, archive eligible after 365 days, Cloudinary reference preserved.
- Incident Records: 2555-day retention, archive eligible after 1095 days, not deleted by default.
- Notifications: active retention for 365 days, archive eligible after 180 days, controlled deletion review after 730 days.
- Privacy Requests: 2555-day retention, never deleted by default.

## Backend APIs

- `GET /api/v1/admin/compliance`
- `POST /api/v1/admin/compliance/deletion-requests`
- `GET /api/v1/admin/compliance/deletion-requests/:id`
- `PATCH /api/v1/admin/compliance/deletion-requests/:id/review`
- `PATCH /api/v1/admin/compliance/deletion-requests/:id/approve`
- `PATCH /api/v1/admin/compliance/deletion-requests/:id/reject`
- `PATCH /api/v1/admin/compliance/deletion-requests/:id/execute`
- `POST /api/v1/admin/compliance/evidence/:evidenceType/:id/archive`

All mutation endpoints are admin-only, rate-limited through `adminActionLimiter`, transactional, and audited.

## Compliance Dashboard

`/admin/compliance` displays:

- Retention policy registry.
- Pending and recent deletion requests.
- Evidence inventory and archive actions.
- Audit, financial, trust, incident, and notification retention status.
- Recent compliance events.
- Linkage into Audit Center filtered to the compliance domain.

## Audit Integration

Compliance actions write immutable rows to `compliance_events`. Audit Center now includes a `compliance` domain and links compliance events back to `/admin/compliance`.

Operational breadcrumbs are also written to `operational_events` under the `compliance` category.

## Privacy Workflow Design

1. Request: admin records a deletion, access, anonymization, evidence, or notification cleanup request.
2. Review: admin moves the request to `UNDER_REVIEW`.
3. Approval: admin approves and captures a protected-record snapshot.
4. Execution: approved requests execute only anonymization or archival paths.
5. Audit: every step writes an immutable compliance event.

## Archival Strategy

- Evidence archival marks the source attachment archived and records a `data_archive_records` row.
- Cloudinary URLs are preserved as `archive_reference`; no Cloudinary delete call is performed.
- Notification cleanup marks rows archived after 180 days instead of deleting them.
- Archived records remain searchable through Compliance Dashboard and relevant Audit Center domains.

## Manual Test Plan

1. Create an account deletion request.
2. Review and approve the request.
3. Execute the request and verify user contact fields are anonymized.
4. Verify audit records remain.
5. Verify financial ledger, settlement, refund, and reconciliation records remain.
6. Verify trust events, effects, scores, and restrictions remain queryable.
7. Archive evidence and verify Cloudinary URL/reference remains.
8. Verify archived records remain visible in Compliance Dashboard.
9. Verify Audit Center shows compliance actions under the compliance domain.
10. Run notification cleanup and verify old notifications are archived, not deleted.
