# Timestamp Audit Report

## Executive Summary
- **Status**: ⚠️ CRITICAL ISSUES FOUND
- **Schema**: Majority of columns use `timestamp without time zone` (should be `timestamptz`)
- **Frontend**: Creating timestamps for backend state (should be server-only)
- **SQL**: Using `NOW()` correctly in most places (good)

---

## Issues Found

### 1. ❌ Schema: `timestamp without time zone` Usage (CRITICAL)

**Problem**: 200+ columns use `timestamp without time zone` instead of `timestamptz`.

**Risk**: 
- Timestamps are ambiguous when spanning time zones
- No automatic UTC handling
- Breaks multi-region compliance (data-retention-compliance workflow)
- Makes cross-timezone comparisons fragile

**Affected Tables & Column Categories**:

#### Reservation/Delivery Lifecycle
- `reservations.reserved_at` ⚠️ **MIXED** (some are `timestamptz`, some not)
- `reservations.assigned_at` (timestamp with time zone ✓)
- `reservations.picked_up_at` (timestamp without time zone ❌)
- `reservations.completed_at` (timestamp without time zone ❌)
- `reservations.payment_expires_at` (timestamp without time zone ❌)

#### Payment Workflow
- `payments.created_at` (timestamp without time zone ❌)
- `payments.updated_at` (timestamp without time zone ❌)
- `payments.payment_terminal_at` (timestamp without time zone ❌)
- `payments.refund_terminal_at` (timestamp without time zone ❌)
- `payments.last_reconciled_at` (timestamp without time zone ❌)

#### Webhook Events
- `cashfree_webhook_events.received_at` (timestamp without time zone ❌)
- `cashfree_webhook_events.processed_at` (timestamp without time zone ❌)
- `payment_refund_webhooks.received_at` (timestamp without time zone ❌)

#### Trust & Financial Events
- `trust_events.created_at` (timestamp without time zone ❌)
- `trust_lifecycle_events.created_at` (timestamp without time zone ❌)
- `reliability_deposits.created_at` (timestamp without time zone ❌)
- `reliability_deposits.reliability_deposit_refunded_at` (timestamp without time zone ❌)
- `reliability_deposits.reliability_deposit_retained_at` (timestamp without time zone ❌)

#### Governance & Audit
- `audit_events.created_at` (timestamp without time zone ❌)
- `governance_snapshots.created_at` (timestamp without time zone ❌)
- `incident_reports.created_at` (timestamp without time zone ❌)

#### Moderation & Restrictions
- `moderation_cases.created_at` (timestamp without time zone ❌)
- `restrictions.cooldown_until` (timestamp without time zone ❌)
- `user_restrictions.active_until` (timestamp without time zone ❌)
- `restriction_schemas.created_at` (timestamp without time zone ❌)

#### Financial Ledger & Payouts
- `financial_ledger.created_at` (timestamp without time zone ❌)
- `provider_payouts.created_at` (timestamp without time zone ❌)
- `payout_change_requests.change_requested_at` (timestamp without time zone ❌)

#### Miscellaneous
- `users.first_seen_at`, `last_seen_at` (timestamp without time zone ❌)
- `user_device_tokens.created_at` (timestamp without time zone ❌)
- `breach_attempts.created_at` (timestamp without time zone ❌)
- `notification_tracking.created_at` (timestamp without time zone ❌)

**Total Affected**: ~100+ columns across 40+ tables

---

### 2. ❌ Frontend: Creating Backend State Timestamps (CRITICAL)

**Problem**: `app/provider/reservations/page.tsx` creates `picked_up_at` and `completed_at` locally.

**Code**:
```typescript
// Line 400 - WRONG: Frontend creating state timestamps
picked_up_at: new Date().toISOString(),
completed_at: new Date().toISOString(),
```

**Risk**:
- Client clock skew causes temporal inconsistencies
- Backend already sets these with `NOW()` in SQL
- Frontend update overwrites server timestamps with client-generated ones
- Breaks ordering by creation time (trust events depend on this)

**Impact**:
- Payment reconciliation queries use `created_at` for ordering → gets client times instead of server times
- Trust events with same reservation span different client-generated timestamps
- Delivery completion time reflects client clock, not actual server completion

**Correct Pattern**:
```typescript
// Backend API response includes server-set timestamps
// Frontend should NOT modify state timestamps, only display them
const response = await api.confirmPickup(reservationId);
// response.picked_up_at comes from server (set via NOW())
setReservations(current => 
  current.map(r => r.id === reservationId ? response : r)
);
```

---

### 3. ⚠️ Application Layer: `new Date().toISOString()` in Metadata (MEDIUM)

**Problem**: `auditCenter.service.js` line 1400:
```javascript
generated_at: new Date().toISOString(),
```

**Impact**: Audit report generation timestamp uses app layer instead of database.

**Risk**: 
- Inconsistent with all other timestamps
- Less precise for audit trail ordering
- Should be `NOW()` in trigger or database function

---

### 4. ✅ Good: Backend SQL Uses `NOW()` Correctly

**Verified**:
- `reservation.controller.js` line 1306-1314: `picked_up_at = NOW()`, `completed_at = NOW()` ✓
- `paymentReconciliation.service.js`: Multiple `NOW()` usage ✓
- All payment terminal timestamps use `NOW()` in triggers ✓
- All webhook events use `DEFAULT now()` ✓

---

## Remediation Plan

### Phase 1: Schema Migration (PostgreSQL ALTER TABLE)
Create migration `037_timestamp_standardization_t_ts1.up.sql`:
1. Convert ALL `timestamp without time zone` to `timestamptz`
2. Use `USING col AT TIME ZONE 'UTC'` for data type conversion
3. Update all DEFAULT clauses from `now()` to `CURRENT_TIMESTAMP`
4. Verify no queries break

### Phase 2: Frontend Fix
Fix `app/provider/reservations/page.tsx` line 400:
- **REMOVE** local timestamp creation
- **KEEP** server-provided timestamps from API response
- Frontend only renders/displays server timestamps

### Phase 3: Application Layer Fix
Fix `auditCenter.service.js` line 1400:
- Consider if `generated_at` should come from database trigger
- Or add database DEFAULT and fetch from response

### Phase 4: Verification
- Verify all payment reconciliation queries use server timestamps
- Verify trust event ordering remains consistent
- Verify compliance and retention workflows work across time zones

---

## SQL Migration Strategy

```sql
-- For each column, use atomic type conversion:
ALTER TABLE reservations
  ALTER COLUMN reserved_at SET DATA TYPE timestamptz USING reserved_at AT TIME ZONE 'UTC',
  ALTER COLUMN picked_up_at SET DATA TYPE timestamptz USING picked_up_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at SET DATA TYPE timestamptz USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN payment_expires_at SET DATA TYPE timestamptz USING payment_expires_at AT TIME ZONE 'UTC';
```

---

## Testing Checklist
- [ ] Payment reconciliation queries return identical results
- [ ] Trust events maintain creation order
- [ ] Compliance retention calculations unchanged
- [ ] Cross-timezone timestamp comparisons work
- [ ] Frontend displays timestamps correctly
- [ ] Payment expiry detection unchanged
- [ ] Delivery completion times accurate
- [ ] Data-retention compliance workflow unaffected

