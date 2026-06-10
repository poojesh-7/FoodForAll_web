# T8.4 Production Readiness Review

Date: 2026-06-10

Scope: final operational readiness review before launch certification. This review does not redesign the validated financial, trust, governance, compliance, incident, notification, reliability, or performance architecture.

## 1. Production Readiness Assessment

Decision: No-Go for live production traffic today. Go for T8.5 Launch Certification after the remaining operational items below are completed and evidenced.

The platform architecture is close to production ready. Core launch controls are present: strict backend environment validation, production Docker Compose, transactional migrations, migration verification before API and worker startup, Redis persistence settings, queue retries/dead letters, operational dashboards, health endpoints, audit/compliance/incident centers, UTC transport, and IST frontend rendering.

Implemented during T8.4:

- Replaced the worker image's always-green healthcheck with `scripts/worker-healthcheck.js`.
- Added `shared/utils/workerHealthcheck.js` and unit coverage for missing, stale, and unhealthy worker heartbeats.
- Added `npm run admin:bootstrap` for controlled first-admin promotion of an existing OTP-created user.

Open launch blockers:

- Rotate every credential currently present in ignored local env files before any production launch.
- Build a real production env from `.env.production.example`, not from local ignored env files, and pass backend/frontend env validation with production values.
- Complete a staging deployment drill covering migrations, API, worker health, frontend health, Cashfree webhook verification, queue health, backup creation, and restore verification.
- Configure external alert delivery for critical health/queue/payment/trust/compliance conditions.
- Configure off-host PostgreSQL backup retention and perform a restore drill.

## 2. Infrastructure Review

Present:

- `docker-compose.production.yml` defines PostgreSQL/PostGIS, Redis, migration, API, worker, frontend, Nginx, and database backup services.
- API and worker depend on migration completion and run `npm run migrate:verify` before serving traffic or processing queues.
- Nginx is the only public edge, exposes `80/443`, proxies API, frontend, health, metrics, webhook, Bull Board, and Socket.IO paths, and sets production security headers.
- Redis production config enables AOF, RDB snapshots, no eviction, and persistent `/data`.
- API and frontend Dockerfiles have real HTTP healthchecks.
- Worker Dockerfile now checks BullMQ Redis plus required worker heartbeats.

Gaps:

- Production host, DNS, certificate issuance, Cloudflare mode, and persistent volume locations must be confirmed outside the repo.
- External monitoring and alert delivery are documented but not connected in code/config.

## 3. Environment Review

Backend validation:

