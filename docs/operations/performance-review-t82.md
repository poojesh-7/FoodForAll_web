# T8.2 Performance Review

Date: 2026-06-09

Scope: production performance hardening for PostgreSQL, Redis, BullMQ, Socket.IO, admin dashboards, audit, compliance, governance, trust, reservations, notifications, and exports.

This review preserves the validated financial, trust, governance, compliance, and reservation lifecycle architectures. It implements only verified bottlenecks found in the code and migration set.

## Architecture Performance Analysis

The platform is structurally production-ready for launch-scale traffic when reads remain within the existing bounded dashboard limits and queue workers are deployed with Redis and BullMQ health monitoring enabled.

The strongest existing scalability choices are:

- Reservation/payment/trust hot paths already use transactional locks, partial indexes, and queue retry boundaries.
- Audit Center uses keyset pagination over a read-only union model.
- Governance, compliance, incident, and business metric dashboards cap returned list sizes.
- Socket.IO room fanout is user-scoped through Redis pub/sub rather than broad process-local broadcast.

The main growth risks are exact aggregate dashboards, audit free-text search, and user notification history. The notification history issue was remediated in T8.2.

## Database Review

Verified existing coverage:

- Reservations: user/status, listing/status, pending payment, volunteer task, and abuse-guard indexes cover common lifecycle and payment paths.
- Payments and financial ledgers: order, reservation, reconciliation, refund, idempotency, settlement, and audit timeline indexes are present.
- Trust: processing, subject history, source, reservation/payment lineage, effects, and risk projection indexes are present.
- Governance: moderation case status/source/subject, event timeline, appeal status/provider/case, and provider report indexes are present.
- Audit Center: timeline indexes exist across trust, moderation, appeal, operational, financial, notification, and payment-attempt sources.

Implemented fixes:

- `idx_notifications_user_created` supports bounded `/notifications` keyset reads.
- `idx_notifications_user_active_archive` supports compliance notification archive updates by user.
- `idx_restaurants_user_verified_lookup` supports repeated provider profile lateral lookups by `user_id`.
- `idx_ngos_user_verified_lookup` supports auth/profile/volunteer/NGO joins by `user_id`.

EXPLAIN ANALYZE candidates for production verification:

- `/api/v1/notifications?limit=30` first page and cursor page.
- Audit Center with `domains=financial,trust` and no search.
- Audit Center with `q=<term>` because free-text search still requires broad source evaluation.
- Compliance dashboard exact count snapshot.
- Business metrics dashboard for `period=30d`.
- Governance dashboard with default queue limit.

## Auth Performance Review

T8.1 session revocation validates JWT signature locally, then reads `users` by primary key to compare `auth_session_version`. This is an indexed lookup and does not need a dedicated `auth_session_version` index because the predicate is `WHERE id=$1`.

Redis caching was not added. A cache would add invalidation complexity and could delay revocation unless every session-version mutation synchronously invalidated the key. The current primary-key lookup is secure and predictable for launch scale.

## Governance Review

Governance list/detail queries are bounded and generally index-supported. Lateral lookups for restaurant display names were a verified repeated pattern and are now supported through `idx_restaurants_user_verified_lookup`.

Remaining risk: dashboard count and grouped analytics queries still scan governance source tables. This is acceptable for launch-scale admin use, but should move to materialized/read-model rollups if admin dashboards become high-frequency or tables grow beyond interactive exact-count tolerance.

## Audit Center Review

Timeline pagination is keyset-based and capped. Exports are capped at 5,000 rows and sanitize sensitive metadata.

Remaining risk: free-text search is implemented as `LIKE '%term%'` over computed source text. Existing B-tree timeline indexes help date/cursor ordering, not substring search. Do not rely on global Audit Center search for high-volume forensic discovery without adding a persisted search vector or source-specific search indexes.

## Compliance Review

Compliance workflow preserves financial, trust, audit, moderation, and incident integrity. Deletion request lists are bounded and indexed by status/subject/target user. Compliance events have request, target, and timeline indexes.

Remaining risk: dashboard retention summaries use exact `COUNT(*)` over large protected tables. That is semantically correct but can become expensive. The next non-invasive step is a materialized compliance retention summary refreshed on a schedule, not approximate live counts in the compliance workflow.

