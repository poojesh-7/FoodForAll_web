const assert = require("node:assert/strict");
const test = require("node:test");

const webPushService = require("../shared/services/webPush.service");

test("web-push payload validation rejects invalid browser subscription payloads", () => {
  assert.equal(
    webPushService.isSubscriptionPayloadValid({
      endpoint: "not-a-url",
      keys: { p256dh: "", auth: "abc" },
    }),
    false
  );

  assert.equal(
    webPushService.isSubscriptionPayloadValid({
      endpoint: "https://example.com/push",
      keys: { p256dh: "p256dh-demo", auth: "auth-demo" },
    }),
    true
  );
});

test("web-push subscription normalization preserves stable shape for storage", () => {
  const normalized = webPushService.normalizeSubscriptionPayload({
    subscription: {
      endpoint: "https://example.com/push",
      keys: { p256dh: "p256dh-demo", auth: "auth-demo" },
    },
    userAgent: "Mozilla/5.0",
  });

  assert.equal(normalized.endpoint, "https://example.com/push");
  assert.equal(normalized.p256dh, "p256dh-demo");
  assert.equal(normalized.auth, "auth-demo");
  assert.equal(normalized.userAgent, "Mozilla/5.0");
});
