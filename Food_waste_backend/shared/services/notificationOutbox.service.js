const pool = require("../config/db");
const logger = require("../utils/logger");

const MAX_ATTEMPTS = 8;
const CLAIM_LEASE_SECONDS = 5 * 60;
const INITIAL_RETRY_DELAY_SECONDS = 5;
const MAX_RETRY_DELAY_SECONDS = 5 * 60;

async function enqueueNotificationOutbox(client, input = {}) {
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey) throw new Error("Notification outbox idempotency key is required");
  if (!input.userId) throw new Error("Notification outbox user id is required");
  if (!input.type || !input.title || !input.message) {
    throw new Error("Notification outbox type, title, and message are required");
  }

  const result = await client.query(
    `
    INSERT INTO notification_outbox (
      idempotency_key, user_id, notification_type, title, message,
      data, socket_event, socket_data
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
    `,
    [
      idempotencyKey,
      input.userId,
      input.type,
      input.title,
      input.message,
      JSON.stringify(input.data || {}),
      input.socketEvent || null,
      JSON.stringify(input.socketData || {}),
    ]
  );

  return result.rows[0] || null;
}

async function claimNotificationOutbox(db, limit) {
  const result = await db.query(
    `
    WITH claimable AS (
      SELECT id
      FROM notification_outbox
      WHERE attempts < $1
        AND (
          (status='pending' AND available_at <= NOW())
          OR (status='processing' AND locked_until <= NOW())
        )
      ORDER BY available_at ASC, created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_outbox AS outbox
    SET status='processing',
        attempts=outbox.attempts + 1,
        locked_until=NOW() + ($3 * INTERVAL '1 second'),
        updated_at=NOW()
    FROM claimable
    WHERE outbox.id=claimable.id
    RETURNING outbox.*
    `,
    [MAX_ATTEMPTS, limit, CLAIM_LEASE_SECONDS]
  );

  return result.rows;
}

async function publishSocketEvent(room, event, data) {
  const redis = require("../config/redis");
  await redis.publish("socket_events", JSON.stringify({ room, event, data }));
}

async function failExpiredNotificationOutboxRows(db, recordAlert) {
  const result = await db.query(
    `
    UPDATE notification_outbox
    SET status='failed', locked_until=NULL,
        last_error=COALESCE(last_error, 'Worker lease expired after maximum attempts'),
        updated_at=NOW()
    WHERE status='processing' AND locked_until <= NOW() AND attempts >= $1
    RETURNING id, idempotency_key, attempts
    `,
    [MAX_ATTEMPTS]
  );

  for (const row of result.rows) {
    logger.error("Notification outbox lease expired after maximum attempts", {
      outboxId: row.id,
      idempotencyKey: row.idempotency_key,
      attempts: row.attempts,
    });
    void recordAlert({
      alertKey: `notification_outbox:failed:${row.id}`,
      category: "notification",
      severity: "error",
      message: "Notification outbox lease expired after maximum attempts",
      metadata: { outboxId: row.id, idempotencyKey: row.idempotency_key },
    });
  }

  return result.rows.length;
}

async function processNotificationOutboxBatch(options = {}) {
  const db = options.db || pool;
  const limit = Math.max(1, Math.min(Number(options.limit || 25), 100));
  const deliverNotification =
    options.notifyUser || require("./notification.service").notifyUser;
  const publishEvent = options.publishSocketEvent || publishSocketEvent;
  const reportAlert =
    options.recordAlert || ((alert) => require("./observability.service").recordAlert(alert));
  const expiredFailed = await failExpiredNotificationOutboxRows(db, reportAlert);
  const rows = await claimNotificationOutbox(db, limit);
  const summary = { sent: 0, retried: 0, failed: expiredFailed };

  for (const row of rows) {
    try {
      await deliverNotification(
        row.user_id,
        row.notification_type,
        row.title,
        row.message,
        row.data || {},
        { idempotencyKey: row.idempotency_key }
      );

      if (row.socket_event) {
        await publishEvent(`user:${row.user_id}`, row.socket_event, row.socket_data || {});
      }

      await db.query(
        `
        UPDATE notification_outbox
        SET status='sent', sent_at=NOW(), locked_until=NULL,
            last_error=NULL, updated_at=NOW()
        WHERE id=$1 AND status='processing'
        `,
        [row.id]
      );
      summary.sent += 1;
    } catch (err) {
      const failure = await db.query(
        `
        UPDATE notification_outbox
        SET status=CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
            available_at=NOW() + LEAST(
              $3::double precision * power(2, GREATEST(attempts - 1, 0)),
              $4::double precision
            ) * INTERVAL '1 second',
            locked_until=NULL,
            last_error=LEFT($5, 1000),
            updated_at=NOW()
        WHERE id=$1 AND status='processing'
        RETURNING status, attempts
        `,
        [row.id, MAX_ATTEMPTS, INITIAL_RETRY_DELAY_SECONDS, MAX_RETRY_DELAY_SECONDS, err.message]
      );
      const failed = failure.rows[0]?.status === "failed";
      summary[failed ? "failed" : "retried"] += 1;

      if (failed) {
        logger.error("Notification outbox delivery exhausted retries", {
          outboxId: row.id,
          idempotencyKey: row.idempotency_key,
          attempts: failure.rows[0]?.attempts,
          err,
        });
        void reportAlert({
          alertKey: `notification_outbox:failed:${row.id}`,
          category: "notification",
          severity: "error",
          message: "Notification outbox delivery exhausted retries",
          metadata: { outboxId: row.id, idempotencyKey: row.idempotency_key },
        });
      } else {
        logger.warn("Notification outbox delivery will retry", {
          outboxId: row.id,
          attempts: failure.rows[0]?.attempts,
          err,
        });
      }
    }
  }

  return summary;
}

module.exports = {
  enqueueNotificationOutbox,
  processNotificationOutboxBatch,
};