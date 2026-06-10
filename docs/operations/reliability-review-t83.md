# T8.3 Reliability Review

Date: 2026-06-10

Scope: production reliability and failure recovery hardening for workers, BullMQ queues, delayed/dead-letter jobs, notifications, trust replay, financial recovery, incidents, compliance, and platform timezone rendering.

This review preserves the validated financial, trust, governance, compliance, reservation lifecycle, and settlement architectures. Implemented changes are limited to verified reliability weaknesses and approved timezone normalization.

## 1. Architecture Reliability Analysis

The platform has a strong reliability foundation:

- BullMQ producers and workers use shared queue options, retry/backoff policies, worker heartbeats, stalled-job reporting, and graceful shutdown.
- Mutating workers generally lock the affected reservation/payment/trust subject, check the expected state, and skip replayed jobs after the terminal state has already changed.
- Trust processing is event-sourced through `trust_events` and `trust_event_effects`; duplicate effects are skipped before projection mutation.
- Financial workflows use ledger, settlement, webhook, refund, and terminal-record idempotency keys.
- Compliance and incident workflows write immutable event trails and avoid destructive changes to protected replay domains.

Verified reliability weaknesses fixed in T8.3:

- Notification worker retries could duplicate persisted notification rows after Redis/push failure. Fixed by adding `notifications.idempotency_key` and writing notification rows idempotently per queue job.
- Delayed jobs were counted and sampled but not classified as valid, retry pending, stale, or cleanup candidates. Fixed by adding delayed-job classification to queue health and admin diagnostics.
- Time rendering was inconsistent because shared governance/food helpers used browser locale. Fixed by introducing `food-waste-frontend/lib/dateTime.ts` and routing admin, notification, food, review, dashboard, and NGO display helpers through IST formatting.

## 2. Queue Review

Queue registration is centralized through `registerQueue`, and monitored queues include:

- `expiry-queue`
- `expiry-alert-queue`
- `pickup-queue`
- `delivery-queue`
- `notification-queue`
- `payment-queue`
- `refund-queue`
- `trust-queue`
- `operational-cleanup-queue`
- `dead-letter-queue`

Workers register through `registerWorkerEvents`, emit heartbeats, record active/completed/failed/stalled states, and copy retry-exhausted jobs to `dead-letter-queue`.

Retry policies:

- Default jobs: 3 attempts, exponential backoff.
- Critical jobs: 5 attempts, longer failed retention.
- Notification jobs: 3 attempts, shorter completed retention.
- Operational jobs: 3 attempts.
- Dead-letter jobs: 1 attempt and long retention.

Queue health already reports failed, active, delayed, stalled, overdue delayed, retry-exhausted, worker heartbeat, and dead-letter visibility. T8.3 adds per-delayed-job classification fields.

## 3. Delayed Job Analysis

Expected delayed jobs from code review:

| Queue | Job | Classification when future due time exists | Purpose |
| --- | --- | --- | --- |
| `expiry-queue` | `expire-food` | valid | Listing expiry at pickup end time |
| `expiry-alert-queue` | `expiry-alert` | valid | Rescue alert before free listing expiry |
| `pickup-queue` | `pickup-timeout` | valid | NGO volunteer pickup timeout guard |
| `delivery-queue` | `delivery-timeout` | valid | NGO volunteer delivery timeout guard |
| `payment-queue` | `payment-timeout` | valid | Payment hold timeout guard |
| `payment-queue` | `payment-reconciliation-sweep` | valid | Repeat payment recovery sweep |
| `refund-queue` | `refund-reconciliation-sweep` | valid | Repeat refund recovery sweep |
| `trust-queue` | `process-trust-events` | valid | Repeat trust projection sweep or targeted trust event |
| `trust-queue` | `derive-lifecycle-trust-events` | valid | Repeat lifecycle trust event derivation |
| `operational-cleanup-queue` | `operational-retention-cleanup` | valid | Repeat retention cleanup sweep |

Classification rules now implemented:

- `valid`: expected future delayed job or repeatable future job.
- `retry_pending`: BullMQ retry backoff is waiting for the next attempt.
- `stale`: due time has passed beyond `QUEUE_DELAYED_OVERDUE_MS`.
- `cleanup_candidate`: due time has passed beyond `QUEUE_DELAYED_CLEANUP_CANDIDATE_MS`.

No live Redis queue snapshot was available in this code review, so no production delayed jobs were purged or mutated. Operators should use `/admin/queues` or `/health/queues` to inspect the live classified list.

