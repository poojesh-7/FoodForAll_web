const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveRefundPlan,
} = require("../shared/services/refundRouting.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NGO_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const RESERVATION_ID = "55555555-5555-4555-8555-555555555555";
const OWNERSHIP_ID = "66666666-6666-4666-8666-666666666666";

function ownership(overrides = {}) {
  const payerId = overrides.payer_user_id || USER_ID;
  const payerRole = overrides.payer_role || "user";

  return {
    id: OWNERSHIP_ID,
    reservation_id: RESERVATION_ID,
    payment_session_id: "session_f2_test",
    payer_user_id: payerId,
    payer_role: payerRole,
    provider_id: PROVIDER_ID,
    beneficiary_user_id: PROVIDER_ID,
    beneficiary_role: "provider",
    platform_account_id: "platform",
    deposit_owner_user_id: payerId,
    deposit_owner_role: payerRole,
    refund_target_user_id: payerId,
    refund_target_role: payerRole,
    food_amount: 120,
    deposit_amount: 25,
    commission_amount: 0,
    currency: "INR",
    ownership_version: 1,
    snapshot_hash: "snapshot-hash",
    ...overrides,
  };
}

function reservation(overrides = {}) {
  return {
    id: RESERVATION_ID,
    user_id: USER_ID,
    provider_id: "99999999-9999-4999-8999-999999999999",
    assigned_volunteer_id: VOLUNTEER_ID,
    pickup_type: "self_pickup",
    status: "cancelled",
    ...overrides,
  };
}

function refundSummary(plan) {
  return plan.refunds.map((refund) => ({
    type: refund.refundType,
    amount: refund.amount,
    actorUserId: refund.actorUserId,
    actorRole: refund.actorRole,
  }));
}

test("user cancellation refunds food and deposit to frozen user ownership", () => {
  const plan = resolveRefundPlan({
    reservation: reservation(),
    paymentOwnership: ownership(),
    lifecycleState: {
      refundType: "payment",
      outcome: "cancellation",
    },
    cancellationReason: "user_cancelled",
  });

  assert.deepEqual(refundSummary(plan), [
    { type: "food", amount: 120, actorUserId: USER_ID, actorRole: "user" },
    { type: "deposit", amount: 25, actorUserId: USER_ID, actorRole: "user" },
  ]);
  assert.equal(plan.retainedAmounts.length, 0);
  assert.equal(plan.metadata.routingSource, "payment_ownership");
  assert.equal(
    plan.refunds.some((refund) => refund.actorUserId === PROVIDER_ID),
    false
  );
  assert.equal(
    plan.refunds.some((refund) => refund.actorUserId === VOLUNTEER_ID),
    false
  );
});

test("unrestricted user cancellation refunds food only", () => {
  const plan = resolveRefundPlan({
    reservation: reservation(),
    paymentOwnership: ownership({ deposit_amount: 0, deposit_owner_user_id: null }),
    lifecycleState: {
      refundType: "payment",
      outcome: "cancellation",
    },
  });

  assert.deepEqual(refundSummary(plan), [
    { type: "food", amount: 120, actorUserId: USER_ID, actorRole: "user" },
  ]);
  assert.equal(plan.retainedAmounts.length, 0);
});

test("successful user pickup refunds deposit to frozen deposit owner", () => {
  const plan = resolveRefundPlan({
    reservation: reservation({ status: "completed" }),
    paymentOwnership: ownership(),
    lifecycleState: {
      refundType: "reliability_deposit",
      outcome: "success",
    },
  });

  assert.deepEqual(refundSummary(plan), [
    { type: "deposit", amount: 25, actorUserId: USER_ID, actorRole: "user" },
  ]);
  assert.equal(plan.retainedAmounts.length, 0);
});

test("failed user pickup retains deposit to platform", () => {
  const plan = resolveRefundPlan({
    reservation: reservation({ status: "expired" }),
    paymentOwnership: ownership(),
    lifecycleState: {
      refundType: "reliability_deposit",
      outcome: "failure",
    },
    failureReason: "pickup_window_expired",
  });

  assert.equal(plan.refunds.length, 0);
  assert.deepEqual(plan.retainedAmounts, [
    {
      retentionType: "deposit",
      amount: 25,
      currency: "INR",
      actorUserId: null,
      actorRole: "platform",
      platformAccountId: "platform",
      reason: "pickup_window_expired",
    },
  ]);
});

test("NGO deposit refunds and retention never route through volunteer", () => {
  const ngoOwnership = ownership({
    payer_user_id: NGO_ID,
    payer_role: "ngo",
    deposit_owner_user_id: NGO_ID,
    deposit_owner_role: "ngo",
    refund_target_user_id: NGO_ID,
    refund_target_role: "ngo",
    food_amount: 0,
    deposit_amount: 50,
  });
  const success = resolveRefundPlan({
    reservation: reservation({
      user_id: NGO_ID,
      pickup_type: "ngo",
      assigned_volunteer_id: VOLUNTEER_ID,
    }),
    paymentOwnership: ngoOwnership,
    lifecycleState: {
      refundType: "reliability_deposit",
      outcome: "success",
    },
  });
  const failure = resolveRefundPlan({
    reservation: reservation({
      user_id: NGO_ID,
      pickup_type: "ngo",
      assigned_volunteer_id: VOLUNTEER_ID,
    }),
    paymentOwnership: ngoOwnership,
    lifecycleState: {
      refundType: "reliability_deposit",
      outcome: "failure",
    },
    failureReason: "delivery_failed",
  });

  assert.deepEqual(refundSummary(success), [
    { type: "deposit", amount: 50, actorUserId: NGO_ID, actorRole: "ngo" },
  ]);
  assert.equal(failure.refunds.length, 0);
  assert.equal(failure.retainedAmounts[0].actorRole, "platform");
  assert.equal(
    [...success.refunds, ...failure.retainedAmounts].some(
      (item) => item.actorUserId === VOLUNTEER_ID
    ),
    false
  );
});

test("lifecycle and assignment mutations do not alter ownership-derived refund plan", () => {
  const frozenOwnership = ownership();
  const initial = resolveRefundPlan({
    reservation: reservation({ provider_id: PROVIDER_ID, assigned_volunteer_id: null }),
    paymentOwnership: frozenOwnership,
    lifecycleState: {
      refundType: "payment",
      outcome: "cancellation",
    },
  });
  const mutated = resolveRefundPlan({
    reservation: reservation({
      provider_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      assigned_volunteer_id: VOLUNTEER_ID,
      status: "cancelled",
    }),
    paymentOwnership: frozenOwnership,
    lifecycleState: {
      refundType: "payment",
      outcome: "cancellation",
    },
  });

  assert.deepEqual(mutated, initial);
});