- `shared/config/env.js` requires launch-critical PostgreSQL, Redis, JWT, frontend origin, Twilio Verify, Cashfree, and Cloudinary variables.
- Production additionally requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CASHFREE_WEBHOOK_SECRET`, `METRICS_TOKEN`, HTTPS frontend URL, explicit HTTPS CORS origins, `NODE_ENV=production`, and `ENV_RESOURCE_PREFIX`.
- Production Cashfree credentials are blocked outside `APP_ENV=production` unless explicitly overridden.
- Socket.IO and BullMQ runtime settings have bounded defaults and production template values.

Frontend validation:

- `food-waste-frontend/scripts/validate-env.js` validates `NEXT_PUBLIC_APP_ENV` and `NEXT_PUBLIC_API_URL`, including HTTPS in production.
- `NEXT_PUBLIC_CASHFREE_MODE` is public by design and is set by the production Docker build args.

Findings:

- Ignored local files `.env.production`, `Food_waste_backend/dev.env`, and `food-waste-frontend/.env.local` contain real-looking credentials. They are ignored and not shown in `git status`, but all exposed values must be rotated before launch.
- The ignored local `.env.production` appears to contain sandbox Cashfree mode and placeholder webhook secret values. It must not be used for production.
- `CASHFREE_WEBHOOK_SECRET` is required by production validation, while webhook signature verification currently uses `CASHFREE_SECRET_KEY`. Verify this against the Cashfree dashboard and webhook signature documentation during launch certification before changing behavior.

## 4. Secrets Review

Present:

- Env files are excluded by top-level and app `.gitignore`.
- Backend and frontend `.dockerignore` exclude env files and local uploads.
- The frontend only references `NEXT_PUBLIC_*` values.
- Structured logging passes metadata through a central redactor for token, secret, password, cookie, authorization, OTP, signature, payment session, payment details, card, UPI, bank, and payload-like keys.
- Refresh tokens are random opaque tokens, hashed before storage, rotated on refresh, and cleared on logout.

Gaps:

- Local credential exposure requires rotation, even though the files are ignored.
- Production secret storage and access control must be implemented in the deployment environment or secret manager.

## 5. Deployment Readiness

Safe production sequence:

1. Rotate credentials and create the real `.env.production` from `.env.production.example`.
2. Set `APP_ENV=production`, `NODE_ENV=production`, production Cashfree credentials, HTTPS frontend origins, production Cloudinary credentials, production Twilio Verify credentials, Redis/PostgreSQL URLs, `METRICS_TOKEN`, and a unique `ENV_RESOURCE_PREFIX`.
3. Run backend `npm run env:validate`, frontend `npm run env:validate`, backend `npm run migrate:lint`, backend tests, frontend lint/typecheck/build.
4. Build images with `docker compose -f docker-compose.production.yml build`.
5. Start PostgreSQL and Redis with persistent volumes.
6. Run the `migrate` service.
7. Start API, then worker, then frontend, then Nginx.
8. Confirm `/nginx-health`, `/health`, `/health/queues`, `/health/payments`, `/metrics` with token, `/admin/monitoring`, `/admin/queues`, and Cashfree webhook delivery.
9. Create the first admin: have the target user complete OTP login/profile, then run `npm run admin:bootstrap` with `BOOTSTRAP_ADMIN_PHONE` and `BOOTSTRAP_ADMIN_CONFIRM=promote-admin`. Remove those env vars after success.
10. Run smoke tests for OTP, listing creation, reservation, payment order creation, webhook success/failure, queue processing, notification persistence, and admin dashboards.

Rollback:

- Prefer image rollback for application regressions.
- Do not run down migrations in production without a restore plan. Current up migrations are additive, but down migrations are destructive by definition.
- If a migration corrupts data, stop API/workers, restore PostgreSQL from a verified backup into a new database, run `migrate:verify`, then restart API/workers.

## 6. Database Readiness

Present:

- Migration inventory includes 28 ordered up/down pairs from `001_production_hardening` through `028_reliability_hardening_t83`.
- Up migrations are additive: new tables, columns, indexes, constraints, and triggers. No up migration performs `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or bulk destructive cleanup.
- Financial, trust, audit, compliance, incident, moderation, notification, and queue-observability tables are indexed for launch-scale dashboards.
- Production API and worker startup call migration verification.

Gaps:

- A production bootstrap run against an empty database must still be performed and recorded.
- Backup restore must be tested before live traffic.

Production bootstrap:

1. Create empty PostgreSQL database.
2. Apply all migrations.
3. Verify migrations.
4. Create first user through normal OTP flow.
5. Run `npm run admin:bootstrap` once.
6. Confirm admin access to monitoring, queues, audit center, compliance, incidents, trust, and governance.

## 7. Monitoring Review

Operators can detect:

- API, database, Redis, websocket, worker, open alert, and metrics status through `/health`.
- Queue counts, stale/missing workers, failed/retry-exhausted jobs, stuck active jobs, overdue delayed jobs, and dead-letter visibility through `/health/queues` and `/admin/queues`.
- Payment stale sessions, webhook failures, reconciliation mismatches, stuck order attempts, and refund issues through `/health/payments` and admin financial diagnostics.
- Trust waiting/retry/processing/failed states through trust admin views and operational monitoring.
- Moderation backlog through governance dashboard/intelligence and moderation case/appeal status aggregates.
- Compliance workflow state through the compliance dashboard and audit center.
- Incidents and postmortems through the Incident Center.

Gaps:

- External alert routing is not configured in this repository.
- Socket disconnect/error counts and per-notification push delivery outcomes are not persisted.

## 8. Alerting Readiness

Present:

