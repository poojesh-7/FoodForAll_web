# T7.2 Operational Monitoring

## Architecture Analysis

T7.2 adds a read-only administrative monitoring center at `/admin/monitoring` backed by `GET /api/v1/admin/operations/monitoring`.

The backend snapshot service aggregates existing operational sources:

- Payments: `payments`, `cashfree_webhook_events`, `provider_settlements`, and financial audit drilldowns.
- Queues: the existing BullMQ monitored queue registry plus `worker_heartbeats`.
- Notifications: `notifications` and `notification-queue` health.
- Realtime: live Socket.IO client count plus Redis ping status for the socket event bridge.
- Trust: `trust_events` processing states and `trust-queue` counts.
- Governance: `moderation_cases` and `moderation_appeals` status aggregates.
- Audit: existing Audit Center routes remain the drilldown target for financial and notification lineage.

The monitoring service intentionally avoids operational mutation paths such as queue retry, queue cleanup, trust replay, payment reconciliation, moderation review, appeal review, and persisted alert writes.

## Gap Analysis

- Socket disconnects and socket errors are logged but not persisted as queryable operational rows.
- Notification delivery failure is observable through queue failures and operational alerts, but individual push delivery outcomes are not stored.
- Settlement failure visibility is limited because `provider_settlements` has no failed status; cancelled settlement rows and payment alerts are used instead.
- Moderation queue visibility is represented by moderation case and appeal queues in Postgres, because there is no dedicated BullMQ moderation queue.

## Reuse Analysis

- Reuses `monitoredQueueConfigs` from `queueObservability.service.js` without calling `getQueueHealth`, because that function can write operational alerts as a side effect.
- Reuses existing indexed operational tables rather than adding a monitoring migration.
- Reuses existing admin drilldowns: Audit Center, Governance Dashboard, Trust View, Queue Diagnostics, and financial audit views.
- Reuses current admin shell, metric card, state block, service, and shared contract patterns.

## Risk Analysis

- Stale health data: worker health depends on heartbeat freshness, so a stopped heartbeat can show critical while a worker is intentionally paused.
- Queue performance impact: each refresh reads BullMQ counts across monitored queues. The page should not be polled aggressively.
- Monitoring query cost: database queries use aggregate counts over indexed status and timestamp columns where available.
- False alarms: derived read-only alerts may report planned queue backlog or settlement holds.
- Duplicate alerts: the dashboard shows persisted alerts and derived read-only alerts separately with source labels.

## Monitoring Service Design

- `getOperationalMonitoring({ window, io })` returns one coherent snapshot.
- Supported windows: `1h`, `24h`, `7d`, `30d`.
- Status vocabulary: `healthy`, `warning`, `critical`.
- Alerts are split into persisted open alerts and derived read-only alerts.
- Drilldowns are links only; the monitoring endpoint has no write behavior.

## Backend Monitoring API

`GET /api/v1/admin/operations/monitoring?window=24h`

Authentication: admin-only through existing admin route middleware.

Response includes:

- System health overview.
- Queue counts and worker heartbeat state.
- Payment settlement, reconciliation, error, and webhook aggregates.
- Notification sent, failed, backlog, and realtime status.
- Socket connected client count and sync health.
- Trust waiting, processed, failure, and replay activity counts.
- Governance case, appeal, and escalation counts.
- Persisted and derived alerts.
- Drilldown navigation metadata.

## Frontend Dashboard

Route: `/admin/monitoring`

The page provides:

- Window filter controls.
- Health overview cards.
- Queue monitoring table.
- Payment, notification, socket, trust, and governance panels.
- Read-only alerts panel.
- Drilldown navigation.

## Alerting Architecture

T7.2 does not create or resolve alerts. It displays:

- Existing open rows from `operational_alerts`.
- Derived read-only alerts calculated from the current snapshot for queue backlog, worker failure, settlement cancellation, webhook failure, and trust processing failure.

## Manual Test Plan

1. Log in as an admin and open `/admin/monitoring`.
2. Verify each window filter reloads the snapshot without changing business records.
3. Confirm health cards show API, database, Redis, worker, and socket status.
4. Confirm queues list waiting, active, completed, and failed counts.
5. Confirm payment metrics show settlement, reconciliation, payment error, and webhook counts.
6. Confirm notification, socket, trust, and governance panels render even when data is empty.
7. Confirm all drilldown links navigate to existing admin tools.
8. Confirm there are no retry, cleanup, reconcile, review, or trust action controls on the monitoring page.
9. Verify the backend endpoint with `window=1h`, `window=24h`, `window=7d`, and `window=30d`.
10. Run lint, typecheck, backend architecture validation, and targeted backend syntax checks.

## T7.2.1 Worker Heartbeat Alignment

### Root Cause

The first T7.2 monitoring snapshot re-parsed `worker_heartbeats.last_seen_at` in Node.js and compared it with `Date.now()`. Because `last_seen_at` is a database timestamp and can be returned without explicit timezone context, that introduced a UTC/local parsing risk. The database query was already selecting `seconds_since_seen`, but the monitoring service was not using it.

### Fix

- Worker health now uses database-computed `EXTRACT(EPOCH FROM (NOW() - last_seen_at))` as the primary heartbeat age.
- JavaScript timestamp parsing remains only as a fallback when `seconds_since_seen` is unavailable.
- Negative age values are clamped to zero to avoid clock-skew false stale states.
- Dead-letter queues continue to use `workerRequired: false`; stale timestamps for non-required queue heartbeats do not make worker health critical.
- Queue heartbeat status now uses the same age calculation as the worker overview.

### Dead-Letter Queue Review

The dead-letter queue remains monitored for visible jobs but does not require an active worker heartbeat. Operational Monitoring may still surface dead-letter jobs as queue work requiring inspection, but it no longer treats the absence or age of a dead-letter worker heartbeat as worker failure.

### Manual Validation

1. Query `worker_heartbeats` and confirm `status`, `last_seen_at`, and `seconds_since_seen` are recent for running workers.
2. Open Bull Board and confirm the same queues show healthy/running with failed jobs and retry-exhausted counts at zero.
3. Open `/admin/monitoring` and confirm Worker Health is `Healthy`.
4. Confirm queue rows show `worker_heartbeat_status=ok` for active worker-backed queues.
5. Confirm `dead-letter-queue` shows `worker_heartbeat_status=not_required`.
6. Refresh the page after one heartbeat interval and confirm the status remains aligned.
