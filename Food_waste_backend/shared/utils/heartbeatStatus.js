function heartbeatAgeMs(heartbeat, now = Date.now()) {
  if (!heartbeat) return null;

  if (
    heartbeat.seconds_since_seen !== undefined &&
    heartbeat.seconds_since_seen !== null
  ) {
    const secondsSinceSeen = Number(heartbeat.seconds_since_seen);
    if (Number.isFinite(secondsSinceSeen)) {
      return Math.max(0, secondsSinceSeen * 1000);
    }
  }

  const lastSeenAt = new Date(heartbeat.last_seen_at).getTime();
  if (!Number.isFinite(lastSeenAt)) return null;
  return Math.max(0, now - lastSeenAt);
}

function heartbeatStatus(heartbeat, staleHeartbeatMs, now = Date.now()) {
  if (!heartbeat) return "missing";

  const ageMs = heartbeatAgeMs(heartbeat, now);
  if (ageMs === null) return "invalid";

  return ageMs > staleHeartbeatMs ? "stale" : "ok";
}

module.exports = {
  heartbeatAgeMs,
  heartbeatStatus,
};