- Operational alerts are persisted for Redis connection failures, queue worker errors, stalled jobs, retry exhaustion, queue degradation, dead-letter visibility, webhook/payment failures, and related operational events.
- Operational Monitoring derives read-only alerts for queue backlog/failures, worker failure, settlement cancellation, webhook failure, and trust processing failure.
- Metrics endpoints expose Prometheus-compatible output gated by `METRICS_TOKEN` in production.

Missing before launch:

- External pager/email/Slack routing for critical alerts.
- Alert rules for queue failures, worker stale, payment webhook failures, trust processing failures, moderation backlog, compliance failures, Redis down, Postgres down, backup failure, and restore verification failure.

## 9. Backup Review

Present:

- `db-backup` runs `pg_dump` custom-format backups, verifies with `pg_restore --list`, maintains `latest.dump`, and enforces `BACKUP_RETENTION_DAYS`.
- Restore steps are documented in `docs/operations/production-readiness.md`.
- Redis persistence is configured through AOF/RDB and persistent Docker volume.

Gaps:

- PostgreSQL backups currently land under `infra/backup` in the deployment volume. Off-host/object-storage replication is not represented.
- No restore drill evidence is present.
- Cloudinary assets are preserved by URL and compliance archive records, but there is no separate Cloudinary export/cold-storage backup policy in repo.
- Redis backup/snapshot retention depends on deployment platform volume policy.

## 10. Queue Review

T8.3/T8.3.1 findings included:

- Monitored queues: expiry, expiry alert, pickup, delivery, notification, payment, refund, trust, operational cleanup, and dead-letter.
- Workers register heartbeats and events, use bounded retries/backoff, classify delayed jobs, copy retry-exhausted failures to dead letter, and shut down gracefully.
- Delayed jobs are classified as valid, retry pending, stale, or cleanup candidate.
- Notification writes are idempotent through `notifications.idempotency_key`.

T8.4 change:

- Worker container health now fails if BullMQ Redis is unreachable or if any required worker heartbeat is missing, stale, or in an unhealthy status.

Remaining operational requirement:

- Run a staging worker crash/restart drill and confirm `/health/queues`, `/admin/queues`, Docker health, and dead-letter behavior.

## 11. Timezone Readiness

Confirmed:

- Database/API paths continue to store and transport UTC timestamps.
- Frontend display paths use `food-waste-frontend/lib/dateTime.ts` with `Asia/Kolkata` and `en-IN`.
- Food, reservation, rating, notification, dashboard, NGO, provider, and governance/admin display helpers route date rendering through shared formatters.

Status: ready.

## 12. Cloudinary Review

Present:

- Uploads are memory-limited and filtered by MIME/extension.
- Cloudinary upload buffers are magic-byte validated for JPEG, PNG, and WEBP before signed server-side upload.
- Verification and moderation evidence store Cloudinary URLs in database records and are included in compliance archive inventory.
- Storage paths include environment/resource prefix usage in upload callers.

Risk classification:

- Current public URL model: acceptable launch risk if evidence is not classified as confidential beyond authenticated app access.
- Signed URL/private delivery migration: post-launch hardening unless legal/privacy requirements demand private evidence access at launch.
- Cloudinary independent backup/export: medium production readiness gap for disaster recovery, not a code blocker.

## 13. Production Data Plan

Seed requirements:

- No synthetic users, NGOs, providers, volunteers, listings, reservations, payments, trust events, moderation cases, incidents, compliance requests, notifications, or queues should be carried into production.
- Retention policies are inserted by migration `025_data_retention_compliance_t75`.

Admin bootstrap:

- Create the target operator through normal OTP/profile flow.
- Run `npm run admin:bootstrap` with `BOOTSTRAP_ADMIN_PHONE` or `BOOTSTRAP_ADMIN_USER_ID` and `BOOTSTRAP_ADMIN_CONFIRM=promote-admin`.
- Remove bootstrap env vars immediately after success.
- Confirm one admin exists and can access all admin dashboards.

Pre-launch cleanup:

- Wipe: development users, NGOs, providers, volunteers, food listings, reservations, payments, trust events/effects/scores/restrictions, provider reports, moderation cases/appeals, incidents, compliance requests/events, notifications, queue jobs, dead-letter jobs, worker heartbeats, and operational alerts/events from any database that ever held test data.
- Preserve: schema migrations, retention policy rows, empty schema objects, production secrets outside git, and deployment audit records created during the actual production bootstrap.
- Do not wipe a database after real users or real payments exist; switch to compliance workflows and audited admin actions.

