const assert = require("node:assert/strict");
const test = require("node:test");

const {
  notifyAdminsModerationCaseEscalated,
  notifyAdminsNgoVerificationSubmitted,
  notifyAdminsProviderPayoutAccountSubmitted,
  notifyAdminsProviderPayoutChangeRequested,
  notifyAdminsProviderReportSubmitted,
  notifyAdminsProviderVerificationSubmitted,
  notifyNgoVerificationApproved,
  notifyNgoVerificationRejected,
  notifyProviderReportSubmittedAgainstProvider,
  notifyProviderSettlementFailed,
  notifyProviderSettlementProcessed,
  notifyProviderVerificationApproved,
  notifyProviderVerificationRejected,
  notifyProviderPayoutChangeApproved,
  notifyProviderPayoutChangeRejected,
  notifyProviderPayoutVerificationApproved,
  notifyProviderPayoutVerificationRejected,
} = require("../shared/services/operationalNotification.service");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const NGO_USER_ID = "44444444-4444-4444-8444-444444444444";
const RESTAURANT_ID = "55555555-5555-4555-8555-555555555555";
const NGO_ID = "66666666-6666-4666-8666-666666666666";
const REPORT_ID = "77777777-7777-4777-8777-777777777777";
const CASE_ID = "88888888-8888-4888-8888-888888888888";
const REPORTER_ID = "99999999-9999-4999-8999-999999999999";

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

function createAdminClientStub(rows = [{ id: ADMIN_ID }]) {
  return {
    async query(sql) {
      assert.match(sql, /WHERE role='admin'/);
      assert.match(sql, /is_verified=true/);
      assert.match(sql, /banned_until/);
      return { rows };
    },
  };
}

test("provider verification submission notifies verified admins", async () => {
  const queue = createQueueStub();

  const adminIds = await notifyAdminsProviderVerificationSubmitted({
    providerId: PROVIDER_ID,
    restaurantId: RESTAURANT_ID,
    client: createAdminClientStub([{ id: ADMIN_ID }, { id: SECOND_ADMIN_ID }]),
    queue,
  });

  assert.deepEqual(adminIds, [ADMIN_ID, SECOND_ADMIN_ID]);
  assert.deepEqual(
    queue.jobs.map((job) => job.data.userId),
    [ADMIN_ID, SECOND_ADMIN_ID],
  );
  assert.equal(queue.jobs[0].name, "notify-user");
  assert.equal(queue.jobs[0].data.type, "provider_verification_submitted");
  assert.equal(
    queue.jobs[0].data.message,
    "New provider verification request pending review.",
  );
  assert.equal(queue.jobs[0].data.data.provider_id, PROVIDER_ID);
  assert.equal(queue.jobs[0].data.data.restaurant_id, RESTAURANT_ID);
});

test("NGO verification submission notifies verified admins", async () => {
  const queue = createQueueStub();

  await notifyAdminsNgoVerificationSubmitted({
    ngoId: NGO_ID,
    ngoUserId: NGO_USER_ID,
    client: createAdminClientStub(),
    queue,
  });

  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].data.userId, ADMIN_ID);
  assert.equal(queue.jobs[0].data.type, "ngo_verification_submitted");
  assert.equal(
    queue.jobs[0].data.message,
    "New NGO verification request pending review.",
  );
  assert.equal(queue.jobs[0].data.data.ngo_id, NGO_ID);
  assert.equal(queue.jobs[0].data.data.ngo_user_id, NGO_USER_ID);
});

test("provider report submission notifies admins and affected provider", async () => {
  const adminQueue = createQueueStub();
  const providerQueue = createQueueStub();

  await notifyAdminsProviderReportSubmitted({
    reportId: REPORT_ID,
    caseId: CASE_ID,
    providerId: PROVIDER_ID,
    reporterId: REPORTER_ID,
    client: createAdminClientStub(),
    queue: adminQueue,
  });
  await notifyProviderReportSubmittedAgainstProvider({
    providerId: PROVIDER_ID,
    reportId: REPORT_ID,
    caseId: CASE_ID,
    queue: providerQueue,
  });

  assert.equal(adminQueue.jobs.length, 1);
  assert.equal(adminQueue.jobs[0].data.userId, ADMIN_ID);
  assert.equal(adminQueue.jobs[0].data.type, "provider_report_submitted");
  assert.equal(
    adminQueue.jobs[0].data.message,
    "New provider report awaiting moderation review.",
  );
  assert.equal(adminQueue.jobs[0].data.data.case_id, CASE_ID);

  assert.equal(providerQueue.jobs.length, 1);
  assert.equal(providerQueue.jobs[0].data.userId, PROVIDER_ID);
  assert.equal(
    providerQueue.jobs[0].data.type,
    "provider_report_submitted_against_provider",
  );
  assert.equal(
    providerQueue.jobs[0].data.message,
    "A report has been submitted and is under review.",
  );
});

