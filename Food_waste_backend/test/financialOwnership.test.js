const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFinancialOwnershipSnapshot,
  createFinancialOwnershipSnapshot,
  getFinancialOwnership,
} = require("../shared/services/financialOwnership.service");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NGO_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";
const NEW_PROVIDER_ID = "44444444-4444-4444-8444-444444444444";
const RESERVATION_ID = "55555555-5555-4555-8555-555555555555";
const PAYMENT_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_SESSION_ID = "session_f1_test";

function userReservation(overrides = {}) {
  return {
    id: RESERVATION_ID,
    user_id: USER_ID,
    listing_id: "77777777-7777-4777-8777-777777777777",
    pickup_type: "self_pickup",
    provider_id: PROVIDER_ID,
    food_amount: 120,
    reliability_deposit_amount: 25,
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    id: PAYMENT_ID,
    order_id: "order_f1_test",
    payment_session_id: PAYMENT_SESSION_ID,
    food_amount: 120,
    reliability_deposit_amount: 25,
    ...overrides,
  };
}

function createOwnershipClient() {
  const rows = new Map();
  const calls = [];

  return {
    calls,
    rows,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });

      if (String(sql).includes("INSERT INTO payment_ownership")) {
        await new Promise((resolve) => setImmediate(resolve));
        const key = `${params[0]}:${params[1]}:${params[18]}`;
        if (rows.has(key)) return { rows: [] };

        const row = {
          id: `ownership-${rows.size + 1}`,
          reservation_id: params[0],
          payment_session_id: params[1],
          payer_user_id: params[2],
          payer_role: params[3],
          provider_id: params[4],
          beneficiary_user_id: params[5],
          beneficiary_role: params[6],
          platform_account_id: params[7],
          deposit_owner_user_id: params[8],
          deposit_owner_role: params[9],
          refund_target_user_id: params[10],
          refund_target_role: params[11],
          commission_receiver_user_id: params[12],
          commission_receiver_role: params[13],
          food_amount: params[14],
          deposit_amount: params[15],
          commission_amount: params[16],
          currency: params[17],
          ownership_version: params[18],
          snapshot_hash: params[19],
          source_metadata: JSON.parse(params[20]),
        };
        rows.set(key, row);
        return { rows: [row] };
      }

      if (String(sql).includes("FROM payment_ownership")) {
        const matches = Array.from(rows.values()).filter((row) => {
          if (params.length === 3) {
            return (
              row.reservation_id === params[0] &&
              row.payment_session_id === params[1] &&
              row.ownership_version === params[2]
            );
          }
          return (
            (!params[0] || row.reservation_id === params[0]) &&
            (!params[1] || row.payment_session_id === params[1])
          );
        });
        return { rows: matches };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("user reservation ownership freezes payer, provider, beneficiary, and refund target", () => {
  const snapshot = buildFinancialOwnershipSnapshot({
    reservation: userReservation(),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  });

  assert.equal(snapshot.payer_user_id, USER_ID);
  assert.equal(snapshot.payer_role, "user");
  assert.equal(snapshot.provider_id, PROVIDER_ID);
  assert.equal(snapshot.beneficiary_user_id, PROVIDER_ID);
  assert.equal(snapshot.beneficiary_role, "provider");
  assert.equal(snapshot.deposit_owner_user_id, USER_ID);
  assert.equal(snapshot.refund_target_user_id, USER_ID);
  assert.equal(snapshot.refund_target_role, "user");
  assert.equal(snapshot.food_amount, 120);
  assert.equal(snapshot.deposit_amount, 25);
  assert.equal(snapshot.currency, "INR");
  assert.ok(snapshot.snapshot_hash);
});

test("NGO reservation ownership keeps volunteer out of financial ownership", () => {
  const snapshot = buildFinancialOwnershipSnapshot({
    reservation: userReservation({
      user_id: NGO_ID,
      pickup_type: "ngo",
      assigned_volunteer_id: "99999999-9999-4999-8999-999999999999",
      food_amount: 0,
      reliability_deposit_amount: 50,
    }),
    payment: payment({
      food_amount: 0,
      reliability_deposit_amount: 50,
    }),
    payer: { id: NGO_ID, role: "ngo" },
  });

  assert.equal(snapshot.payer_user_id, NGO_ID);
  assert.equal(snapshot.payer_role, "ngo");
  assert.equal(snapshot.provider_id, PROVIDER_ID);
  assert.equal(snapshot.beneficiary_user_id, null);
  assert.equal(snapshot.deposit_owner_user_id, NGO_ID);
  assert.equal(snapshot.refund_target_user_id, NGO_ID);
  assert.equal(snapshot.refund_target_role, "ngo");
  assert.equal(snapshot.food_amount, 0);
  assert.equal(snapshot.deposit_amount, 50);
  assert.equal(Object.values(snapshot).includes("99999999-9999-4999-8999-999999999999"), false);
});

test("financial ownership creation is idempotent for the same reservation and session", async () => {
  const client = createOwnershipClient();
  const input = {
    client,
    reservation: userReservation(),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  };

  const first = await createFinancialOwnershipSnapshot(input);
  const second = await createFinancialOwnershipSnapshot(input);

  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(second.duplicateHashMatch, true);
  assert.equal(client.rows.size, 1);
});

test("financial ownership duplicate prevention is safe under concurrent creation", async () => {
  const client = createOwnershipClient();
  const input = {
    client,
    reservation: userReservation(),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  };

  const results = await Promise.all([
    createFinancialOwnershipSnapshot(input),
    createFinancialOwnershipSnapshot(input),
  ]);

  assert.equal(results.filter((result) => result.inserted).length, 1);
  assert.equal(results.filter((result) => !result.inserted).length, 1);
  assert.equal(client.rows.size, 1);
});

test("provider edits after payment creation do not mutate frozen ownership", () => {
  const beforeEdit = buildFinancialOwnershipSnapshot({
    reservation: userReservation({ provider_id: PROVIDER_ID }),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  });
  const afterEdit = buildFinancialOwnershipSnapshot({
    reservation: userReservation({ provider_id: NEW_PROVIDER_ID }),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  });

  assert.equal(beforeEdit.provider_id, PROVIDER_ID);
  assert.equal(afterEdit.provider_id, NEW_PROVIDER_ID);
  assert.notEqual(beforeEdit.snapshot_hash, afterEdit.snapshot_hash);
});

test("duplicate ownership with changed provider is rejected without mutation", async () => {
  const client = createOwnershipClient();
  const first = await createFinancialOwnershipSnapshot({
    client,
    reservation: userReservation({ provider_id: PROVIDER_ID }),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  });
  const duplicate = await createFinancialOwnershipSnapshot({
    client,
    reservation: userReservation({ provider_id: NEW_PROVIDER_ID }),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  });

  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.duplicateHashMatch, false);
  assert.equal(duplicate.snapshot.provider_id, PROVIDER_ID);
  assert.equal(client.rows.size, 1);
});

test("volunteer assignment and lifecycle transitions do not affect deterministic ownership", () => {
  const initial = buildFinancialOwnershipSnapshot({
    reservation: userReservation({
      assigned_volunteer_id: null,
      status: "payment_pending",
      task_status: "pending",
    }),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  });
  const laterLifecycle = buildFinancialOwnershipSnapshot({
    reservation: userReservation({
      assigned_volunteer_id: "99999999-9999-4999-8999-999999999999",
      status: "completed",
      task_status: "delivered",
    }),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  });

  assert.equal(initial.snapshot_hash, laterLifecycle.snapshot_hash);
});

test("getFinancialOwnership reads by reservation and payment session without mutation", async () => {
  const client = createOwnershipClient();
  await createFinancialOwnershipSnapshot({
    client,
    reservation: userReservation(),
    payment: payment(),
    payer: { id: USER_ID, role: "user" },
  });

  const rows = await getFinancialOwnership({
    db: client,
    reservationId: RESERVATION_ID,
    paymentSessionId: PAYMENT_SESSION_ID,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].reservation_id, RESERVATION_ID);
  assert.equal(rows[0].payment_session_id, PAYMENT_SESSION_ID);
});
