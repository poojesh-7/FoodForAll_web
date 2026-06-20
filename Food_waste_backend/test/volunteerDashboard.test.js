const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

process.env.APP_ENV = "production";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
process.env.CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || "test";
process.env.CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || "test";
process.env.CASHFREE_ENV = process.env.CASHFREE_ENV || "sandbox";
process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "test";
process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "test";
process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "test";

const pool = require("../shared/config/db");

function stubModule(relativePath, exports) {
  require.cache[require.resolve(relativePath)] = {
    id: require.resolve(relativePath),
    filename: require.resolve(relativePath),
    loaded: true,
    exports,
  };
}

const queueStub = {
  add: async () => undefined,
  remove: async () => undefined,
};

stubModule("../queues/pickup.queue", queueStub);
stubModule("../queues/delivery.queue", queueStub);
stubModule("../queues/refund.queue", queueStub);
stubModule("../queues/notification.queue", queueStub);
stubModule("../shared/services/payment.service", {
  refundReliabilityDeposit: async () => undefined,
});
stubModule("../shared/services/trustEnforcement.service", {
  recordReservationLifecycleTrustEvents: async () => undefined,
});
stubModule("../shared/services/realtime.service", {
  publishReservationUpdated: async () => undefined,
  publishTaskAvailabilityUpdated: async () => undefined,
  publishToUsers: async () => undefined,
  publishVolunteerUpdated: async () => undefined,
});

const volunteerController = require("../controllers/volunteer.controller");

const volunteerId = "11111111-1111-4111-8111-111111111111";

function activeTask(overrides = {}) {
  return {
    reservation_id: "22222222-2222-4222-8222-222222222222",
    quantity_reserved: 1,
    pickup_type: "ngo",
    status: "reserved",
    task_status: "in_progress",
    pickup_code: "1234",
    assigned_at: "2026-06-20T10:00:00.000Z",
    picked_up_at: null,
    completed_at: null,
    listing_id: "33333333-3333-4333-8333-333333333333",
    title: "Rice meals",
    latitude: "12.9716",
    longitude: "77.5946",
    restaurant_latitude: "12.9716",
    restaurant_longitude: "77.5946",
    pickup_start_time: "2026-06-20T10:00:00.000Z",
    pickup_end_time: "2026-06-20T12:00:00.000Z",
    quantity_unit: "servings",
    custom_quantity_unit: null,
    images: [],
    primary_image_url: null,
    averageRating: 0,
    totalReviews: 0,
    average_rating: 0,
    total_reviews: 0,
    provider_id: "44444444-4444-4444-8444-444444444444",
    provider_name: "Provider",
    provider_profile_image_url: null,
    restaurant_name: "Provider Kitchen",
    provider_phone: "+911234567890",
    ngo_name: "Care NGO",
    ngo_profile_image_url: null,
    ngo_latitude: "12.9",
    ngo_longitude: "77.5",
    ...overrides,
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function runDashboardWithTaskRow(taskRow) {
  const originalQuery = pool.query;
  const calls = [];

  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    const text = String(sql);

    if (text.includes("FROM volunteers v")) {
      return {
        rows: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            organization_name: "Care NGO",
            ngo_profile_image_url: null,
            urgent_flag: false,
            volunteer_status: "active",
            active_listings: "1",
            total_volunteers: "1",
          },
        ],
      };
    }

    if (
      text.includes("FROM reservations r") &&
      text.includes("WHERE r.assigned_volunteer_id=$1") &&
      text.includes("LIMIT 1")
    ) {
      return { rows: taskRow ? [taskRow] : [] };
    }

    if (text.includes("FROM volunteer_stats")) {
      return { rows: [{ total_completed: 3, avg_completion_time: 600 }] };
    }

    if (text.includes("FROM volunteer_requests vr")) {
      return { rows: [] };
    }

    throw new Error(`Unexpected dashboard query: ${text}`);
  };

  try {
    const req = { user: { id: volunteerId, role: "volunteer" } };
    const res = createResponse();

    await volunteerController.getDashboard(req, res);

    return { res, calls };
  } finally {
    pool.query = originalQuery;
  }
}

test("volunteer dashboard returns active task when one exists", async () => {
  const { res } = await runDashboardWithTaskRow(activeTask());

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.current_task.reservation_id, activeTask().reservation_id);
  assert.equal(res.body.current_task.task_status, "in_progress");
});

test("volunteer dashboard does not return completed task as current", async () => {
  const { res } = await runDashboardWithTaskRow(
    activeTask({
      status: "completed",
      task_status: "completed",
      completed_at: "2026-06-20T11:00:00.000Z",
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.current_task, null);
});

test("volunteer dashboard does not return delivered task as current", async () => {
  const { res } = await runDashboardWithTaskRow(
    activeTask({
      status: "picked_up",
      task_status: "delivered",
      completed_at: "2026-06-20T11:00:00.000Z",
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.current_task, null);
});

test("volunteer dashboard does not return expired task as current", async () => {
  const { res } = await runDashboardWithTaskRow(
    activeTask({
      status: "expired",
      task_status: "in_progress",
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.current_task, null);
});

test("volunteer dashboard does not return failed task as current", async () => {
  const { res } = await runDashboardWithTaskRow(
    activeTask({
      status: "failed",
      task_status: "picked_from_provider",
    })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.current_task, null);
});

test("volunteer dashboard returns successfully with no active task", async () => {
  const { res } = await runDashboardWithTaskRow(null);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.current_task, null);
  assert.equal(res.body.stats.total_completed, 3);
});

test("volunteer dashboard active task SQL excludes terminal reservations", async () => {
  const controllerPath = path.join(
    __dirname,
    "..",
    "controllers",
    "volunteer.controller.js"
  );
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /GROUP BY n\.id, ngo_user\.profile_image_url, v\.status/);
  assert.match(source, /WHERE r\.assigned_volunteer_id=\$1\s+AND r\.status='reserved'\s+AND r\.task_status IN \(\$\{ACTIVE_VOLUNTEER_TASK_STATUS_SQL\}\)/);
});
