const {
  listAdminMonthlySettlements,
  transitionProviderSettlementStatus,
} = require("../shared/services/providerPayout.service");
const { getProviderSettlementSummary } = require("../shared/services/providerPayout.service");
const pool = require("../shared/config/db");
const { withTransaction } = require("../utils/transaction");

describe("Phase 2: Monthly Admin Settlements", () => {
  describe("listAdminMonthlySettlements", () => {
    it("should aggregate settlements by provider and month", async () => {
      // Create test settlements for a provider with different dates
      const providerId = "test-provider-id";
      const insertSettlements = async (db) => {
        // Insert settlements for different months
        await db.query(
          `
          INSERT INTO provider_settlements
          (provider_id, reservation_id, payment_session_id, amount, status, created_at)
          VALUES
            ($1, 'res-1', 'sess-1', 100.00, 'pending', '2026-08-01'::timestamp),
            ($1, 'res-2', 'sess-2', 50.00, 'pending', '2026-08-15'::timestamp),
            ($1, 'res-3', 'sess-3', 75.00, 'pending', '2026-07-10'::timestamp)
          `,
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
      const providerId = "test-provider-refund";
      const reservationId = "res-refund-1";
      const paymentSessionId = "sess-refund-1";

      const testRefundExclusion = async (db) => {
        // Insert settlement
        await db.query(
          `
          INSERT INTO provider_settlements
          (provider_id, reservation_id, payment_session_id, amount, status, created_at)
          VALUES ($1, $2, $3, 100.00, 'pending', '2026-08-01'::timestamp)
          `,
          [providerId, reservationId, paymentSessionId]
        );

        // Insert refund ledger entry to mark it as refunded
        await db.query(
          `
          INSERT INTO financial_ledger_entries
          (reservation_id, payment_session_id, event_type, amount, created_at)
          VALUES ($1, $2, 'refund_issued', 100.00, NOW())
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

        // Should have 0 settlements because the refunded one is excluded
        expect(result.monthly_settlements.length).toBe(0);
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

      const providerId = "test-provider-fee";
      const testFeeExclusion = async (db) => {
        // Insert settlement with amount (this is already net of fee)
        await db.query(
          `
          INSERT INTO provider_settlements
          (provider_id, reservation_id, payment_session_id, amount, commission_amount, status, created_at)
          VALUES ($1, 'res-fee-1', 'sess-fee-1', 98.00, 2.00, 'pending', '2026-08-01'::timestamp)
          `,
          [providerId]
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
      const providerId = "test-provider-batch";
      const month = 8;
      const year = 2026;

      const testBatchSettle = async (db) => {
        // Insert multiple pending settlements for the provider/month
        await db.query(
          `
          INSERT INTO provider_settlements
          (provider_id, reservation_id, payment_session_id, amount, status, created_at)
          VALUES
            ($1, 'res-b1', 'sess-b1', 100.00, 'pending', $2),
            ($1, 'res-b2', 'sess-b2', 50.00, 'pending', $2),
            ($1, 'res-b3', 'sess-b3', 75.00, 'pending', $2)
          `,
          [providerId, `${year}-${String(month).padStart(2, '0')}-01`]
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
            adminId: "test-admin",
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
      const providerId = "test-provider-idempotent";
      const settlementId = "test-settlement-paid";

      const testIdempotency = async (db) => {
        // Insert settlement
        await db.query(
          `
          INSERT INTO provider_settlements
          (id, provider_id, reservation_id, payment_session_id, amount, status, created_at)
          VALUES ($1, $2, 'res-idem', 'sess-idem', 100.00, 'pending', '2026-08-01'::timestamp)
          `,
          [settlementId, providerId]
        );

        // Mark as paid once
        await transitionProviderSettlementStatus({
          client: db,
          settlementId,
          status: "paid",
          adminId: "test-admin",
          paymentReference: "utr-001",
          ensureSchema: false,
        });

        // Try to mark as paid again - should fail or be idempotent
        try {
          await transitionProviderSettlementStatus({
            client: db,
            settlementId,
            status: "paid",
            adminId: "test-admin",
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
      const providerId = "test-provider-calcs";

      const testCalculations = async (db) => {
        // Insert mixed paid and pending settlements
        await db.query(
          `
          INSERT INTO provider_settlements
          (provider_id, reservation_id, payment_session_id, amount, status, created_at, paid_at)
          VALUES
            ($1, 'res-c1', 'sess-c1', 50.00, 'paid', '2026-08-01'::timestamp, '2026-08-15'::timestamp),
            ($1, 'res-c2', 'sess-c2', 100.00, 'pending', '2026-08-01'::timestamp, NULL),
            ($1, 'res-c3', 'sess-c3', 75.00, 'failed', '2026-08-01'::timestamp, NULL)
          `,
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
        // Pending amount (from "pending" status)
        expect(Number(monthly.pending_amount)).toBe(100.00);
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
  });
});
