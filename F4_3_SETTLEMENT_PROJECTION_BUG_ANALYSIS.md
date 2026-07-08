# F4.3 Settlement Projection Bug - Root Cause Analysis & Fix

## Executive Summary
The Provider Dashboard, Admin Settlement Dashboard, and Admin Financial Dashboard display refunded settlements as "pending" because the projection queries only check `provider_settlements.status`, not the financial ledger for refund events. This violates double-entry accounting rules.

## Root Cause

### Current Buggy Behavior
When a reservation is fully refunded:

1. **Ledger (append-only, CORRECT):**
   - Event: `settlement_allocated` (₹47.50) → Provider Settlement LIABILITY ✓
   - Event: `refund_issued` (₹50) → Refund EXPENSE ✓
   - No mutations to previous events ✓

2. **Projection Queries (INCORRECT):**
   - Query sums all `provider_settlements` with status IN ('pending', 'processing', 'allocated', 'batched', 'failed', 'cancelled')
   - Does NOT check if `refund_issued` event exists in `financial_ledger_entries`
   - Result: Shows ₹47.50 as pending earnings even after full refund ✗

### Affected Queries

**File:** `Food_waste_backend/shared/services/providerPayout.service.js`

**Bug #1: `getProviderSettlementSummary()` (Line 967)**
```sql
-- CURRENT (BUGGY)
SELECT
  COALESCE(SUM(amount) FILTER (WHERE status = ANY($2::text[])), 0) AS pending_earnings
FROM provider_settlements
WHERE provider_id=$1
-- $2 = OUTSTANDING_SETTLEMENT_STATUSES
```

**Bug #2: `listAdminProviderSettlements()` - Summary CTE (Line 1204)**
```sql
-- CURRENT (BUGGY)
WITH provider_due AS (
  SELECT
    provider_id,
    COALESCE(SUM(amount) FILTER (WHERE status = ANY($1::text[])), 0) AS amount_due,
    COUNT(*) FILTER (WHERE status = ANY($1::text[])) AS pending_settlements
  FROM provider_settlements
  GROUP BY provider_id
)
```

**Bug #3: `listAdminProviderSettlements()` - Detail Query (Line 1285)**
```sql
-- CURRENT (BUGGY)
WITH provider_due AS (
  SELECT
    provider_id,
    COALESCE(SUM(amount) FILTER (WHERE status = ANY($2::text[])), 0) AS amount_due,
    COUNT(*) FILTER (WHERE status = ANY($2::text[])) AS pending_settlements
  FROM provider_settlements
  GROUP BY provider_id
)
```

## Impact

### Provider Dashboard
- Shows Pending Earnings: ₹47.50 (should be ₹0)
- User believes they will receive payment for refunded reservation

### Admin Settlement Dashboard
- Shows Pending Settlement: ₹47.50
- Admin attempts to pay provider for a refunded order
- Violates refund policy: provider should never receive settlement for a refund

### Admin Financial Dashboard
- Shows Commission Revenue: ₹2.50 (should be ₹0)
- Shows Provider Liability: ₹47.50 (should be ₹0)
- Accounting records show fictitious obligations

## Accounting Violation
**Double-Entry Accounting Rule Violated:**
- Ledger has both allocation event AND refund event (correct)
- Projection shows only allocation, not refund reversal (incorrect)
- Leads to imbalanced financial statements

## Solution

### Principle
- **Never mutate the append-only ledger** ✓
- **Only fix projection queries** ✓
- **Exclude settlements that have a matching refund_issued event** ✓

### Implementation
LEFT JOIN `provider_settlements` with `financial_ledger_entries` where:
- `event_type = 'refund_issued'`
- `reservation_id` matches
- Exclude from pending calculations if refund_issued event exists

### Corrected Query Pattern
```sql
SELECT ps.*
FROM provider_settlements ps
LEFT JOIN financial_ledger_entries fle 
  ON fle.reservation_id = ps.reservation_id 
  AND fle.event_type = 'refund_issued'
WHERE ps.provider_id = $1
  AND ps.status = ANY($2::text[])
  AND fle.id IS NULL  -- Exclude settlements with refund events
```

## Fix Locations

1. **`getProviderSettlementSummary()`** - Provider Dashboard totals
   - Add LEFT JOIN to exclude refunded settlements
   - Line ~967-1036

2. **`listAdminProviderSettlements()` - Summary CTE** - Admin Dashboard summary
   - Modify provider_due CTE to exclude refunded settlements
   - Line ~1204

3. **`listAdminProviderSettlements()` - Detail CTE** - Admin Dashboard detail results
   - Modify provider_due CTE to exclude refunded settlements
   - Line ~1285

## Expected Results After Fix

### Payment: ₹50 → Commission: ₹2.50 → Provider: ₹47.50 → Full Refund

**Provider Dashboard:**
- Pending Earnings: ₹0 ✓
- Paid Earnings: ₹0 ✓

**Admin Settlement Dashboard:**
- No pending settlement for this reservation ✓
- (Optional: Show historical "Refunded" status for audit) ✓

**Admin Financial Dashboard:**
- Commission Revenue: ₹0 ✓
- Provider Liability: ₹0 ✓
- Refund Volume: ₹50 ✓

**Immutable Ledger:**
- All events intact for audit ✓
- No mutations ✓
- Replay-safe ✓

## Architecture Verification
- ✓ No accounting rules changed
- ✓ No ledger mutation
- ✓ No settlement redesign
- ✓ Only projection logic corrected
- ✓ Replay-safe (queries only read ledger, never write)
- ✓ Idempotent (same inputs = same output)
- ✓ Production-safe (read-only changes)

## Related Tables
- `provider_settlements` - settlement records
- `financial_ledger_entries` - immutable event log (source of truth)
- `financial_refund_terminal_records` - refund lifecycle state machine

## Key Insight
**Current Financial Position ≠ Historical Allocations**

The projection MUST represent current payable balance, not sum of allocation events. Refunds negate allocations, but ledger records both as immutable events.
