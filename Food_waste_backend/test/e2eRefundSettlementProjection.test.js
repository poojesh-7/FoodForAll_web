const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

const pool = require("../shared/config/db");
const {
  getFinancialSummary,
  recordFinancialOperationLedgerStatus,
} = require("../shared/services/financialLedger.service");
const {
  getProviderSettlementSummary,
  listAdminProviderSettlements,
  applyManualRefundCarryForward,
  transitionProviderSettlementStatus,
} = require("../shared/services/providerPayout.service");

const id = () => crypto.randomUUID();

async function insertReservationGraph(client, {
  providerId,
  userId,
  reservationId,
  paymentId,
  ownershipId,
  allocationId,
  sessionId,
  foodAmount,
  depositAmount,
  providerAmount,
  commissionAmount,
  settlementId,
  paymentStatus = "paid",
  depositStatus = "held",
  createdAt = null,
}) {
  await client.query(
    `INSERT INTO reservations (id, user_id, quantity_reserved, status, pickup_type, payment_status, total_amount)
     VALUES ($1, $2, 1, 'reserved', 'self', $3, $4)`,
    [reservationId, userId, paymentStatus, foodAmount + depositAmount],
  );
  await client.query(
    `INSERT INTO payments (id, reservation_id, order_id, payment_session_id, amount, status, refund_status, food_amount, reliability_deposit_amount, reliability_deposit_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [paymentId, reservationId, `e2e-${paymentId}`, sessionId, foodAmount + depositAmount, paymentStatus, paymentStatus === "refunded" ? "refunded" : "not_requested", foodAmount, depositAmount, depositStatus],
  );
  await client.query(
    `INSERT INTO payment_ownership
      (id, reservation_id, payment_session_id, payer_user_id, payer_role, provider_id, beneficiary_user_id, beneficiary_role,
       platform_account_id, deposit_owner_user_id, deposit_owner_role, refund_target_user_id, refund_target_role,
       food_amount, deposit_amount, commission_amount, currency, ownership_version, snapshot_hash, source_metadata)
     VALUES ($1,$2,$3,$4,'user',$5,$5,'provider','platform',$4,'user',$4,'user',$6,$7,$8,'INR',1,$9,'{}'::jsonb)`,
    [ownershipId, reservationId, sessionId, userId, providerId, foodAmount, depositAmount, commissionAmount, id()],
  );
  await client.query(
    `INSERT INTO settlement_allocation_snapshots
      (id, reservation_id, payment_id, payment_session_id, payment_ownership_id, commission_percent, commission_amount,
       provider_amount, platform_amount, deposit_amount, tax_amount, food_amount, total_amount, currency, settlement_version,
       idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,5,$6,$7,$8,$9,0,$10,$11,'INR',1,$12,'{}'::jsonb)`,
    [allocationId, reservationId, paymentId, sessionId, ownershipId, commissionAmount, providerAmount, commissionAmount, depositAmount, foodAmount, foodAmount + depositAmount, id()],
  );
  await client.query(
    `INSERT INTO provider_settlements
      (id, provider_id, reservation_id, payment_id, payment_session_id, settlement_allocation_id, amount, commission_amount, currency, status, paid_amount, idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'INR','pending',0,$9,'{}'::jsonb)`,
    [settlementId, providerId, reservationId, paymentId, sessionId, allocationId, providerAmount, commissionAmount, id()],
  );
  if (createdAt) {
    await client.query(
      `UPDATE provider_settlements SET created_at=$2, updated_at=$2 WHERE id=$1`,
      [settlementId, createdAt],
    );
  }
}

test("E2E refund and settlement projection values", async () => {
  const client = await pool.connect();
  const providerId = id();
  const userId = id();
  const first = {
    providerId,
    userId,
    reservationId: id(),
    paymentId: id(),
    ownershipId: id(),
    allocationId: id(),
    sessionId: `e2e-${id()}`,
    settlementId: id(),
  };

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, name, role, auth_provider, email_verified) VALUES ($1, 'E2E Provider', 'provider', 'otp', false), ($2, 'E2E User', 'user', 'otp', false)`,
      [providerId, userId],
    );
    await client.query(
      `INSERT INTO provider_payout_accounts (provider_id, account_type, upi_id, is_active, is_verified, verification_status)
       VALUES ($1, 'UPI', $2, true, true, 'verified')`,
      [providerId, `e2e-${id()}@upi`],
    );
    await insertReservationGraph(client, {
      ...first,
      foodAmount: 100,
      depositAmount: 20,
      providerAmount: 95,
      commissionAmount: 5,
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    await client.query(
      `INSERT INTO financial_ledger_entries
        (reservation_id, payment_id, payment_session_id, payment_ownership_id, event_type, amount, currency, accounting_category, idempotency_key, metadata)
       VALUES ($1,$2,$3,$4,'deposit_collected',20,'INR','reliability_deposit_held',$5,'{}'::jsonb)`,
      [first.reservationId, first.paymentId, first.sessionId, first.ownershipId, `e2e-deposit-${id()}`],
    );

    await recordFinancialOperationLedgerStatus({
      client,
      operation: {
        id: id(),
        reservation_id: first.reservationId,
        payment_session_id: first.sessionId,
        payment_ownership_id: first.ownershipId,
        operation_type: "payment_refund",
        operation_source: "provider_fault_food_not_received",
        actor_user_id: userId,
        actor_role: "user",
        amount: 120,
        currency: "INR",
        metadata: {
          refunds: [
            { refundType: "food", amount: 100 },
            { refundType: "deposit", amount: 20 },
          ],
          provider_refund_amount: 100,
        },
      },
      status: "succeeded",
      refundId: `refund-${id()}`,
    });
    await client.query(
      `UPDATE payments SET status='refunded', refund_status='refunded', reliability_deposit_status='refunded' WHERE id=$1`,
      [first.paymentId],
    );
    await client.query(
      `UPDATE reservations SET payment_status='refunded' WHERE id=$1`,
      [first.reservationId],
    );

    const ledger = await client.query(
      `SELECT event_type, accounting_category, amount FROM financial_ledger_entries WHERE reservation_id=$1 ORDER BY event_type`,
      [first.reservationId],
    );
    const providerAfterRefund = await getProviderSettlementSummary({ client, providerId, ensureSchema: false });

    const future = (amount) => ({
      providerId,
      userId,
      reservationId: id(),
      paymentId: id(),
      ownershipId: id(),
      allocationId: id(),
      sessionId: `e2e-${id()}`,
      settlementId: id(),
      amount,
    });
    const second = future(50);
    const third = future(60);
    await insertReservationGraph(client, { ...second, foodAmount: 50, depositAmount: 0, providerAmount: 50, commissionAmount: 0, createdAt: "2026-08-02T00:00:00.000Z" });
    await insertReservationGraph(client, { ...third, foodAmount: 60, depositAmount: 0, providerAmount: 60, commissionAmount: 0, createdAt: "2026-08-03T00:00:00.000Z" });
    const paidSecond = await transitionProviderSettlementStatus({
      client,
      settlementId: second.settlementId,
      status: "paid",
      adminId: providerId,
      paymentReference: "e2e-paid-50",
      paidAmount: 50,
      paidAt: "2026-08-04T00:00:00.000Z",
      ensureSchema: false,
    });
    const paidThird = await transitionProviderSettlementStatus({
      client,
      settlementId: third.settlementId,
      status: "paid",
      adminId: providerId,
      paymentReference: "e2e-paid-60",
      paidAmount: 60,
      paidAt: "2026-08-05T00:00:00.000Z",
      ensureSchema: false,
    });
    const recoveryLedger = await client.query(
      `SELECT event_type, amount, refund_id FROM financial_ledger_entries
       WHERE event_type = 'provider_refund_liability_released'
       AND provider_settlement_id IN ($1, $2)
       ORDER BY created_at`,
      [second.settlementId, third.settlementId],
    );

    const providerAfterFutureSettlements = await getProviderSettlementSummary({ client, providerId, ensureSchema: false });
    const records = await listAdminProviderSettlements({ client, providerId, status: "all", limit: 50, ensureSchema: false });
    const financialAfterFutureSettlements = await getFinancialSummary({ client, limit: 50 });

    assert.equal(Number(providerAfterRefund.earnings.pending), 0);
    assert.equal(Number(providerAfterRefund.refunds.pending), 95);
    const actualReleased = recoveryLedger.rows.reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0,
    );
    const actualProviderPayable =
      Number(paidSecond.amount || 0) +
      Number(paidThird.amount || 0) -
      actualReleased;
    assert.equal(actualReleased, 95);
    assert.equal(actualProviderPayable, 15);
    assert.equal(Number(providerAfterFutureSettlements.earnings.paid), 15);
    assert.equal(Number(providerAfterFutureSettlements.refunds.pending), 0);
    assert.equal(Number(financialAfterFutureSettlements.totals.total_provider_liabilities), 0);
    assert.equal(Number(financialAfterFutureSettlements.totals.total_provider_paid), 15);
    assert.equal(Number(financialAfterFutureSettlements.totals.total_refund_volume), 95);
    assert.equal(Number(financialAfterFutureSettlements.provider_refund_liability.outstanding), 0);
    assert.equal(ledger.rows.find((row) => row.event_type === "provider_refund_liability_issued")?.amount, "95.00");
    assert.equal(ledger.rows.find((row) => row.event_type === "deposit_refunded")?.amount, "20.00");
    assert.deepEqual(
      recoveryLedger.rows.map((row) => Number(row.amount)).sort((a, b) => a - b),
      [45, 50],
    );
    assert.equal(paidSecond.status, "paid");
    assert.equal(paidThird.status, "paid");
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

test("E2E carry-forward cascades across every eligible pending settlement", async () => {
  const client = await pool.connect();
  const providerId = id();
  const userId = id();
  const source = {
    providerId,
    userId,
    reservationId: id(),
    paymentId: id(),
    ownershipId: id(),
    allocationId: id(),
    sessionId: `e2e-${id()}`,
    settlementId: id(),
  };
  const future = (amount, createdAt) => ({
    providerId,
    userId,
    reservationId: id(),
    paymentId: id(),
    ownershipId: id(),
    allocationId: id(),
    sessionId: `e2e-${id()}`,
    settlementId: id(),
    amount,
    createdAt,
  });
  const first = future(38, "2026-09-02T00:00:00.000Z");
  const second = future(9.5, "2026-09-03T00:00:00.000Z");
  const third = future(28.5, "2026-09-04T00:00:00.000Z");

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, name, role, auth_provider, email_verified) VALUES ($1, 'Cascade Provider', 'provider', 'otp', false), ($2, 'Cascade User', 'user', 'otp', false)`,
      [providerId, userId],
    );
    await client.query(
      `INSERT INTO provider_payout_accounts (provider_id, account_type, upi_id, is_active, is_verified, verification_status)
       VALUES ($1, 'UPI', $2, true, true, 'verified')`,
      [providerId, `e2e-${id()}@upi`],
    );
    await insertReservationGraph(client, {
      ...source,
      foodAmount: 57,
      depositAmount: 0,
      providerAmount: 57,
      commissionAmount: 0,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    await recordFinancialOperationLedgerStatus({
      client,
      operation: {
        id: id(),
        reservation_id: source.reservationId,
        payment_session_id: source.sessionId,
        payment_ownership_id: source.ownershipId,
        operation_type: "payment_refund",
        operation_source: "provider_fault_food_not_received",
        actor_user_id: userId,
        actor_role: "user",
        amount: 57,
        currency: "INR",
        metadata: { provider_refund_amount: 57 },
      },
      status: "succeeded",
      refundId: `refund-${id()}`,
    });
    await insertReservationGraph(client, {
      ...first,
      foodAmount: 38,
      depositAmount: 0,
      providerAmount: 38,
      commissionAmount: 0,
      createdAt: first.createdAt,
    });
    await insertReservationGraph(client, {
      ...second,
      foodAmount: 9.5,
      depositAmount: 0,
      providerAmount: 9.5,
      commissionAmount: 0,
      createdAt: second.createdAt,
    });
    await insertReservationGraph(client, {
      ...third,
      foodAmount: 28.5,
      depositAmount: 0,
      providerAmount: 28.5,
      commissionAmount: 0,
      createdAt: third.createdAt,
    });
    await applyManualRefundCarryForward({
      client,
      refundSettlementId: source.settlementId,
      adminId: providerId,
      notes: "Step 6 carry-forward",
      ensureSchema: false,
    });

    const firstPaid = await transitionProviderSettlementStatus({
      client,
      settlementId: first.settlementId,
      status: "paid",
      adminId: providerId,
      paymentReference: "e2e-cascade-paid-38",
      paidAmount: 38,
      paidAt: "2026-09-05T00:00:00.000Z",
      ensureSchema: false,
    });
    const secondPaid = await transitionProviderSettlementStatus({
      client,
      settlementId: second.settlementId,
      status: "paid",
      adminId: providerId,
      paymentReference: "e2e-cascade-paid-9-5",
      paidAmount: 9.5,
      paidAt: "2026-09-05T00:01:00.000Z",
      ensureSchema: false,
    });
    const thirdPaid = await transitionProviderSettlementStatus({
      client,
      settlementId: third.settlementId,
      status: "paid",
      adminId: providerId,
      paymentReference: "e2e-cascade-paid-9-5b",
      paidAt: "2026-09-05T00:02:00.000Z",
      ensureSchema: false,
    });

    const provider = await getProviderSettlementSummary({ client, providerId, ensureSchema: false });
    const admin = await listAdminProviderSettlements({ client, providerId, status: "all", limit: 50, ensureSchema: false });
    const financial = await getFinancialSummary({ client, limit: 50 });
    const rows = admin.settlements.sort((left, right) => left.created_at.localeCompare(right.created_at));
    assert.equal(firstPaid.status, "paid");
    assert.equal(secondPaid.status, "paid");
    assert.equal(thirdPaid.status, "paid");
    assert.deepEqual(
      rows.map((row) => ({ amount: Number(row.amount), recovery: Number(row.refund_deduction_amount), net: Number(row.net_payable) })),
      [
        { amount: 57, recovery: 0, net: 0 },
        { amount: 38, recovery: 38, net: 0 },
        { amount: 9.5, recovery: 9.5, net: 0 },
        { amount: 28.5, recovery: 9.5, net: 0 },
      ],
    );
    assert.equal(Number(provider.earnings.pending), 0);
    assert.equal(Number(provider.earnings.paid), 19);
    assert.equal(Number(provider.refunds.total), 57);
    assert.equal(Number(provider.refunds.pending), 0);
    assert.equal(Number(admin.summary[0].amount_due), 0);
    assert.equal(Number(admin.summary[0].pending_refund_amount), 0);
    assert.equal(Number(financial.totals.total_provider_liabilities), 0);
    assert.equal(Number(financial.totals.total_provider_paid), 19);
    assert.equal(Number(financial.totals.total_refund_volume), 57);
    assert.equal(Number(financial.provider_refund_liability.outstanding), 0);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});