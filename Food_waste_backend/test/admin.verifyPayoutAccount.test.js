const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const payoutServicePath = path.resolve(__dirname, "../shared/services/providerPayout.service.js");
const observabilityServicePath = path.resolve(__dirname, "../shared/services/observability.service.js");
const notificationServicePath = path.resolve(__dirname, "../shared/services/operationalNotification.service.js");

function clearAdminControllerCache() {
  delete require.cache[require.resolve("../admin/admin.controller.js")];
}

function setupTestStubs() {
  const payoutService = require(payoutServicePath);
  const observabilityService = require(observabilityServicePath);
  const notificationService = require(notificationServicePath);

  observabilityService.recordOperationalEvent = async () => {
    // noop audit recording stub
  };
  notificationService.notifyProviderPayoutVerificationApproved = async () => {};

  return payoutService;
}

test("T-FIN-2.3A admin verify payout account route succeeds and records audit event", async () => {
  const payoutService = setupTestStubs();
  clearAdminControllerCache();

  let capturedVerifyArgs = null;
  payoutService.verifyProviderPayoutAccount = async ({ payoutAccountId, adminId }) => {
    capturedVerifyArgs = { payoutAccountId, adminId };
    return {
      id: payoutAccountId,
      provider_id: "provider-123",
      account_type: "UPI",
      upi_id: "verify@upi",
      account_holder_name: "Test Provider",
      bank_account_number: null,
      ifsc_code: null,
      is_active: true,
      verification_status: "verified",
      is_verified: true,
      verified_at: "2026-06-24T00:00:00.000Z",
      verified_by: adminId,
      rejection_reason: null,
      created_at: "2026-06-24T00:00:00.000Z",
      updated_at: "2026-06-24T00:00:00.000Z",
    };
  };

  const adminController = require("../admin/admin.controller.js");

  const req = {
    params: { id: "68846afe-535e-443c-abcc-1fe544af0dc0" },
    user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  };

  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  };

  await adminController.verifyProviderPayoutAccount(req, res);

  assert.equal(statusCode, 200);
  assert.equal(responseData.message, "Payout account verified");
  assert.equal(responseData.account.id, req.params.id);
  assert.deepEqual(capturedVerifyArgs, {
    payoutAccountId: req.params.id,
    adminId: req.user.id,
  });
});