test("moderation case escalation notifies verified admins", async () => {
  const queue = createQueueStub();

  await notifyAdminsModerationCaseEscalated({
    caseId: CASE_ID,
    providerId: PROVIDER_ID,
    client: createAdminClientStub(),
    queue,
  });

  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].data.userId, ADMIN_ID);
  assert.equal(queue.jobs[0].data.type, "moderation_case_escalated");
  assert.equal(
    queue.jobs[0].data.message,
    "Moderation case escalated for review.",
  );
  assert.equal(queue.jobs[0].data.data.case_id, CASE_ID);
});

test("provider payout account submissions notify admins and publish financial refresh", async () => {
  const queue = createQueueStub();
  const realtime = createPublishStub();

  const adminIds = await notifyAdminsProviderPayoutAccountSubmitted({
    providerId: PROVIDER_ID,
    payoutAccountId: "payout-account-new",
    client: createAdminClientStub([{ id: ADMIN_ID }, { id: SECOND_ADMIN_ID }]),
    queue,
    publish: realtime.publish,
  });

  assert.deepEqual(adminIds, [ADMIN_ID, SECOND_ADMIN_ID]);
  assert.deepEqual(
    queue.jobs.map((job) => job.data.userId),
    [ADMIN_ID, SECOND_ADMIN_ID],
  );
  assert.equal(queue.jobs[0].data.type, "provider_payout_account_submitted");
  assert.equal(queue.jobs[0].data.title, "Payout account submitted");
  assert.equal(
    queue.jobs[0].data.idempotencyKey,
    `provider_payout_account_submitted:payout-account-new:admin:${ADMIN_ID}`,
  );
  assert.deepEqual(
    realtime.events.map((event) => event.room),
    [`user:${ADMIN_ID}`, `user:${SECOND_ADMIN_ID}`],
  );
  assert.equal(realtime.events[0].event, "provider_financial_updated");
  assert.equal(
    realtime.events[0].data.action,
    "provider_payout_account_submitted",
  );
  assert.equal(realtime.events[0].data.payout_account_id, "payout-account-new");
});

test("replacement payout uploads notify admins distinctly without duplicate event types", async () => {
  const queue = createQueueStub();
  const realtime = createPublishStub();

  await notifyAdminsProviderPayoutAccountSubmitted({
    providerId: PROVIDER_ID,
    payoutAccountId: "payout-account-replacement",
    previousPayoutAccountId: "payout-account-old",
    isReplacement: true,
    client: createAdminClientStub(),
    queue,
    publish: realtime.publish,
  });

  assert.equal(queue.jobs.length, 1);
  assert.equal(
    queue.jobs[0].data.type,
    "provider_payout_account_replacement_uploaded",
  );
  assert.equal(
    queue.jobs[0].data.idempotencyKey,
    `provider_payout_account_replacement_uploaded:payout-account-replacement:admin:${ADMIN_ID}`,
  );
  assert.equal(
    realtime.events[0].data.action,
    "provider_payout_account_replacement_uploaded",
  );
  assert.equal(
    realtime.events[0].data.previous_payout_account_id,
    "payout-account-old",
  );
});

test("provider payout change requests notify admins and publish financial refresh", async () => {
  const queue = createQueueStub();
  const realtime = createPublishStub();

  const adminIds = await notifyAdminsProviderPayoutChangeRequested({
    providerId: PROVIDER_ID,
    payoutAccountId: "payout-account-change",
    reason: "Changed UPI",
    client: createAdminClientStub([{ id: ADMIN_ID }, { id: SECOND_ADMIN_ID }]),
    queue,
    publish: realtime.publish,
  });

  assert.deepEqual(adminIds, [ADMIN_ID, SECOND_ADMIN_ID]);
  assert.equal(queue.jobs.length, 2);
  assert.equal(queue.jobs[0].data.type, "provider_payout_change_requested");
  assert.equal(queue.jobs[0].data.data.reason, "Changed UPI");
  assert.equal(
    queue.jobs[0].data.idempotencyKey,
    `provider_payout_change_requested:payout-account-change:admin:${ADMIN_ID}`,
  );
  assert.equal(realtime.events[0].event, "provider_financial_updated");
  assert.equal(
    realtime.events[0].data.action,
    "provider_payout_change_requested",
  );
  assert.equal(realtime.events[0].data.provider_id, PROVIDER_ID);
});

