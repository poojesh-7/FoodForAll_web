const assert = require("node:assert/strict");
const test = require("node:test");

const {
  notifyAdminsProviderResponseSubmitted,
  notifyProviderModerationStatus,
} = require("../shared/services/moderationNotification.service");

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";
const RESPONSE_ID = "55555555-5555-4555-8555-555555555555";

function createQueueStub() {
  const jobs = [];
  return {
    jobs,
    async add(name, data) {
      jobs.push({ name, data });
      return { id: `job-${jobs.length}` };
    },
  };
}

function createPublishStub() {
  const events = [];
  return {
    events,
    async publish(room, event, data) {
      events.push({ room, event, data });
    },
  };
}

test("AWAITING_RESPONSE notifies only the provider case owner", async () => {
  const queue = createQueueStub();
  const realtime = createPublishStub();

  await notifyProviderModerationStatus({
    providerId: PROVIDER_ID,
    caseId: CASE_ID,
    status: "AWAITING_RESPONSE",
    queue,
    publish: realtime.publish,
  });

  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].data.userId, PROVIDER_ID);
  assert.equal(queue.jobs[0].data.type, "moderation_case_awaiting_response");
  assert.equal(
    queue.jobs[0].data.message,
    "Moderation case requires your response."
  );
  assert.deepEqual(realtime.events, [
    {
      room: `user:${PROVIDER_ID}`,
      event: "moderation_case_updated",
      data: {
        action: "case_status_changed",
        case_id: CASE_ID,
        status: "AWAITING_RESPONSE",
        response_id: null,
        attachment_count: null,
      },
    },
  ]);
});

test("terminal moderation decisions notify providers with exact messages", async () => {
  for (const [status, expectedType, expectedMessage] of [
    [
      "VALIDATED",
      "moderation_case_validated",
      "Moderation case has been validated.",
    ],
    [
      "DISMISSED",
      "moderation_case_dismissed",
      "Moderation case has been dismissed.",
    ],
  ]) {
    const queue = createQueueStub();
    const realtime = createPublishStub();

    await notifyProviderModerationStatus({
      providerId: PROVIDER_ID,
      caseId: CASE_ID,
      status,
      queue,
      publish: realtime.publish,
    });

    assert.equal(queue.jobs.length, 1);
    assert.equal(queue.jobs[0].data.type, expectedType);
    assert.equal(queue.jobs[0].data.message, expectedMessage);
    assert.equal(realtime.events[0].data.status, status);
  }
});

test("non-notifiable provider case statuses do not create notifications", async () => {
  const queue = createQueueStub();
  const realtime = createPublishStub();

  await notifyProviderModerationStatus({
    providerId: PROVIDER_ID,
    caseId: CASE_ID,
    status: "UNDER_REVIEW",
    queue,
    publish: realtime.publish,
  });

  assert.equal(queue.jobs.length, 0);
  assert.equal(realtime.events.length, 0);
});

test("provider response notifications are sent only to admin users", async () => {
  const queue = createQueueStub();
  const realtime = createPublishStub();
  const client = {
    async query(sql) {
      assert.match(sql, /WHERE role='admin'/);
      assert.match(sql, /is_verified=true/);
      return {
        rows: [{ id: ADMIN_ID }, { id: SECOND_ADMIN_ID }],
      };
    },
  };

  const adminIds = await notifyAdminsProviderResponseSubmitted({
    caseId: CASE_ID,
    providerId: PROVIDER_ID,
    responseId: RESPONSE_ID,
    attachmentCount: 2,
    client,
    queue,
    publish: realtime.publish,
  });

  assert.deepEqual(adminIds, [ADMIN_ID, SECOND_ADMIN_ID]);
  assert.deepEqual(
    queue.jobs.map((job) => job.data.userId),
    [ADMIN_ID, SECOND_ADMIN_ID]
  );
  assert.equal(
    queue.jobs[0].data.message,
    "Provider responded to moderation case."
  );
  assert.equal(queue.jobs[0].data.type, "moderation_provider_response_submitted");
  assert.deepEqual(
    realtime.events.map((event) => event.room),
    [`user:${ADMIN_ID}`, `user:${SECOND_ADMIN_ID}`]
  );
  assert.equal(realtime.events[0].event, "moderation_case_updated");
  assert.equal(realtime.events[0].data.action, "provider_response_submitted");
  assert.equal(realtime.events[0].data.attachment_count, 2);
});
