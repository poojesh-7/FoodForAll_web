# Food Waste Platform - Financial Architecture Overview

**Generated:** 2026-07-08 | **Focus:** Payment flows, settlement accounting, ledger projections, and dashboard aggregations

---

## 1. Controllers (API Layer)

### Core Financial Controllers

| File | Purpose | Key Operations |
|------|---------|-----------------|
| [payment.controller.js](Food_waste_backend/controllers/payment.controller.js) | Payment workflow orchestration | Payment initiation, status polling, webhook handling, payment verification |
| [providerFinancial.controller.js](Food_waste_backend/controllers/providerFinancial.controller.js) | Provider payout & settlement UI | Payout account management, settlement summary, change requests |

---

## 2. Services (Business Logic Layer)

### Financial Ledger & Accounting

| Service | Responsibility | Key Exports |
|---------|-----------------|-------------|
| [financialLedger.service.js](Food_waste_backend/shared/services/financialLedger.service.js) | **Ledger definitions & event recording** | `recordFinancialLedgerEntry()`, `recordProviderSettlementPaidLedger()`, `ensureSettlementAccountingSchema()` |
| [financialOwnership.service.js](Food_waste_backend/shared/services/financialOwnership.service.js) | **Ownership snapshots** (immutable) | `buildFinancialOwnershipSnapshot()`, `getFinancialOwnership()`, payment actor attribution |
| [financialStateMachine.service.js](Food_waste_backend/shared/services/financialStateMachine.service.js) | Payment status transitions & validation | `isIllegalPaymentTransition()`, `normalizeRefundStatusFromGateway()`, `shouldApplyRefundWebhook()` |

### Settlement & Payout

| Service | Responsibility | Key Exports |
|---------|-----------------|-------------|
| [providerPayout.service.js](Food_waste_backend/shared/services/providerPayout.service.js) | **Settlement batch management & payout accounts** | `listAdminProviderSettlements()`, `transitionProviderSettlementStatus()`, `verifyProviderPayoutAccount()`, `approveProviderPayoutAccountChange()` |
| [financialReconciliation.service.js](Food_waste_backend/shared/services/financialReconciliation.service.js) | Payment reconciliation workflow | Matches payment records with ledger entries |

### Refund Operations

| Service | Responsibility | Key Exports |
|---------|-----------------|-------------|
| [refundExecution.service.js](Food_waste_backend/shared/services/refundExecution.service.js) | **Refund plan execution & terminal recording** | Reversal event handling, deposit retention logic |
| [refundRouting.service.js](Food_waste_backend/shared/services/refundRouting.service.js) | Refund routing logic | Determines refund target based on payment ownership |

### Dashboard & Analytics

| Service | Responsibility | Key Exports |
|---------|-----------------|-------------|
| [governanceDashboard.service.js](Food_waste_backend/shared/services/governanceDashboard.service.js) | Admin governance dashboard | Moderation metrics, trust signals, case queue |
| [businessMetrics.service.js](Food_waste_backend/shared/services/businessMetrics.service.js) | **Financial & operational metrics export** | Food rescued, reservations, provider/volunteer/NGO participation |
| [governanceIntelligence.service.js](Food_waste_backend/shared/services/governanceIntelligence.service.js) | Trust & risk signal analysis | Appeal reversal patterns, repeated disputes, provider risk scoring |

### Observability & Monitoring

| Service | Responsibility | Integration |
|---------|-----------------|-------------|
| [paymentMonitoring.service.js](Food_waste_backend/shared/services/paymentMonitoring.service.js) | Payment health tracking | Monitors gateway timeouts, retry patterns |
| [payment.service.js](Food_waste_backend/shared/services/payment.service.js) | Gateway orchestration (Cashfree) | Session creation, status polling, webhook parsing |

---

## 3. Database Schema (Migrations)

### Financial Schema Evolution

**Phase 1: Foundation (F1)**
- **[009_financial_ownership_f1.up.sql](Food_waste_backend/migrations/009_financial_ownership_f1.up.sql)**
  - `payment_ownership` (immutable) - Snapshots payer, beneficiary, commission actors
  - Indexes: reservation + session, payer, provider, refund target

**Phase 2: Refund Operations (F2, F21)**
- **[010_financial_refund_operations_f2.up.sql](Food_waste_backend/migrations/010_financial_refund_operations_f2.up.sql)** - Refund execution records
- **[011_financial_lifecycle_accounting_f21.up.sql](Food_waste_backend/migrations/011_financial_lifecycle_accounting_f21.up.sql)** - Lifecycle event tracking

