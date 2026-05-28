const assert = require("node:assert/strict");
const test = require("node:test");

const {
  prepareLifecycleAccounting,
  resolveLifecycleAccounting,
} = require("../shared/services/lifecycleAccounting.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NGO_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const RESERVATION_ID = "55555555-5555-4555-8555-555555555555";
const OWNERSHIP_ID = "66666666-6666-4666-8666-666666666666";

function reservation(overrides = {}) {
  return {
    id: RESERVATION_ID,
    user_id: USER_ID,
    pickup_type: "self_pickup",
    assigned_volunteer_id: null,
    status: "reserved",
    task_status: "pending",
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    reservation_id: RESERVATION_ID,
    payment_session_id: "session_lifecycle_accounting",
    amount: 120,
    food_amount: 100,
    reliability_deposit_amount: 20,
    reliability_deposit_status: "held",
    status: "paid",
    ...overrides,
  };
}

function ownership(overrides = {}) {
  const payerId = overrides.payer_user_id || USER_ID;
  const payerRole = overrides.payer_role || "user";

  return {
    id: OWNERSHIP_ID,
    reservation_id: RESERVATION_ID,
    payment_session_id: "session_lifecycle_accounting",
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
    food_amount: 100,
    deposit_amount: 20,
    commission_amount: 0,
    currency: "INR",
    ownership_version: 1,
    snapshot_hash: "snapshot-hash",
    ...overrides,
  };
}

function createOperationClient() {
  const operations = new Map();

  function rowFromInsert(params) {
    return {
      id: `88888888-8888-4888-8888-${String(operations.size + 1).padStart(12, "0")}`,
      operation_type: params[0],
      operation_source: params[1],
      reservation_id: params[2],
      payment_session_id: params[3],
      payment_ownership_id: params[4],
      actor_user_id: params[5],
      actor_role: params[6],
      amount: params[7],
      currency: params[8],
      idempotency_key: params[9],
      status: params[10],
      retry_count: 0,
      metadata: JSON.parse(params[11]),
    };
  }

  function mergeMetadata(row, rawMetadata) {
    row.metadata = {
      ...(row.metadata || {}),
      ...JSON.parse(rawMetadata || "{}"),
    };
  }

  return {
    operations,
    async query(sql, params = []) {
      const text = String(sql);

      if (text.includes("INSERT INTO financial_operations")) {
        const row = rowFromInsert(params);
        if (operations.has(row.idempotency_key)) return { rows: [] };
        operations.set(row.idempotency_key, row);
        return { rows: [row] };
      }

      if (text.includes("FROM financial_operations")) {
        return { rows: [operations.get(params[0])].filter(Boolean) };
      }

      if (text.includes("UPDATE financial_operations")) {
        const row = Array.from(operations.values()).find(
          (operation) =>
            operation.id === params[0] ||
            operation.idempotency_key === params[0]
        );
        if (!row) return { rows: [] };

        if (text.includes("retry_count=retry_count + 1")) {
          row.status = "processing";
          row.retry_count += 1;
          mergeMetadata(row, params[1]);
        } else {
          row.status = params[1];
          mergeMetadata(row, params[2]);
        }

        return { rows: [row] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

async function prepareCase({
  terminalReason,
  reservationOverrides = {},
  paymentOverrides = {},
  ownershipOverrides = {},
  actorContext = { role: "system" },
}) {
  const client = createOperationClient();
  const result = await prepareLifecycleAccounting({
    client,
    reservation: reservation(reservationOverrides),
    payment: payment(paymentOverrides),
    paymentOwnership: ownership(ownershipOverrides),
    terminalReason,
    actorContext,
  });

  return {
    client,
    result,
    operation: result.operation,
  };
}

test("USER restricted cancellation emits refund accounting to user", async () => {
  const { operation } = await prepareCase({ terminalReason: "user_cancelled" });

  assert.equal(operation.operation_type, "payment_refund");
  assert.equal(operation.operation_source, "user_cancelled");
  assert.equal(operation.actor_role, "user");
  assert.equal(operation.actor_user_id, USER_ID);
  assert.equal(operation.amount, 120);
});

test("USER unrestricted cancellation emits food refund accounting only", async () => {
  const { operation } = await prepareCase({
    terminalReason: "user_cancelled",
    paymentOverrides: {
      amount: 100,
      reliability_deposit_amount: 0,
      reliability_deposit_status: "not_required",
    },
    ownershipOverrides: {
      deposit_amount: 0,
      deposit_owner_user_id: null,
      deposit_owner_role: null,
    },
  });

  assert.equal(operation.operation_type, "payment_refund");
  assert.equal(operation.operation_source, "user_cancelled");
  assert.equal(operation.actor_role, "user");
  assert.equal(operation.amount, 100);
});

test("USER restricted failed pickup emits platform retention accounting", async () => {
  const { operation } = await prepareCase({
    terminalReason: "user_failed_pickup",
  });

  assert.equal(operation.operation_type, "deposit_retention");
  assert.equal(operation.operation_source, "user_failed_pickup");
  assert.equal(operation.actor_role, "platform");
  assert.equal(operation.actor_user_id, null);
  assert.equal(operation.amount, 20);
});

test("USER unrestricted failed pickup emits skipped lifecycle accounting", async () => {
  const { operation, result } = await prepareCase({
    terminalReason: "user_failed_pickup",
    paymentOverrides: {
      amount: 100,
      reliability_deposit_amount: 0,
      reliability_deposit_status: "not_required",
    },
    ownershipOverrides: {
      deposit_amount: 0,
      deposit_owner_user_id: null,
      deposit_owner_role: null,
    },
  });

  assert.equal(operation.operation_type, "lifecycle_accounting");
  assert.equal(operation.operation_source, "user_failed_pickup");
  assert.equal(operation.status, "skipped");
  assert.equal(operation.amount, 0);
  assert.equal(result.shouldExecute, false);
});

test("USER successful pickup emits deposit refund accounting", async () => {
  const { operation } = await prepareCase({
    terminalReason: "successful_pickup",
  });

  assert.equal(operation.operation_type, "deposit_refund");
  assert.equal(operation.operation_source, "successful_pickup");
  assert.equal(operation.actor_role, "user");
  assert.equal(operation.actor_user_id, USER_ID);
  assert.equal(operation.amount, 20);
});

test("NGO restricted cancellation emits refund accounting to NGO only", async () => {
  const { operation } = await prepareCase({
    terminalReason: "ngo_cancelled",
    reservationOverrides: {
      user_id: NGO_ID,
      pickup_type: "ngo",
      assigned_volunteer_id: VOLUNTEER_ID,
    },
    paymentOverrides: {
      amount: 50,
      food_amount: 0,
      reliability_deposit_amount: 50,
    },
    ownershipOverrides: {
      payer_user_id: NGO_ID,
      payer_role: "ngo",
      deposit_owner_user_id: NGO_ID,
      deposit_owner_role: "ngo",
      refund_target_user_id: NGO_ID,
      refund_target_role: "ngo",
      food_amount: 0,
      deposit_amount: 50,
    },
  });

  assert.equal(operation.operation_type, "payment_refund");
  assert.equal(operation.operation_source, "ngo_cancelled");
  assert.equal(operation.actor_role, "ngo");
  assert.equal(operation.actor_user_id, NGO_ID);
  assert.notEqual(operation.actor_user_id, VOLUNTEER_ID);
  assert.notEqual(operation.actor_user_id, PROVIDER_ID);
});

test("NGO volunteer pickup and delivery failures retain deposit to platform", async () => {
  for (const terminalReason of [
    "volunteer_pickup_failed",
    "volunteer_delivery_failed",
  ]) {
    const { operation } = await prepareCase({
      terminalReason,
      reservationOverrides: {
        user_id: NGO_ID,
        pickup_type: "ngo",
        assigned_volunteer_id: VOLUNTEER_ID,
      },
      paymentOverrides: {
        amount: 50,
        food_amount: 0,
        reliability_deposit_amount: 50,
      },
      ownershipOverrides: {
        payer_user_id: NGO_ID,
        payer_role: "ngo",
        deposit_owner_user_id: NGO_ID,
        deposit_owner_role: "ngo",
        refund_target_user_id: NGO_ID,
        refund_target_role: "ngo",
        food_amount: 0,
        deposit_amount: 50,
      },
    });

    assert.equal(operation.operation_type, "deposit_retention");
    assert.equal(operation.operation_source, terminalReason);
    assert.equal(operation.actor_role, "platform");
    assert.equal(operation.actor_user_id, null);
  }
});

test("NGO successful delivery emits deposit refund to NGO only", async () => {
  const { operation } = await prepareCase({
    terminalReason: "successful_delivery",
    reservationOverrides: {
      user_id: NGO_ID,
      pickup_type: "ngo",
      assigned_volunteer_id: VOLUNTEER_ID,
    },
    paymentOverrides: {
      amount: 50,
      food_amount: 0,
      reliability_deposit_amount: 50,
    },
    ownershipOverrides: {
      payer_user_id: NGO_ID,
      payer_role: "ngo",
      deposit_owner_user_id: NGO_ID,
      deposit_owner_role: "ngo",
      refund_target_user_id: NGO_ID,
      refund_target_role: "ngo",
      food_amount: 0,
      deposit_amount: 50,
    },
  });

  assert.equal(operation.operation_type, "deposit_refund");
  assert.equal(operation.operation_source, "successful_delivery");
  assert.equal(operation.actor_role, "ngo");
  assert.equal(operation.actor_user_id, NGO_ID);
  assert.notEqual(operation.actor_user_id, VOLUNTEER_ID);
});

test("NGO zero-liability terminal flows do not create financial operations", async () => {
  for (const terminalReason of [
    "ngo_cancelled",
    "successful_delivery",
    "volunteer_pickup_failed",
    "volunteer_delivery_failed",
  ]) {
    const client = createOperationClient();
    const result = await prepareLifecycleAccounting({
      client,
      reservation: reservation({
        user_id: NGO_ID,
        pickup_type: "ngo",
        assigned_volunteer_id: VOLUNTEER_ID,
      }),
      payment: payment({
        amount: 0,
        food_amount: 0,
        reliability_deposit_amount: 0,
        reliability_deposit_status: "not_required",
      }),
      paymentOwnership: ownership({
        payer_user_id: NGO_ID,
        payer_role: "ngo",
        beneficiary_user_id: null,
        beneficiary_role: null,
        deposit_owner_user_id: null,
        deposit_owner_role: null,
        refund_target_user_id: NGO_ID,
        refund_target_role: "ngo",
        food_amount: 0,
        deposit_amount: 0,
        commission_amount: 0,
      }),
      terminalReason,
    });

    assert.equal(result.accountingSkipped, true);
    assert.equal(result.skipReason, "ngo_zero_liability");
    assert.equal(result.operation, null);
    assert.equal(result.shouldExecute, false);
    assert.equal(client.operations.size, 0);
  }
});

test("SYSTEM payment timeout emits skipped accounting row", async () => {
  const { operation, result } = await prepareCase({
    terminalReason: "payment_timeout",
    paymentOverrides: {
      status: "failed",
    },
    actorContext: {
      role: "system",
    },
  });

  assert.equal(operation.operation_type, "lifecycle_accounting");
  assert.equal(operation.operation_source, "payment_timeout");
  assert.equal(operation.actor_role, "system");
  assert.equal(operation.status, "skipped");
  assert.equal(result.shouldExecute, false);
});

test("SYSTEM reservation expiry emits deterministic retention accounting", async () => {
  const { operation } = await prepareCase({
    terminalReason: "reservation_expired",
  });

  assert.equal(operation.operation_type, "deposit_retention");
  assert.equal(operation.operation_source, "reservation_expired");
  assert.equal(operation.actor_role, "platform");
});

test("lifecycle accounting replay prevents duplicate rows", async () => {
  const client = createOperationClient();
  const input = {
    client,
    reservation: reservation(),
    payment: payment(),
    paymentOwnership: ownership(),
    terminalReason: "user_cancelled",
  };

  const first = await prepareLifecycleAccounting(input);
  const replay = await prepareLifecycleAccounting(input);

  assert.equal(first.duplicatePrevented, false);
  assert.equal(replay.duplicatePrevented, true);
  assert.equal(client.operations.size, 1);
});

test("lifecycle accounting invariants reject volunteer refund leakage", () => {
  const accounting = resolveLifecycleAccounting({
    reservation: reservation({
      pickup_type: "ngo",
      assigned_volunteer_id: VOLUNTEER_ID,
    }),
    payment: payment(),
    paymentOwnership: ownership({
      payer_user_id: NGO_ID,
      payer_role: "ngo",
      deposit_owner_user_id: VOLUNTEER_ID,
      deposit_owner_role: "volunteer",
      refund_target_user_id: VOLUNTEER_ID,
      refund_target_role: "volunteer",
      food_amount: 0,
      deposit_amount: 50,
    }),
    terminalReason: "ngo_cancelled",
  });

  assert.ok(
    accounting.invariantFailures.some((failure) =>
      failure.includes("volunteer user id leaked")
    )
  );
});
