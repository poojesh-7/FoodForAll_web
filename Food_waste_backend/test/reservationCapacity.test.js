const assert = require("node:assert/strict");
const test = require("node:test");

const {
  activeReservationWhere,
  assertReservationCapacity,
  getReservationCapacity,
} = require("../shared/services/reservationCapacity.service");
const {
  buildReservationPolicy,
} = require("../shared/config/reservationPolicy");

const USER_ID = "11111111-1111-4111-8111-111111111111";

function createCapacityClient(activeReservations = 0) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql: String(sql), params });
      return { rows: [{ active_reservations: activeReservations }] };
    },
  };
}

test("reservation capacity uses active reservations only", async () => {
  const client = createCapacityClient(4);
  const capacity = await getReservationCapacity({
    client,
    userId: USER_ID,
    role: "user",
    trustPolicy: {
      canReserve: true,
      requiresDeposit: false,
      restrictionLevel: 0,
      cooldownUntil: null,
    },
  });

  assert.equal(capacity.activeReservations, 4);
  assert.equal(capacity.maxActiveReservations, 5);
  assert.equal(capacity.remainingCapacity, 1);
  assert.equal(capacity.bulkReservationEnabled, false);
  assert.equal(capacity.depositRequired, false);
  assert.equal(capacity.reservationBlocked, false);

  const sql = client.queries.find((query) =>
    query.sql.includes("FROM reservations r")
  ).sql;
  assert.match(sql, /payment_expires_at <= NOW\(\)/);
  assert.match(sql, /completed_at IS NOT NULL/);
  assert.match(sql, /picked_up/);
  assert.match(sql, /cancelled/);
  assert.match(sql, /refunded/);
  assert.match(sql, /stock_reserved/);
});

test("user capacity follows restriction and cooldown policy", async () => {
  const restricted = await getReservationCapacity({
    client: createCapacityClient(1),
    userId: USER_ID,
    role: "user",
    trustPolicy: {
      canReserve: true,
      requiresDeposit: false,
      restrictionLevel: 2,
      cooldownUntil: null,
    },
  });

  assert.equal(restricted.maxActiveReservations, 2);
  assert.equal(restricted.remainingCapacity, 1);

  const cooldown = await getReservationCapacity({
    client: createCapacityClient(0),
    userId: USER_ID,
    role: "user",
    trustPolicy: {
      canReserve: false,
      requiresDeposit: false,
      restrictionLevel: 1,
      cooldownUntil: new Date("2099-01-01T00:00:00.000Z"),
    },
  });

  assert.equal(cooldown.maxActiveReservations, 0);
  assert.equal(cooldown.remainingCapacity, 0);
  assert.equal(cooldown.bulkReservationEnabled, false);
  assert.equal(cooldown.reservationBlocked, true);
});

test("NGO bulk capacity follows restriction level and deposit override", async () => {
  const normal = await getReservationCapacity({
    client: createCapacityClient(0),
    userId: USER_ID,
    role: "ngo",
    trustPolicy: {
      canReserve: true,
      requiresDeposit: false,
      restrictionLevel: 0,
      cooldownUntil: null,
    },
  });
  assert.equal(normal.maxActiveReservations, 8);
  assert.equal(normal.bulkReservationEnabled, true);

  const rl2 = await getReservationCapacity({
    client: createCapacityClient(0),
    userId: USER_ID,
    role: "ngo",
    trustPolicy: {
      canReserve: true,
      requiresDeposit: false,
      restrictionLevel: 2,
      cooldownUntil: null,
    },
  });
  assert.equal(rl2.maxActiveReservations, 2);
  assert.equal(rl2.bulkReservationEnabled, false);

  const depositRequired = await getReservationCapacity({
    client: createCapacityClient(0),
    userId: USER_ID,
    role: "ngo",
    trustPolicy: {
      canReserve: true,
      requiresDeposit: true,
      restrictionLevel: 1,
      cooldownUntil: null,
    },
  });
  assert.equal(depositRequired.maxActiveReservations, 5);
  assert.equal(depositRequired.bulkReservationEnabled, false);
  assert.equal(depositRequired.depositRequired, true);
});

test("capacity assertions reject exhausted, over-capacity, and disabled bulk requests", () => {
  assert.throws(
    () =>
      assertReservationCapacity({
        role: "user",
        requestedReservationCount: 1,
        capacity: {
          activeReservations: 5,
          maxActiveReservations: 5,
          remainingCapacity: 0,
          bulkReservationEnabled: false,
          depositRequired: false,
          reservationBlocked: true,
        },
      }),
    /active reservation limit/
  );

  assert.throws(
    () =>
      assertReservationCapacity({
        role: "user",
        requestedReservationCount: 3,
        capacity: {
          activeReservations: 4,
          maxActiveReservations: 5,
          remainingCapacity: 1,
          bulkReservationEnabled: false,
          depositRequired: false,
          reservationBlocked: false,
        },
      }),
    /exceed your active reservation capacity/
  );

  assert.throws(
    () =>
      assertReservationCapacity({
        role: "ngo",
        requestedReservationCount: 3,
        capacity: {
          activeReservations: 0,
          maxActiveReservations: 8,
          remainingCapacity: 8,
          bulkReservationEnabled: false,
          depositRequired: false,
          reservationBlocked: false,
        },
      }),
    /Bulk reservations are temporarily disabled/
  );
});

test("reservation policy supports environment overrides", async () => {
  const policy = buildReservationPolicy({
    USER_MAX_ACTIVE_RESERVATIONS: "4",
    USER_RL1_MAX_ACTIVE_RESERVATIONS: "2",
    USER_RL2_MAX_ACTIVE_RESERVATIONS: "1",
    USER_RL3_MAX_ACTIVE_RESERVATIONS: "0",
    NGO_MAX_ACTIVE_RESERVATIONS: "9",
    NGO_RL1_MAX_ACTIVE_RESERVATIONS: "6",
    NGO_RL2_MAX_ACTIVE_RESERVATIONS: "3",
    NGO_RL3_MAX_ACTIVE_RESERVATIONS: "1",
    NGO_RL1_BULK_ENABLED: "false",
    NGO_RL2_BULK_ENABLED: "true",
    NGO_RL3_BULK_ENABLED: "false",
    DEPOSIT_ENFORCEMENT_DISABLE_BULK: "false",
  });

  const capacity = await getReservationCapacity({
    client: createCapacityClient(0),
    userId: USER_ID,
    role: "ngo",
    policy,
    trustPolicy: {
      canReserve: true,
      requiresDeposit: true,
      restrictionLevel: 1,
      cooldownUntil: null,
    },
  });

  assert.equal(capacity.maxActiveReservations, 6);
  assert.equal(capacity.bulkReservationEnabled, false);
  assert.equal(activeReservationWhere("r").includes("r.status"), true);
});