**Phase 3: Integrity & Settlement (F3, F4)**
- **[012_financial_integrity_f3.up.sql](Food_waste_backend/migrations/012_financial_integrity_f3.up.sql)** - Constraint enforcement
- **[013_financial_settlement_accounting_f4.up.sql](Food_waste_backend/migrations/013_financial_settlement_accounting_f4.up.sql)**
  - `settlement_batches` - Batch context (reference, status, totals)
  - `settlement_allocation_snapshots` - Commission allocation per reservation
  - `provider_settlements` - Provider settlement records with status
  - `financial_ledger_entries` - **Event/ledger journal** (immutable append-only)
  - Indexes: settlement batch status, provider + created_at, allocation version

**Phase 4: Enhancements (TFIN1, TFIN2, TFIN21)**
- **[034_financial_integrity_hardening_tfin1.up.sql](Food_waste_backend/migrations/034_financial_integrity_hardening_tfin1.up.sql)** - Additional constraints
- **[035_provider_payout_manual_settlements_tfin2.up.sql](Food_waste_backend/migrations/035_provider_payout_manual_settlements_tfin2.up.sql)**
  - `provider_payout_accounts` - UPI/BANK account management
  - `payout_account_change_requests` - Change request workflow
- **[036_financial_accounting_buckets_tfin21.up.sql](Food_waste_backend/migrations/036_financial_accounting_buckets_tfin21.up.sql)** - Accounting bucket classification

---

## 4. Core Database Tables & Relationships

```
PAYMENT FLOW:
payments → payment_ownership (immutable snapshot)
         ↓
    ↓─── settlement_allocation_snapshots
    │    ↓
    │    provider_settlements (status: allocated → batched → settled/paid/cancelled)
    │    ↓
    │    financial_ledger_entries (event_type: settlement_allocated, provider_settlement_paid)
    │
    └─── REFUND PATH:
         financial_refund_terminal_records (terminal_status: planned/processing/succeeded/failed/retained)
         ↓
         financial_ledger_entries (event_type: refund_issued, deposit_retained)
```

### Key Tables

| Table | Purpose | Immutability |
|-------|---------|--------------|
| `payment_ownership` | Captures who pays, who benefits, commission split | ✓ Immutable (trigger prevents UPDATE/DELETE) |
| `settlement_allocation_snapshots` | Commission % & amount allocation per reservation | Single-write (one entry per settlement_version) |
| `provider_settlements` | Provider settlement record linked to allocation | Mutable (status transitions: allocated → batched → settled/paid/failed) |
| `settlement_batches` | Batch grouping for settlement runs | Mutable (status: planned → allocated → closed/cancelled) |
| `financial_ledger_entries` | **Append-only event journal** | ✓ Immutable (all events logged here) |
| `provider_payout_accounts` | Provider UPI/BANK account details | Versioned (is_active, is_verified, verification_status) |
| `financial_refund_terminal_records` | Refund execution state machine | Mutable (status transitions) |

---

## 5. Accounting Categories (Ledger)

Defined in **financialLedger.service.js**:

```javascript
ACCOUNTING_CATEGORIES = {
  PLATFORM_COMMISSION_REVENUE,      // Commission collected
  GATEWAY_FEE_EXPENSE,              // Payment gateway fees
  RELIABILITY_DEPOSIT_HELD,         // Deposit captured
  RELIABILITY_DEPOSIT_REFUNDED,     // Deposit returned
  RELIABILITY_DEPOSIT_RETAINED,     // Deposit forfeited
  PROVIDER_SETTLEMENT_LIABILITY,    // Settlement allocated to provider
  PROVIDER_SETTLEMENT_PAID,         // Settlement paid out
  REFUND_EXPENSE,                   // Refund issued
}

EVENT_ACCOUNTING_CATEGORIES = {
  platform_commission → PLATFORM_COMMISSION_REVENUE
  gateway_fee_recorded → GATEWAY_FEE_EXPENSE
  deposit_collected → RELIABILITY_DEPOSIT_HELD
  deposit_refunded → RELIABILITY_DEPOSIT_REFUNDED
  deposit_retained → RELIABILITY_DEPOSIT_RETAINED
  settlement_allocated → PROVIDER_SETTLEMENT_LIABILITY
  provider_settlement_paid → PROVIDER_SETTLEMENT_PAID
  refund_issued → REFUND_EXPENSE
}
```

---

## 6. Financial Workflows

### 6.1 Payment → Settlement Flow

```
1. Payment Initiation (payment.controller.js)
   ↓
2. Session created, ownership snapshot recorded
   └─ payment_ownership row inserted
   ↓
3. Payment succeeds (Cashfree webhook)
   ↓
4. Settlement Allocation (financialLedger.service)
   └─ settlement_allocation_snapshots row created
   └─ financial_ledger_entries: settlement_allocated
   ↓
5. Settlement Batching (providerPayout.service)
   └─ provider_settlements status: allocated → batched
   ↓
6. Payout Execution
   └─ financial_ledger_entries: provider_settlement_paid
   └─ provider_settlements status: batched → settled/paid/failed
```

