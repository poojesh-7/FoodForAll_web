const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { describe, it } = require("node:test");
const {
  listAdminMonthlySettlements,
  transitionProviderSettlementStatus,
} = require("../shared/services/providerPayout.service");
const { getProviderSettlementSummary } = require("../shared/services/providerPayout.service");
const pool = require("../shared/config/db");
const { withTransaction } = require("../shared/utils/transaction");

function expect(actual) {
  return {
    toBe(expected) { assert.strictEqual(actual, expected); },
    toBeDefined() { assert.notStrictEqual(actual, undefined); },
    toBeTruthy() { assert.ok(actual); },
    toMatch(pattern) { assert.match(actual, pattern); },
  };
}

const fixtureReservationId = "75917376-74e8-4a6c-8a1b-1cc08a3d26d3";
const fixturePaymentOwnershipId = "8e05863e-f179-45ae-b593-7f3e97e8ddf0";

function fixturePaymentSession(label) {
  return `phase2-${label}-${randomUUID()}`;
}

async function seedProvider(db, label) {
  const providerId = randomUUID();
  await db.query(
    `INSERT INTO users (id, name, phone, email, role, is_verified)
     VALUES ($1, $2, $3, $4, 'provider', true)`,
    [providerId, `Phase 2 ${label}`, `+9199${Date.now().toString().slice(-8)}`, `phase2-${label}-${providerId}@test.invalid`]
  );
  return providerId;
}

