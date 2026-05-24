# Food Rescue Production Readiness

## Environments

Use `APP_ENV` and `NEXT_PUBLIC_APP_ENV` as the deployment boundary:

- `local`: developer workstation resources only.
- `development`: shared non-production integration resources.
- `staging`: production-like resources with isolated credentials, webhooks, Redis prefix, and database.
- `production`: live user traffic.

Each environment must use separate `DATABASE_URL`, `REDIS_URL`, `QUEUE_PREFIX`, Cashfree credentials, Cloudinary folder prefix, webhook URLs, and frontend origins. Production Cashfree credentials are blocked outside `APP_ENV=production` unless `ALLOW_PRODUCTION_CREDENTIALS_IN_NON_PROD=true` is explicitly set for a controlled recovery drill.

## Deployment Flow

1. Populate `.env.production` from `.env.production.example`.
2. Build images with `docker compose -f docker-compose.production.yml build`.
3. Apply migrations with the `migrate` service.
4. Start `api`, `worker`, `frontend`, `redis`, `postgres`, `db-backup`, and `nginx`.
5. Confirm `/nginx-health`, `/health`, `/health/queues`, and `/health/payments`.

Production API and worker startup verify that every versioned migration has been applied. Runtime schema mutation is disabled in production.

## Reverse Proxy And HTTPS

Nginx is the production edge for frontend traffic, `/api/`, `/socket.io/`,
Cashfree webhooks, static assets, and health checks. The production compose file
keeps PostgreSQL, Redis, API, workers, and frontend on an internal Docker
network; only Nginx publishes ports `80` and `443`.

Use `PUBLIC_API_URL=https://<domain>/api/v1`,
`FRONTEND_URL=https://<domain>`, `TRUST_PROXY_HOPS=1`,
`COOKIE_SECURE=true`, and `COOKIE_SAME_SITE=none` for the standard same-origin
production deployment. Nginx overwrites forwarded IP headers at the edge so
Express logs, secure cookies, and Redis-backed rate limiting see the trusted
client address.

The full Nginx runbook, certificate layout, Cloudflare notes, route map,
websocket validation, and Cashfree webhook notes live in
[`docs/operations/nginx-production.md`](./nginx-production.md).

## Secrets

Store secrets in the deployment secret manager or `.env.production` with restricted filesystem permissions. Rotate immediately if a production secret is copied into `dev.env`, logs, chat, screenshots, or CI output.

Critical secrets:

- `JWT_SECRET`
- `DATABASE_URL`
- `REDIS_URL`
- `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_WEBHOOK_SECRET`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `CLOUDINARY_*`
- `TWILIO_*`

## Backups And Restore

`db-backup` writes custom-format PostgreSQL archives to `infra/backup/postgres`, verifies archives with `pg_restore --list`, and deletes files older than `BACKUP_RETENTION_DAYS`.

Restore drill:

1. Stop API and workers or point traffic to maintenance.
2. Create a new database.
3. Run `pg_restore --clean --if-exists --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" latest.dump`.
4. Run `npm run migrate:verify`.
5. Start API and workers.
6. Run payment reconciliation and queue health checks.

Protected data includes reservations, payments, restrictions, penalties, provider reports, webhook events, and operational audit logs.

## Redis And Queue Recovery

Redis uses RDB snapshots plus AOF `appendfsync everysec`, `aof-use-rdb-preamble yes`, `no-appendfsync-on-rewrite no`, `stop-writes-on-bgsave-error yes`, and `maxmemory-policy noeviction`. The Redis `/data` directory must be backed by a persistent Docker volume or managed Redis persistence tier. Do not run BullMQ queues on ephemeral Redis storage in staging or production.

BullMQ queues use an environment-specific prefix and persistent Redis storage, so delayed payment, refund, expiry, delivery, pickup, and reconciliation jobs survive Redis and container restarts. Critical queue jobs use capped retries with exponential backoff and retain failed jobs long enough for inspection. Retry-exhausted jobs are copied to `dead-letter-queue` with payload, source queue, attempts, and failure metadata before cleanup retention can remove the original failed job.

On worker restart:

- BullMQ reclaims stalled active jobs.
- Workers use explicit lock duration, stalled interval, and max stalled count settings.
- Idle workers write heartbeats so queue health does not report false "No heartbeat" states.
- Failed jobs remain available in failed sets for admin retry.
- Payment reconciliation sweep runs every five minutes.
- Webhook events are idempotent by event key and payload hash.
- Refund jobs use stable gateway refund IDs and stable BullMQ job IDs to avoid duplicate refunds.

Do not flush Redis in production unless PostgreSQL has been restored and reconciliation has been planned.

Required Redis deployment checks:

- `appendonly yes`
- `appendfsync everysec`
- persistent `/data` volume enabled and included in backup/snapshot policy
- `maxmemory-policy noeviction`
- no `FLUSHDB` or `FLUSHALL` access in application credentials
- container stop grace period long enough for Redis to flush and workers to close

Recommended queue runtime settings:

- `QUEUE_LOCK_DURATION_MS=120000`
- `QUEUE_STALLED_INTERVAL_MS=30000`
- `QUEUE_MAX_STALLED_COUNT=2`
- `QUEUE_SHUTDOWN_TIMEOUT_MS=30000`
- `WORKER_HEARTBEAT_INTERVAL_MS=30000`
- `WORKER_STALE_HEARTBEAT_MS=90000`
- `QUEUE_DELAYED_OVERDUE_MS=120000`
- `QUEUE_STUCK_ACTIVE_MS=900000`

## Websocket Scaling

API instances bridge realtime events through Redis pub/sub. Keep all API instances on the same `REDIS_URL` and `ENV_RESOURCE_PREFIX`. The reverse proxy must pass `Upgrade` and `Connection` headers for `/socket.io/`.

For multi-instance Socket.IO rooms across pods, add the official Redis adapter before horizontal scaling beyond one API container per Redis pub/sub bridge.

## Uploads

Uploads are memory-limited, extension-limited, MIME-limited, and magic-byte validated before Cloudinary upload. Production storage paths include `ENV_RESOURCE_PREFIX` and are CDN-ready: `food-rescue/<environment>/fssai/...`.

Cleanup policy:

- Remove rejected verification assets after moderation retention.
- Remove orphaned assets whose database owner no longer exists.
- Keep audit-relevant uploads until compliance retention expires.

## Disaster Recovery Checklist

Payment recovery:

- Replay Cashfree webhooks from gateway dashboard when possible.
- Run payment reconciliation for stale pending sessions.
- Verify refund queue health and failed refund jobs.

Reservation recovery:

- Restore PostgreSQL first.
- Keep workers stopped until migrations verify.
- Start workers and let reconciliation jobs repair payment-pending reservations.

Queue recovery:

- Preserve Redis AOF/RDB volume.
- Start Redis, then workers.
- Check `/health/queues` for stale workers, overdue delayed jobs, stalled active jobs, retry exhaustion, and dead-letter backlog.
- Retry exhausted jobs from admin queue UI only after checking idempotency and any related payment/refund state.
- Inspect `dead-letter-queue` before cleaning failed jobs.

Webhook recovery:

- Use `cashfree_webhook_events` to identify failed or duplicate events.
- Reconcile by `order_id` and reservation IDs.

Crash validation drills:

- Restart API during payment creation.
- Restart worker during reconciliation.
- Disconnect websockets and verify client reconnect.
- Restart Redis and confirm queue and socket recovery.
- Restart PostgreSQL and confirm API health degradation then recovery.