### 6.2 Refund Flow

```
1. Refund Trigger (refundRouting.service)
   └─ Determine refund target from payment_ownership
   ↓
2. Refund Execution (refundExecution.service)
   └─ financial_refund_terminal_records created
   └─ Terminal status: planned → processing → succeeded/failed/retained
   ↓
3. Ledger Recording
   └─ financial_ledger_entries: refund_issued or deposit_retained
```

### 6.3 Reversal Event Handling

**Deposit Retention** (no refund issuance):
- `refundExecution.service`: Validates retention eligibility
- `financial_ledger_entries`: `event_type = deposit_retained`, amount recorded
- `financial_refund_terminal_records`: `terminal_status = retained`

**Appeal Reversals** (governance reversal of penalties):
- Tracked in `governanceIntelligence.service`: `accepted_appeal_reversals` metric
- Alert type: `APPEAL_REVERSAL_PATTERN` when count ≥ 1
- Used in provider risk scoring

---

## 7. Projection Builders & Dashboard Queries

### 7.1 Business Metrics Dashboard

**Service:** [businessMetrics.service.js](Food_waste_backend/shared/services/businessMetrics.service.js)

**Architecture:**
- Read-only analytics layer (no mutations)
- Window-based historical metrics (30d, 90d, 180d, 365d, all-time)
- Current-state inventory metrics (separate from historical)

**Key Metrics Exposed:**
- **Food Rescued:** SUM(reservations.quantity_reserved) within period
- **Active Listings:** COUNT(*) where status='active', pickup window open, remaining_quantity > 0
- **Total Reservations:** COUNT(*) by reserved_at window
- **Completed Pickups:** COUNT(*) by picked_up_at window
- **Provider/NGO/Volunteer Participation:** Distinct user counts by role
- **Financial Insights:** Settlement & refund record counts (NOT ledger recomputation)

**Export Formats:** CSV, JSON (uses same underlying queries as UI)

### 7.2 Governance Dashboard

**Service:** [governanceDashboard.service.js](Food_waste_backend/shared/services/governanceDashboard.service.js)

**Key Projections:**
- **Case Queue:** Open, under-review, awaiting-response moderation cases
- **Risk Signals:** Appeal reversals, repeated disputes, provider patterns
- **Activity Timeline:** Provider reports, moderation actions, appeals (12-item window)
- **Summary Metrics:** Total active cases, resolved this period, resolution rate

### 7.3 Trust Projection Breakdown

**Service:** [trustProjection.service.js](Food_waste_backend/shared/services/trustProjection.service.js)

**Admin Endpoint:** `/admin/trust/:subjectType/:subjectId/projection`

**Aggregations:**
- Trust score components breakdown
- Penalty level and recovery trajectory
- Domain-specific score distribution (pickup, delivery, provider fulfillment)
- Decay interval tracking

---

## 8. SQL Indexes for Dashboard Performance

**Migration:** [024_business_metrics_t74.up.sql](Food_waste_backend/migrations/024_business_metrics_t74.up.sql)

```sql
idx_business_metrics_food_listings_created
  (created_at DESC, id DESC)

idx_business_metrics_reservations_reserved
  (reserved_at DESC, id DESC)

idx_business_metrics_reservations_completed
  (completed_at DESC, id DESC)
  WHERE completed_at IS NOT NULL

idx_business_metrics_reservations_picked_up
  (picked_up_at DESC, id DESC)
  WHERE picked_up_at IS NOT NULL

idx_business_metrics_provider_settlements_created
  (created_at DESC, id DESC)

idx_business_metrics_provider_settlements_status_updated
  (status, updated_at DESC)

idx_business_metrics_refund_terminal_created
  (terminal_status, created_at DESC)
```

---

## 9. File Inventory Summary

### Controllers (2)
- `payment.controller.js` - Payment workflow
- `providerFinancial.controller.js` - Provider financial dashboard

### Financial Services (12+)
1. **Ledger & Accounting:**
   - `financialLedger.service.js` - Event/ledger definitions
   - `financialOwnership.service.js` - Ownership snapshots
   - `financialStateMachine.service.js` - Status transitions
   - `financialReconciliation.service.js` - Payment reconciliation

2. **Settlement & Payout:**
   - `providerPayout.service.js` - Settlement & payout management
   - `payment.service.js` - Payment gateway integration

3. **Refunds:**
   - `refundExecution.service.js` - Refund execution & reversals
   - `refundRouting.service.js` - Refund routing logic