test("provider verification decisions notify only the provider account", async () => {
  for (const [notify, expectedType, expectedMessage] of [
    [
      notifyProviderVerificationApproved,
      "provider_verification_approved",
      "Your provider account has been approved.",
    ],
    [
      notifyProviderVerificationRejected,
      "provider_verification_rejected",
      "Your provider verification was rejected.",
    ],
  ]) {
    const queue = createQueueStub();

    await notify({
      providerId: PROVIDER_ID,
      restaurantId: RESTAURANT_ID,
      queue,
    });

    assert.equal(queue.jobs.length, 1);
    assert.equal(queue.jobs[0].data.userId, PROVIDER_ID);
    assert.equal(queue.jobs[0].data.type, expectedType);
    assert.equal(queue.jobs[0].data.message, expectedMessage);
    assert.equal(queue.jobs[0].data.data.restaurant_id, RESTAURANT_ID);
  }
});

test("NGO verification decisions notify only the NGO account", async () => {
  for (const [notify, expectedType, expectedMessage] of [
    [
      notifyNgoVerificationApproved,
      "ngo_verification_approved",
      "Your NGO account has been approved.",
    ],
    [
      notifyNgoVerificationRejected,
      "ngo_verification_rejected",
      "Your NGO verification was rejected.",
    ],
  ]) {
    const queue = createQueueStub();

    await notify({
      ngoUserId: NGO_USER_ID,
      ngoId: NGO_ID,
      queue,
    });

    assert.equal(queue.jobs.length, 1);
    assert.equal(queue.jobs[0].data.userId, NGO_USER_ID);
    assert.equal(queue.jobs[0].data.type, expectedType);
    assert.equal(queue.jobs[0].data.message, expectedMessage);
    assert.equal(queue.jobs[0].data.data.ngo_id, NGO_ID);
  }
});

test("provider payout verification decisions notify provider and publish financial refresh", async () => {
  for (const [notify, expectedType, expectedAction, expectedStatus] of [
    [
      notifyProviderPayoutVerificationApproved,
      "provider_payout_verification_approved",
      "provider_payout_account_verified",
      null,
    ],
    [
      notifyProviderPayoutVerificationRejected,
      "provider_payout_verification_rejected",
      "provider_payout_account_rejected",
      "rejected",
    ],
  ]) {
    const queue = createQueueStub();
    const realtime = createPublishStub();

    await notify({
      providerId: PROVIDER_ID,
      payoutAccountId: "payout-account-review",
      reason: "Name mismatch",
      queue,
      publish: realtime.publish,
    });

    assert.equal(queue.jobs.length, 1);
    assert.equal(queue.jobs[0].data.userId, PROVIDER_ID);
    assert.equal(queue.jobs[0].data.type, expectedType);
    assert.equal(
      queue.jobs[0].data.data.payout_account_id,
      "payout-account-review",
    );
    assert.deepEqual(realtime.events, [
      {
        room: `user:${PROVIDER_ID}`,
        event: "provider_financial_updated",
        data: {
          action: expectedAction,
          provider_id: PROVIDER_ID,
          payout_account_id: "payout-account-review",
          previous_payout_account_id: null,
          settlement_id: null,
          status: expectedStatus,
        },
      },
    ]);
  }
});