## Notification Review

Verified bottleneck: `/api/v1/notifications` returned all notifications for a user and the frontend rendered the entire list. This was remediated with bounded keyset pagination, exposed pagination headers, frontend append-on-demand loading, and supporting indexes.

Unread counts and mark-all-read remain supported by the existing `(user_id, is_read, created_at DESC)` index.

## Socket.IO Review

The API server authenticates sockets using the same T8.1 session-version check and joins `user:<id>` rooms only. Unauthorized room joins are rejected and disconnect the socket. Worker-to-socket fanout goes through Redis `socket_events` and emits to a specific room when present.

Remaining risk: there is no Socket.IO Redis adapter for horizontal multi-node socket membership. The current Redis pub/sub bridge is enough for event delivery to each API process, but multi-node room state and presence should be formalized before high concurrency.

## Redis Review

Redis usage is bounded around OTP/rate limiting, BullMQ, location geosearch, and socket event pub/sub. No unbounded cache was added in T8.2.

Risk to monitor: OTP/rate-limit keys must retain TTL discipline, and `ngo_locations` should be refreshed rather than allowed to accumulate stale NGO location members.

## BullMQ Review

Queues are centrally registered and monitored. Queue health checks inspect active/waiting/delayed/failed/completed counts, stalled/overdue samples, retry exhaustion, worker heartbeat state, and dead-letter visibility.

No cleanup was performed, per T8.2 scope. Queue cleanup and retention belong to T8.3 Reliability Review.

## Frontend Review

Admin pages generally fetch bounded dashboard payloads and avoid uncontrolled polling. Audit Center already supports "load more" cursor pagination. The notification page now follows the same pattern instead of loading full history at once.

Remaining risk: business metrics, compliance, governance, monitoring, and incident dashboards can each trigger multiple heavy admin queries on page load. This is acceptable for low-frequency admin use, but production dashboards should avoid auto-refresh without backoff.

## Export Review

Audit and business metric exports are in-memory downloads with explicit caps and sanitized payloads. This is acceptable for current capped exports.

Future large exports should stream rows or write async export jobs to object storage. Do not raise export caps without changing the generation model.

## Risk Matrix

| Severity | Subsystem | Root cause | Production impact | Remediation |
| --- | --- | --- | --- | --- |
| High | Notifications | Unbounded per-user history query and client render | Large users experience slow responses and heavy browser rendering | Implemented keyset pagination, frontend load-more, and supporting indexes |
| High | Audit Center search | Substring search over computed union text | Large audit searches can scan many source tables | Keep launch cap; plan persisted search/read model |
| Medium | Compliance dashboard | Exact counts over protected large tables | Admin dashboard latency grows with table size | Plan materialized retention summary |
| Medium | Business metrics | Multiple exact aggregate scans | Admin dashboard latency grows with reservations/listings | Plan scheduled metrics snapshots |
| Medium | Socket.IO horizontal scale | Pub/sub bridge without Socket.IO Redis adapter | Presence and room semantics are process-local | Add adapter/presence model before multi-node scale |
| Low | Auth session validation | Per-request primary-key lookup | Small DB read per authenticated request | Keep as-is; Redis cache not added to avoid revocation risk |
| Low | BullMQ dashboard | Queue health samples failed/active/delayed jobs | Admin route can be moderately expensive | Keep bounded samples; T8.3 handles cleanup/retention |

## Optimization Plan

Completed in T8.2:

- Add performance migration `027_performance_hardening_t82`.
- Bound `/notifications` with keyset pagination.
- Expose notification pagination headers through CORS.
- Update frontend notification page to append on demand.
- Add backend pagination regression tests.

Recommended for T8.3+:

- Add a materialized compliance retention summary for protected table counts.
- Add scheduled business metrics snapshots for dashboard/export reuse.
- Add persisted Audit Center search vectors or a dedicated audit search read model.
- Add Socket.IO Redis adapter and explicit presence TTLs for multi-node realtime scale.
- Keep queue cleanup and retention in T8.3 Reliability Review, not T8.2.

Production launch decision: ready to proceed to T8.3 Reliability Review after the T8.2 migration is applied and the notification paging regression tests pass.