4. **Dashboard & Analytics:**
   - `businessMetrics.service.js` - Financial metrics export
   - `governanceDashboard.service.js` - Governance analytics
   - `governanceIntelligence.service.js` - Risk & reversal patterns
   - `trustProjection.service.js` - Trust score projection

5. **Monitoring:**
   - `paymentMonitoring.service.js` - Payment health tracking

### Migrations (9 core financial migrations)
- `009_financial_ownership_f1.up.sql` - Payment ownership
- `010_financial_refund_operations_f2.up.sql` - Refund execution
- `011_financial_lifecycle_accounting_f21.up.sql` - Lifecycle accounting
- `012_financial_integrity_f3.up.sql` - Integrity constraints
- `013_financial_settlement_accounting_f4.up.sql` - Settlement ledger ⭐
- `034_financial_integrity_hardening_tfin1.up.sql` - Hardening
- `035_provider_payout_manual_settlements_tfin2.up.sql` - Payout accounts
- `036_financial_accounting_buckets_tfin21.up.sql` - Accounting buckets
- `024_business_metrics_t74.up.sql` - Dashboard indexes

---

## 10. Component Mapping Table

| Component | Purpose | Location | Key Files |
|-----------|---------|----------|-----------|
| **Event/Ledger Definitions** | Financial event taxonomy | Service + Migration | `financialLedger.service.js`, `013_financial_settlement_accounting_f4.up.sql` |
| **Ownership Snapshots** | Immutable payment actor attribution | Service + Migration | `financialOwnership.service.js`, `009_financial_ownership_f1.up.sql` |
| **Projection Builders** | Analytics aggregation layer | Services (read-only) | `businessMetrics.service.js`, `governanceDashboard.service.js`, `trustProjection.service.js` |
| **Dashboard Aggregation** | Metric calculation & export | Service + Indexes | `businessMetrics.service.js`, `024_business_metrics_t74.up.sql` |
| **Reversal Event Handling** | Refund & deposit retention logic | Service + Migration | `refundExecution.service.js`, `010_financial_refund_operations_f2.up.sql` |
| **Status Transitions** | Payment state machine validation | Service | `financialStateMachine.service.js` |
| **Settlement Management** | Batch & payout orchestration | Service + Migration | `providerPayout.service.js`, `035_provider_payout_manual_settlements_tfin2.up.sql` |
| **Risk Signals** | Governance pattern detection | Service | `governanceIntelligence.service.js` (appeal reversals, disputes) |

---

## 11. Key Design Patterns

### 1. **Immutable Ledger**
- `financial_ledger_entries` is append-only
- `payment_ownership` is write-once (trigger prevents mutations)
- All changes tracked as new events, never modified

### 2. **Versioned Snapshots**
- `settlement_allocation_snapshots.settlement_version`
- `payment_ownership.ownership_version`
- Enables audit trail and reconciliation

### 3. **Idempotency Keys**
- `settlement_allocation_snapshots.idempotency_key`
- `provider_settlements.idempotency_key`
- Prevents duplicate settlement allocations

### 4. **Status Machines**
- Payment: created → pending → paid/failed/expired
- Settlement: allocated → batched → settled/paid/failed/cancelled
- Refund terminal: planned → processing → succeeded/failed/retained

### 5. **Role-Based Attribution**
- Payer role (user/ngo/platform)
- Beneficiary role (provider/platform)
- Commission receiver (always platform when > 0)
- Refund target (determined from ownership)

---

## 12. Data Retention & Compliance

**Migration:** [025_data_retention_compliance_t75.up.sql](Food_waste_backend/migrations/025_data_retention_compliance_t75.up.sql)

Financial tables in retention scope:
- `financial_ledger_entries`
- `provider_settlements`
- `settlement_allocation_snapshots`
- `settlement_batches`
- `payment_order_attempts`
- `financial_refund_terminal_records`

---

## Quick Reference: Entry Points

### Admin Settlement Console
```
GET /admin/settlements
→ providerPayout.service.listAdminProviderSettlements()
→ SELECT * FROM provider_settlements JOIN settlement_allocation_snapshots
```

### Provider Dashboard
```
GET /provider/financial/settlement-summary
→ providerFinancial.controller.js
→ providerPayout.service.getProviderSettlementSummary()
```

### Governance Dashboard
```
GET /admin/governance-dashboard
→ governanceDashboard.service.getGovernanceDashboardService()
→ Aggregates: cases, signals, timeline, metrics
```

### Business Metrics Export
```
GET /admin/metrics/export?period=30d&format=csv
→ businessMetrics.service.js
→ Returns: listings, reservations, participation, financial summary
```

### Trust Projection
```
GET /admin/trust/:subjectType/:subjectId/projection
→ trustProjection.service.getTrustProjectionBreakdown()
→ Returns: score components, penalties, recovery trajectory
```