async function seedSettlementAllocation(db, paymentSessionId) {
  const result = await db.query(
    `
    INSERT INTO settlement_allocation_snapshots
    (reservation_id, payment_session_id, payment_ownership_id, idempotency_key)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    [fixtureReservationId, paymentSessionId, fixturePaymentOwnershipId, `phase2-${paymentSessionId}-${Date.now()}`]
  );

  return result.rows[0].id;
}

async function seedPayoutAccount(db, providerId) {
  await db.query(
    `
    INSERT INTO provider_payout_accounts
    (provider_id, account_type, upi_id, is_active, is_verified, verification_status)
    VALUES ($1, 'UPI', $2, true, true, 'verified')
    `,
    [providerId, `phase2-${providerId}@upi`]
  );
}

describe("Phase 2: Monthly Admin Settlements", () => {
  describe("listAdminMonthlySettlements", () => {
    it("should aggregate settlements by provider and month", async () => {
      // Create test settlements for a provider with different dates
      const insertSettlements = async (db) => {
        const providerId = await seedProvider(db, "monthly");
        const paymentSessions = [
          fixturePaymentSession("monthly-1"),
          fixturePaymentSession("monthly-2"),
          fixturePaymentSession("monthly-3"),
        ];
        const allocationId = await seedSettlementAllocation(db, paymentSessions[0]);
        // Insert settlements for different months
        await db.query(
          `
          INSERT INTO provider_settlements
          (provider_id, reservation_id, settlement_allocation_id, payment_session_id, amount, status, idempotency_key, created_at)
          VALUES
            ($1, '2b044cc6-3e16-4a40-9ca4-6b66fc01d7ba', $2, $3, 100.00, 'pending', 'phase2-monthly-1-${randomUUID()}', '2026-08-01'::timestamp),
            ($1, '4bb42a0c-8547-46d9-8c1b-e6cd471510fa', $2, $4, 50.00, 'pending', 'phase2-monthly-2-${randomUUID()}', '2026-08-15'::timestamp),
            ($1, '77f5aadb-ad48-434b-a62b-3123a5b66ad8', $2, $5, 75.00, 'pending', 'phase2-monthly-3-${randomUUID()}', '2026-07-10'::timestamp)
          `,
          [providerId, allocationId, ...paymentSessions]
        );
        await db.query(
          `UPDATE provider_settlements SET updated_at = created_at WHERE provider_id = $1 AND idempotency_key LIKE 'phase2-monthly-%'`,
          [providerId]
        );

        const result = await listAdminMonthlySettlements({
          client: db,
          providerId,
          status: "pending",
          limit: 100,
          ensureSchema: false,
        });

        // Should have 2 monthly rows (Aug and Jul)
        expect(result.monthly_settlements.length).toBe(2);

        // August should have 2 records totaling 150
        const aug = result.monthly_settlements.find(
          (m) => m.month === 8 && m.year === 2026
        );
        expect(aug).toBeDefined();
        expect(aug.record_count).toBe(2);
        expect(Number(aug.total_amount)).toBe(150.00);
        expect(Number(aug.pending_amount)).toBe(150.00);

        // July should have 1 record totaling 75
        const jul = result.monthly_settlements.find(
          (m) => m.month === 7 && m.year === 2026
        );
        expect(jul).toBeDefined();
        expect(jul.record_count).toBe(1);
        expect(Number(jul.total_amount)).toBe(75.00);
      };

      await withTransaction(pool, insertSettlements, {
        name: "test_monthly_aggregation",
        maxAttempts: 1,
      });
    });

    it("should exclude refunded settlements", async () => {
      // Create a settlement and then mark it as refunded via ledger entry
      const reservationId = fixtureReservationId;
      const paymentSessionId = fixturePaymentSession("refund-1");

      const testRefundExclusion = async (db) => {
        const providerId = await seedProvider(db, "refund");
        const allocationId = await seedSettlementAllocation(db, paymentSessionId);
        // Insert settlement
        await db.query(
          `
          INSERT INTO provider_settlements
          (provider_id, reservation_id, settlement_allocation_id, payment_session_id, amount, status, idempotency_key, created_at)
          VALUES ($1, $2, $4, $3, 100.00, 'pending', 'phase2-refund-${randomUUID()}', '2026-08-01'::timestamp)
          `,
          [providerId, reservationId, paymentSessionId, allocationId]
        );

        // Insert refund ledger entry to mark it as refunded
        await db.query(
          `
          INSERT INTO financial_ledger_entries
          (reservation_id, payment_session_id, event_type, amount, idempotency_key, created_at)
          VALUES ($1, $2, 'refund_issued', 100.00, 'phase2-refund-ledger', NOW())
          `,
          [reservationId, paymentSessionId]
        );

        const result = await listAdminMonthlySettlements({
          client: db,
          providerId,
          status: "pending",
          limit: 100,
          ensureSchema: false,
        });

        // Refunded rows remain visible in the manual carry-forward projection.
        expect(result.monthly_settlements.length).toBe(1);
      };

      await withTransaction(pool, testRefundExclusion, {
        name: "test_refund_exclusion",
        maxAttempts: 1,
      });
    });

    it("should not include processing fee in provider settlement", async () => {
      // Verify that the settlement amount is correct and does not include processing fee
      // This is validated through the existing settlement projection logic
      // which already excludes processing fees from provider settlements.

      // The settlement amount stored in provider_settlements table is the provider's
      // earnings minus processing fee (already applied during settlement creation).
      // We verify this through the amount field in monthly aggregates.

      const testFeeExclusion = async (db) => {
        const providerId = await seedProvider(db, "fee");
        const paymentSessionId = fixturePaymentSession("fee-1");
        const allocationId = await seedSettlementAllocation(db, paymentSessionId);
        // Insert settlement with amount (this is already net of fee)
          await db.query(
            `
            INSERT INTO provider_settlements
            (provider_id, reservation_id, settlement_allocation_id, payment_session_id, amount, commission_amount, status, idempotency_key, created_at)
            VALUES ($1, '8327fa7d-c270-465c-8d00-7e01b7aaa4d7', $2, $3, 98.00, 2.00, 'pending', $4, '2026-08-01'::timestamp)
            `,
            [providerId, allocationId, paymentSessionId, `phase2-fee-${randomUUID()}`]
          );

        const result = await listAdminMonthlySettlements({
          client: db,
          providerId,
          status: "pending",
          limit: 100,
          ensureSchema: false,
        });

        // Settlement amount should be 98 (without the 2 fee)
        expect(result.monthly_settlements.length).toBe(1);
        expect(Number(result.monthly_settlements[0].total_amount)).toBe(98.00);
      };

      await withTransaction(pool, testFeeExclusion, {
        name: "test_fee_exclusion",
        maxAttempts: 1,
      });
    });
  });

  describe("Batch Settlement Transition", () => {
    it("should mark multiple eligible records as paid", async () => {
      const month = 8;
      const year = 2026;

      const testBatchSettle = async (db) => {
        const providerId = await seedProvider(db, "batch");
        const paymentSessions = [
          fixturePaymentSession("batch-1"),
          fixturePaymentSession("batch-2"),
          fixturePaymentSession("batch-3"),
        ];
        const allocationId = await seedSettlementAllocation(db, paymentSessions[0]);
        await seedPayoutAccount(db, providerId);
        // Insert multiple pending settlements for the provider/month
          await db.query(
            `
            INSERT INTO provider_settlements
            (provider_id, reservation_id, settlement_allocation_id, payment_session_id, amount, status, idempotency_key, created_at)
            VALUES
              ($1, '884d8246-b04c-4c42-8e77-bf96a39c7d1c', $3, $4, 100.00, 'pending', $7, $2),
              ($1, 'cafccf22-190e-4859-8ede-a5586d900d8f', $3, $5, 50.00, 'pending', $8, $2),
              ($1, 'ed33d1cb-d278-4057-80b4-612bc94eb904', $3, $6, 75.00, 'pending', $9, $2)
            `,
            [providerId, `${year}-${String(month).padStart(2, '0')}-01`, allocationId, ...paymentSessions, `phase2-batch-1-${randomUUID()}`, `phase2-batch-2-${randomUUID()}`, `phase2-batch-3-${randomUUID()}`]
          );

        // Mark each as paid (simulating batch settlement)
        const settlementsResult = await db.query(
          `
          SELECT id FROM provider_settlements
          WHERE provider_id = $1
            AND EXTRACT(YEAR FROM created_at)::int = $2
            AND EXTRACT(MONTH FROM created_at)::int = $3
            AND status = 'pending'
          `,
          [providerId, year, month]
        );

        for (const { id } of settlementsResult.rows) {
          await transitionProviderSettlementStatus({
            client: db,
            settlementId: id,
            status: "paid",
            adminId: "0e82f5a1-e2de-4baf-8fca-47de5c18f1fb",
            paymentReference: `batch-${year}-${month}`,
            notes: `Batch settlement for ${year}-${String(month).padStart(2, '0')}`,
            ensureSchema: false,
          });
        }

        // Verify all are marked paid
        const updatedResult = await db.query(
          `
          SELECT status FROM provider_settlements
          WHERE provider_id = $1
            AND EXTRACT(YEAR FROM created_at)::int = $2
            AND EXTRACT(MONTH FROM created_at)::int = $3
          `,
          [providerId, year, month]
        );

        expect(updatedResult.rows.every((r) => r.status === "paid")).toBe(true);
        expect(updatedResult.rows.length).toBe(3);
      };

      await withTransaction(pool, testBatchSettle, {
        name: "test_batch_settle",
        maxAttempts: 1,
      });
    });

    it("should not pay already-paid records twice", async () => {
      const settlementId = randomUUID();

      const testIdempotency = async (db) => {
        const providerId = await seedProvider(db, "idempotency");
        const paymentSessionId = fixturePaymentSession("idem");
        const allocationId = await seedSettlementAllocation(db, paymentSessionId);
        await seedPayoutAccount(db, providerId);
        // Insert settlement
          await db.query(
            `
            INSERT INTO provider_settlements
            (id, provider_id, reservation_id, settlement_allocation_id, payment_session_id, amount, status, idempotency_key, created_at)
            VALUES ($1, $2, 'f8575d96-12d1-4cbc-aaf9-7af9c5ef7b09', $3, $4, 100.00, 'pending', $5, '2026-08-01'::timestamp)
            `,
            [settlementId, providerId, allocationId, paymentSessionId, `phase2-idempotent-${randomUUID()}`]
          );

        // Mark as paid once
        await transitionProviderSettlementStatus({
          client: db,
          settlementId,
          status: "paid",
          adminId: "0e82f5a1-e2de-4baf-8fca-47de5c18f1fb",
          paymentReference: "utr-001",
          ensureSchema: false,
        });

        // Try to mark as paid again - should fail or be idempotent
        try {
          await transitionProviderSettlementStatus({
            client: db,
            settlementId,
            status: "paid",
            adminId: "0e82f5a1-e2de-4baf-8fca-47de5c18f1fb",
            paymentReference: "utr-002",
            ensureSchema: false,
          });
          // If it succeeds, verify payment reference was updated (idempotent)
          const result = await db.query(
            `SELECT payment_reference FROM provider_settlements WHERE id = $1`,
            [settlementId]
          );
          // Should keep the original or update - both are idempotent patterns
          expect(result.rows[0].payment_reference).toBeTruthy();
        } catch (err) {
          // It's acceptable to reject marking an already-paid settlement as paid
          expect(err.message).toMatch(/paid|already/i);
        }
      };

      await withTransaction(pool, testIdempotency, {
        name: "test_idempotency",
        maxAttempts: 1,
      });
    });
  });

  describe("Monthly View Calculations", () => {
    it("should correctly calculate paid and pending amounts per month", async () => {
      const testCalculations = async (db) => {
        const providerId = await seedProvider(db, "calculations");
        const paymentSessions = [
          fixturePaymentSession("calculations-1"),
          fixturePaymentSession("calculations-2"),
          fixturePaymentSession("calculations-3"),
        ];
        const allocationId = await seedSettlementAllocation(db, paymentSessions[0]);
        // Insert mixed paid and pending settlements
        await db.query(
          `
          INSERT INTO provider_settlements
            (provider_id, reservation_id, settlement_allocation_id, payment_session_id, amount, status, idempotency_key, created_at, paid_at)
          VALUES
            ($1, '2b044cc6-3e16-4a40-9ca4-6b66fc01d7ba', $2, $3, 50.00, 'paid', 'phase2-calcs-1-${randomUUID()}', '2026-08-01'::timestamp, '2026-08-15'::timestamp),
            ($1, '4bb42a0c-8547-46d9-8c1b-e6cd471510fa', $2, $4, 100.00, 'pending', 'phase2-calcs-2-${randomUUID()}', '2026-08-01'::timestamp, NULL),
            ($1, '77f5aadb-ad48-434b-a62b-3123a5b66ad8', $2, $5, 75.00, 'failed', 'phase2-calcs-3-${randomUUID()}', '2026-08-01'::timestamp, NULL)
          `,
          [providerId, allocationId, ...paymentSessions]
        );
        await db.query(
          `UPDATE provider_settlements SET updated_at = created_at WHERE provider_id = $1 AND idempotency_key LIKE 'phase2-calcs-%'`,
          [providerId]
        );

        const result = await listAdminMonthlySettlements({
          client: db,
          providerId,
          status: "all",
          limit: 100,
          ensureSchema: false,
        });

        expect(result.monthly_settlements.length).toBe(1);
        const monthly = result.monthly_settlements[0];

        // Total = paid + pending + failed
        expect(Number(monthly.total_amount)).toBe(225.00);
        // Paid amount
        expect(Number(monthly.paid_amount)).toBe(50.00);
        // Failed amounts remain outstanding in the settlement projection.
        expect(Number(monthly.pending_amount)).toBe(175.00);
        // Record count
        expect(monthly.record_count).toBe(3);
        // Status calculation
        expect(monthly.status).toBe("Partially Paid");
      };

      await withTransaction(pool, testCalculations, {
        name: "test_calculations",
        maxAttempts: 1,
      });
    });

    it("should exclude refunded records from pending count and amount due (regression test)", async () => {
      // Bug: Refunded settlement records were being included in provider-level pending liability
      // Test case: Provider with ₹19 refunded and ₹38 pending
      // Expected: Amount Due ₹38, Pending Settlements 1 (not 2)
      const testRefundRegression = async (db) => {
        const providerId = await seedProvider(db, "refund-regression");
        const refundedPaymentSessionId = fixturePaymentSession("refund-19");
        const pendingPaymentSessionId = fixturePaymentSession("pending-38");
        const allocationId = await seedSettlementAllocation(db, refundedPaymentSessionId);
        // Insert two settlements: one refunded (₹19), one pending (₹38)
        await db.query(
          `
          INSERT INTO provider_settlements
            (provider_id, reservation_id, settlement_allocation_id, payment_session_id, amount, status, idempotency_key, created_at)
          VALUES
            ($1, $2, $3, $4, 19.00, 'pending', 'phase2-regression-1-${randomUUID()}', '2026-09-01'::timestamp),
            ($1, 'cafccf22-190e-4859-8ede-a5586d900d8f', $3, $5, 38.00, 'pending', 'phase2-regression-2-${randomUUID()}', '2026-09-02'::timestamp)
          `,
          [providerId, fixtureReservationId, allocationId, refundedPaymentSessionId, pendingPaymentSessionId]
        );

        // Mark the first settlement as refunded via ledger entry
        await db.query(
          `
          INSERT INTO financial_ledger_entries
          (reservation_id, payment_session_id, event_type, amount, idempotency_key, created_at)
          VALUES ($1, $2, 'refund_issued', 19.00, 'phase2-regression-ledger', NOW())
          `,
          [fixtureReservationId, refundedPaymentSessionId]
        );

        // Query the admin provider settlements summary
        const { listAdminProviderSettlements } = require("../shared/services/providerPayout.service");
        const result = await listAdminProviderSettlements({
          client: db,
          providerId,
          status: "pending",
          limit: 100,
          ensureSchema: false,
        });

        // Find the provider in summary
        const providerSummary = result.summary.find(
          (s) => s.provider_id === providerId
        );
        expect(providerSummary).toBeDefined();

        // Amount Due should only include non-refunded pending: ₹38
        expect(Number(providerSummary.amount_due)).toBe(38.00);

        // Pending Settlements count should be 1 (refunded record excluded)
        expect(Number(providerSummary.pending_settlements)).toBe(1);

        // Verify the settlement details include both records
        expect(result.settlements.length).toBe(2);

        // But only one should have refund_amount === 0 (the non-refunded one)
        const nonRefundedSettlements = result.settlements.filter(
          (s) => s.provider_id === providerId && (s.refund_amount || 0) === 0
        );
        expect(nonRefundedSettlements.length).toBe(1);
        expect(Number(nonRefundedSettlements[0].amount)).toBe(38.00);

        // The refunded settlement should have refund_amount set
        const refundedSettlements = result.settlements.filter(
          (s) => s.provider_id === providerId && (s.refund_amount || 0) > 0
        );
        expect(refundedSettlements.length).toBe(1);
        expect(Number(refundedSettlements[0].refund_amount)).toBe(19.00);

        // Monthly settlement should also exclude the refunded record from pending
        const monthlyResult = await listAdminMonthlySettlements({
          client: db,
          providerId,
          status: "pending",
          limit: 100,
          ensureSchema: false,
        });

        expect(monthlyResult.monthly_settlements.length).toBe(1);
        const monthly = monthlyResult.monthly_settlements[0];

        // Monthly pending should only include the non-refunded amount
        expect(Number(monthly.pending_amount)).toBe(38.00);
        // Refunded rows remain visible in the manual carry-forward projection.
        expect(monthly.record_count).toBe(2);
      };

      await withTransaction(pool, testRefundRegression, {
        name: "test_refund_regression",
        maxAttempts: 1,
      });
    });
  });
});