test("provider settlement decisions notify only the provider account", async () => {
  const paidQueue = createQueueStub();
  const failedQueue = createQueueStub();
  const paidRealtime = createPublishStub();
  const failedRealtime = createPublishStub();

  await notifyProviderSettlementProcessed({
    settlement: {
      id: "settlement-paid",
      provider_id: PROVIDER_ID,
      amount: 438.9,
      currency: "INR",
      payment_reference: "UTR123",
    },
    queue: paidQueue,
    publish: paidRealtime.publish,
  });
  await notifyProviderSettlementFailed({
    settlement: {
      id: "settlement-failed",
      provider_id: PROVIDER_ID,
      amount: 57,
      currency: "INR",
      notes: "Bank transfer rejected",
    },
    queue: failedQueue,
    publish: failedRealtime.publish,
  });

  assert.equal(paidQueue.jobs.length, 1);
  assert.equal(paidQueue.jobs[0].name, "notify-user");
  assert.equal(paidQueue.jobs[0].data.userId, PROVIDER_ID);
  assert.equal(paidQueue.jobs[0].data.type, "provider_settlement_paid");
  assert.equal(paidQueue.jobs[0].data.title, "Settlement Processed");
  assert.match(
    paidQueue.jobs[0].data.message,
    /Your settlement of \u20b9438\.90 has been marked paid\./,
  );
  assert.match(paidQueue.jobs[0].data.message, /Reference:\nUTR123/);
  assert.equal(
    paidQueue.jobs[0].data.idempotencyKey,
    "provider_settlement_paid:settlement-paid",
  );
  assert.deepEqual(paidRealtime.events, [
    {
      room: `user:${PROVIDER_ID}`,
      event: "provider_financial_updated",
      data: {
        action: "provider_settlement_paid",
        provider_id: PROVIDER_ID,
        payout_account_id: null,
        previous_payout_account_id: null,
        settlement_id: "settlement-paid",
        status: "paid",
      },
    },
  ]);

  assert.equal(failedQueue.jobs.length, 1);
  assert.equal(failedQueue.jobs[0].data.userId, PROVIDER_ID);
  assert.equal(failedQueue.jobs[0].data.type, "provider_settlement_failed");
  assert.equal(failedQueue.jobs[0].data.title, "Settlement Failed");
  assert.match(
    failedQueue.jobs[0].data.message,
    /Settlement processing failed\.\n\nReason:\nBank transfer rejected/,
  );
  assert.equal(failedQueue.jobs[0].data.data.reason, "Bank transfer rejected");
  assert.equal(
    failedRealtime.events[0].data.action,
    "provider_settlement_failed",
  );
  assert.equal(failedRealtime.events[0].data.status, "failed");
});

test("provider payout change approved notification is enqueued", async () => {
  const queue = createQueueStub();
  const realtime = createPublishStub();

  await notifyProviderPayoutChangeApproved({
    providerId: PROVIDER_ID,
    payoutAccountId: "account-change-approved",
    reason: "Approved for account update",
    queue,
    publish: realtime.publish,
  });

  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].name, "notify-user");
  assert.equal(queue.jobs[0].data.userId, PROVIDER_ID);
  assert.equal(queue.jobs[0].data.type, "provider_payout_change_approved");
  assert.equal(
    queue.jobs[0].data.title,
    "Payout account change request approved",
  );
  assert.match(
    queue.jobs[0].data.message,
    /Your payout account change request has been approved\./,
  );
  assert.equal(
    queue.jobs[0].data.data.payout_account_id,
    "account-change-approved",
  );
  assert.equal(realtime.events[0].event, "provider_financial_updated");
  assert.equal(
    realtime.events[0].data.action,
    "provider_payout_change_approved",
  );
  assert.equal(realtime.events[0].data.status, "replacement_pending");
});

test("provider payout change rejected notification is enqueued", async () => {
  const queue = createQueueStub();
  const realtime = createPublishStub();

  await notifyProviderPayoutChangeRejected({
    providerId: PROVIDER_ID,
    payoutAccountId: "account-change-rejected",
    reason: "Incorrect documentation",
    queue,
    publish: realtime.publish,
  });

  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].name, "notify-user");
  assert.equal(queue.jobs[0].data.userId, PROVIDER_ID);
  assert.equal(queue.jobs[0].data.type, "provider_payout_change_rejected");
  assert.equal(
    queue.jobs[0].data.title,
    "Payout account change request rejected",
  );
  assert.match(
    queue.jobs[0].data.message,
    /Your payout account change request was rejected\. Reason: Incorrect documentation/,
  );
  assert.equal(
    queue.jobs[0].data.data.payout_account_id,
    "account-change-rejected",
  );
  assert.equal(realtime.events[0].event, "provider_financial_updated");
  assert.equal(
    realtime.events[0].data.action,
    "provider_payout_change_rejected",
  );
  assert.equal(realtime.events[0].data.status, "rejected");
});