## 4. Dead Letter Analysis

Dead-letter behavior:

- Retry-exhausted worker failures are copied to `dead-letter-queue`.
- Dead-letter payload includes source queue, job id/name, data, options, attempts, failed reason, stacktrace, failed timestamp, and classification.
- Financial queues are classified with retry-safe reconciliation paths:
  - `refund-queue`: `refund-reconciliation-sweep`
  - `payment-queue`: `payment-reconciliation-sweep`
- Operational queues default to not retry-safe without manual inspection.
- Queue cleanup skips the dead-letter queue.

No blind purge was implemented. Dead-letter jobs remain auditable and visible through queue health and Bull Board.

## 5. Worker Recovery Review

Verified worker recovery controls:

- `workerOptions` sets lock duration, stalled interval, max stalled count, drain delay, and retry delay.
- Worker startup validates production migrations before loading workers.
- Worker shutdown pauses workers, closes workers/queues, closes Redis, and drains the PostgreSQL pool.
- `withWorkerBoundary` wraps every job with context, heartbeat updates, operational event capture, and retry-exhaustion alerting.
- BullMQ stalled jobs are logged and alerted so BullMQ can recover them.

Replay safety pattern:

- Reservation timeout workers lock and verify the reservation is still in the expected state before mutation.
- Expiry worker updates only active/completed listings and reserved pending/self-pickup reservations.
- Payment/refund workers delegate recovery to reconciliation/idempotent financial services.
- Trust worker claims events with `FOR UPDATE SKIP LOCKED` and records effects once.

## 6. Trust Replay Review

Trust replay remains valid:

- `trust_events.event_key` prevents duplicate ingestion.
- `trust_event_effects` prevents duplicate projection effects.
- Trust subject projection is guarded by advisory locks.
- `processTrustEventBatch` retries transaction conflicts and marks individual events retry/failed without corrupting projections.
- `rebuildTrustProjectionForSubject` rebuilds from processed history without changing trust formulas.

Risk level: Low. Remaining operational risk is failed trust events reaching retry limit; these are already visible through trust processing stats and queue health.

## 7. Financial Recovery Review

Financial recovery remains valid:

- Payment webhooks use Redis and database idempotency by idempotency key/payload hash.
- Payment order attempts track gateway-created, DB-inserted, committed, failed, abandoned, and recovered states.
- Payment reconciliation sweeps stale sessions and recoverable order attempts.
- Refund jobs use stable job IDs and gateway refund identifiers.
- Ledger, settlement, provider settlement, and refund terminal records use idempotency keys.
- Financial formulas were not modified.

Risk level: Low to Medium. Gateway uncertainty still requires reconciliation rather than blind retry, which is the correct recovery behavior.

## 8. Notification Resilience Review

Before T8.3, a notification job could:

1. Insert a notification row.
2. Fail during Redis publish or push delivery.
3. Retry the BullMQ job.
4. Insert a duplicate notification row.

T8.3 fix:

- Added `notifications.idempotency_key`.
- Added a partial unique index on non-null idempotency keys.
- Notification worker supplies a stable queue-job idempotency key using queue name, BullMQ job id, and BullMQ timestamp.
- `notifyUser` inserts with `ON CONFLICT` and returns the original persisted row on retry.

Offline resilience:

- Notification rows are persisted before realtime/push delivery.
- Offline users can load stored notifications later through paginated `/notifications`.
- Websocket outages do not lose the persisted notification.

Residual risk: There is still no dedicated notification delivery-attempt table. Push delivery outcome remains represented by queue observability and notification persistence.

## 9. Compliance Resilience Review

Compliance execution is conservative and replay-safe:

- Deletion requests are workflow records with explicit review/approval/execution states.
- Execution uses transactions from admin controllers.
- Account deletion/anonymization preserves user ids and protected financial/trust/audit references.
- Evidence and notification cleanup archive records instead of silent deletion.
- Compliance events provide immutable workflow history.

Risk level: Low. The main residual risk is operational: interrupted archival jobs must be retried from the workflow or cleanup worker, not repaired by manual DB edits.

## 10. Timezone Normalization Plan

Rules applied:

- Store UTC in database.
- Transmit UTC through APIs.
- Render IST in UI.
- Use one shared formatter for display paths.

Implemented:

- Added `food-waste-frontend/lib/dateTime.ts`.
- Governance/admin pages now render through `formatGovernanceDate`, which uses the shared IST formatter.
- Food/reservation display helper `formatFoodDate` now renders IST.
- Notification list, rating review dates, dashboard restriction dates, provider listing review dates, and NGO incoming request pickup dates now use shared IST formatting.

Intentionally unchanged:

- Date arithmetic and validation still use `Date` math.
- API payload creation still uses `toISOString()` to transmit UTC.
- Numeric `toLocaleString()` calls in metrics/compliance pages remain numeric formatting, not date rendering.

## 11. Failure Recovery Test Matrix

| Scenario | Expected behavior | Actual behavior from code review | Risk |
| --- | --- | --- | --- |
| Worker crash | BullMQ marks active job stalled and retries within max stalled count | Worker options and stalled event handling are present | Low |
| Worker restart | Workers resume queues after migration check | `services/workers/index.js` validates migrations and loads all workers | Low |
| Redis restart | Durable Redis should recover BullMQ state | Production docs require Redis AOF/RDB persistence and no eviction | Medium if Redis is ephemeral |
| Socket disconnect | Client reconnects; persisted notifications remain fetchable | Notifications persist before realtime delivery | Low |
| Notification outage | Queue retries delivery without duplicate DB rows | T8.3 idempotency fixes duplicate persisted rows | Low |
| Trust replay | Rebuild projections from event/effect history | `rebuildTrustProjectionForSubject` and effect idempotency present | Low |
| Compliance retry | Workflow can retry archival/anonymization without deleting protected records | Archive/anonymization updates are state-guarded and transactional | Low |
| Incident creation retry | Duplicate active source incidents are blocked by advisory lock/source lookup | Source identity lock and active source check present | Low |
| Moderation retry | Governance notifications and case events remain append-only/state checked | Existing governance code not redesigned in T8.3 | Medium |
| Appeal retry | Appeal transitions are persisted as events and state changes | Existing appeal workflow not redesigned in T8.3 | Medium |

## 12. Reliability Risk Matrix

| Severity | Subsystem | Root cause | Impact | Recovery behavior | Remediation |
| --- | --- | --- | --- | --- | --- |
| High | Notifications | Persist-then-deliver retry duplicated notification rows | Users could see duplicate notifications after Redis/push failures | BullMQ retried the job but DB insert was not idempotent | Fixed with notification idempotency key and migration 028 |
| Medium | Delayed queues | Delayed samples lacked explicit classification | Operators could not distinguish expected delayed jobs from stale/orphaned jobs | Queue health exposed counts/samples only | Fixed with delayed-job classifier and UI panel |
| Medium | Timezone rendering | Browser-locale/ad hoc date formatting | Admin and user pages rendered inconsistent local times | API UTC remained valid; display layer inconsistent | Fixed shared IST formatter and routed display helpers through it |
| Medium | Redis recovery | Queue survival depends on Redis persistence | Redis data loss can orphan BullMQ jobs | Payment/trust/reconciliation sweeps mitigate some state loss | Keep AOF/RDB/noeviction and persistent volume mandatory |
| Low | Dead letters | Manual inspection required | Retry-exhausted jobs can accumulate | Dead-letter queue preserves payload/audit context | Keep no-purge policy; inspect/retry via admin |
| Low | Notification delivery attempts | No dedicated delivery-attempt table | Push-specific outcomes are not auditable per notification | Queue observability captures worker failures | Future enhancement: optional delivery-attempt ledger |

## Remediation Plan

Completed in T8.3:

- Add migration `028_reliability_hardening_t83`.
- Add notification idempotency for retry-safe persistence.
- Add delayed-job classification utility and queue health fields.
- Add delayed-job diagnostics to `/admin/queues`.
- Add platform IST date/time utility and route date display helpers through it.
- Add focused tests for notification idempotency and delayed-job classification.

Recommended before T8.4:

- Apply migrations through `npm run migrate`.
- Verify `/health/queues` and `/admin/queues` against a live Redis queue snapshot.
- Inspect any `cleanup_candidate`, `stale`, retry-exhausted, or dead-letter jobs before manual action.
- Run a controlled worker crash/restart drill in staging.
- Run a Redis restart drill only against persistent Redis storage.
- Rebuild a sample trust subject projection from event history and compare before/after score rows.
- Trigger a notification worker retry in staging and confirm only one notification row is persisted.

Decision: after migration, tests, and staging recovery drills pass, the platform is ready to proceed to T8.4 Production Readiness.