## 14. Operational Runbook Review

Existing surfaces:

- Payment diagnostics, queue diagnostics, audit center, incident center, compliance dashboard, governance dashboard/intelligence, operational monitoring, and production readiness docs.

Needed before launch:

- Payment incident runbook: webhook replay, reconciliation, refund handling, Cashfree dashboard checks, customer/provider communication.
- Trust incident runbook: failed trust events, replay/rebuild checks, admin recovery credit policy, escalation thresholds.
- Queue incident runbook: stale worker, Redis outage, retry-exhausted job, dead-letter inspection, safe retry rules.
- Compliance incident runbook: deletion request execution failure, evidence archival issue, legal hold, export/access request escalation.
- Moderation incident runbook: backlog triage, escalation ownership, appeal SLA, evidence handling.

## 15. Risk Matrix

| Severity | Subsystem | Finding | Impact | Likelihood | Remediation |
| --- | --- | --- | --- | --- | --- |
| Critical | Secrets | Real-looking credentials exist in ignored local env files | Launch with leaked/reused credentials can compromise database, Twilio, Cashfree, Supabase, Cloudinary | High | Rotate all exposed values and rebuild production env from template |
| High | Alerting | External alert delivery is not configured | Operators may miss critical failures outside dashboards | Medium | Configure Prometheus/alert routing for health, queues, payments, trust, compliance, backups |
| High | Backup | Off-host backup and restore drill evidence are missing | Host loss or bad migration may not be recoverable within launch expectations | Medium | Replicate backups off-host and complete restore drill |
| High | Configuration | Actual production env has not been validated with production credentials | Startup or payment/webhook failures at launch | Medium | Run env validation and staging smoke with final env |
| Medium | Admin bootstrap | No first-admin path existed before T8.4 | Admin dashboards could be inaccessible on a clean production DB | Medium | Fixed with `npm run admin:bootstrap`; execute once and remove env vars |
| Medium | Worker health | Worker container previously always reported healthy | Container orchestration could miss worker failure | Medium | Fixed with heartbeat/Redis worker healthcheck |
| Medium | Runbooks | Incident-specific operator runbooks are not dedicated documents | Slower recovery during launch incidents | Medium | Create and rehearse payment, trust, queue, compliance, moderation runbooks |
| Medium | Cloudinary | Evidence URLs are public Cloudinary URLs and lack independent backup/export | Evidence privacy/DR risk | Low-Medium | Classify as acceptable launch risk or migrate to signed/private delivery before launch if required |
| Medium | Cashfree | `CASHFREE_WEBHOOK_SECRET` env requirement differs from verifier using `CASHFREE_SECRET_KEY` | Misconfigured webhook verification if dashboard expectation differs | Medium | Verify against Cashfree dashboard/spec in T8.5 before go-live |
| Low | Monitoring | Socket disconnect/error counts and push delivery outcomes are not persisted | Some diagnostics rely on logs/queue failures instead of per-event history | Medium | Post-launch observability enhancement |
| Informational | Database | Up migrations are additive and paired with down files | Migration chain is launch-ready after staging apply/verify | Low | Keep using migrate service and verification gate |

## 16. Go / No-Go Recommendation

Recommendation: No-Go for live traffic until launch blockers are complete. Ready to proceed to T8.5 Launch Certification & Go-Live Checklist as the next phase.

Exact remaining work before launch:

1. Rotate all credentials found in ignored local env files.
2. Build and validate final production env values.
3. Apply and verify migrations in staging with production-like data volume.
4. Run staging smoke tests for API, frontend, worker, queues, payments, webhooks, notifications, and admin dashboards.
5. Configure external alert delivery and confirm test alerts.
6. Configure off-host PostgreSQL backups and run restore drill.
7. Confirm Cloudinary evidence privacy classification.
8. Bootstrap first admin using the new script and remove bootstrap env.
9. Create/rehearse incident runbooks.
10. Capture final go-live evidence in T8.5.
