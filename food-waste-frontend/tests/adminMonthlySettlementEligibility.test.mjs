import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("monthly settlement modal uses monthly eligibility fields", () => {
  const page = readFileSync(
    new URL("../app/admin/settlements/page.tsx", import.meta.url),
    "utf8",
  );
  const modal = readFileSync(
    new URL("../components/admin/SettleMonthModal.tsx", import.meta.url),
    "utf8",
  );
  const contracts = readFileSync(
    new URL("../../shared/contracts/api-contracts.ts", import.meta.url),
    "utf8",
  );

  assert.match(contracts, /eligible_count: number/);
  assert.match(contracts, /eligible_payable_amount: number \| string/);
  assert.match(page, /eligibleCount: Number\(monthly\.eligible_count \|\| 0\)/);
  assert.match(page, /totalAmount: monthly\.eligible_payable_amount \|\| 0/);
  assert.doesNotMatch(
    page,
    /totalAmount: Math\.max\(\s*Number\(effectiveTotalAmountDue/,
  );
  assert.match(modal, /Actually payable:/);
  assert.match(modal, /No payable settlement records remain for this month\./);
  assert.match(modal, /reserved\s+for refund-liability recovery/);
  assert.match(modal, /disabled=\{loading \|\| !reference\.trim\(\) \|\| noEligibleRecords\}/);
});

test("monthly settlement modal clears stale no-payable errors on fresh eligibility", () => {
  const page = readFileSync(
    new URL("../app/admin/settlements/page.tsx", import.meta.url),
    "utf8",
  );
  const modal = readFileSync(
    new URL("../components/admin/SettleMonthModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(modal, /import \{ useEffect, useState \} from "react"/);
  assert.match(modal, /eligibilityVersion = 0/);
  assert.match(modal, /useEffect\(\(\) => \{\s*if \(!isOpen\) return;\s*queueMicrotask\(\(\) => \{\s*setError\(""\);/);
  assert.match(modal, /eligibleCount,[\s\S]*eligibilityVersion,[\s\S]*isOpen,[\s\S]*providerId/);
  assert.match(page, /settlementEligibilityVersion/);
  assert.match(page, /setSettlementEligibilityVersion\(\(current\) => current \+ 1\)/);
  assert.match(page, /eligibilityVersion=\{settlementEligibilityVersion\}/);
  assert.match(page, /const activeSettleMonthly =/);
  assert.match(page, /recordCount=\{activeSettleMonthly\?\.record_count \?\? settleModalState\.recordCount\}/);
  assert.match(page, /activeSettleMonthly\?\.eligible_count \?\? settleModalState\.eligibleCount/);
  assert.match(page, /activeSettleMonthly\?\.eligible_payable_amount \?\?\s*settleModalState\.totalAmount/);
});

test("monthly settlement modal keeps current eligibility states coherent", () => {
  const page = readFileSync(
    new URL("../app/admin/settlements/page.tsx", import.meta.url),
    "utf8",
  );
  const modal = readFileSync(
    new URL("../components/admin/SettleMonthModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(modal, /const noEligibleRecords = Number\(eligibleCount \|\| 0\) === 0/);
  assert.match(modal, /if \(noEligibleRecords\) \{\s*setError\("No payable settlement records remain for this month\."\)/);
  assert.match(modal, /Payable records:/);
  assert.match(modal, /\{eligibleCount\}/);
  assert.match(modal, /Actually payable:/);
  assert.match(modal, /\{formatCurrency\(totalAmount\)\}/);
  assert.match(modal, /disabled=\{loading \|\| !reference\.trim\(\) \|\| noEligibleRecords\}/);
  assert.match(page, /eligibleCount: Number\(monthly\.eligible_count \|\| 0\)/);
  assert.match(page, /totalAmount: monthly\.eligible_payable_amount \|\| 0/);
});

test("monthly and view-record counts come from different audited populations", () => {
  const page = readFileSync(
    new URL("../app/admin/settlements/page.tsx", import.meta.url),
    "utf8",
  );
  const recordsModal = readFileSync(
    new URL("../components/admin/MonthlySettlementRecordsModal.tsx", import.meta.url),
    "utf8",
  );
  const adminService = readFileSync(
    new URL("../services/admin.service.ts", import.meta.url),
    "utf8",
  );
  const controller = readFileSync(
    new URL("../../Food_waste_backend/admin/admin.controller.js", import.meta.url),
    "utf8",
  );
  const providerPayoutService = readFileSync(
    new URL("../../Food_waste_backend/shared/services/providerPayout.service.js", import.meta.url),
    "utf8",
  );

  assert.match(page, /recordCount: monthly\.record_count/);
  assert.match(adminService, /"\/admin\/settlements\/monthly"/);
  assert.match(recordsModal, /getAdminSettlementRecords/);
  assert.match(recordsModal, /Showing \{recordCount\} records, including settlement runs/);
  assert.match(controller, /listProviderSettlementRecords\(\{[\s\S]*status: "all"/);
  assert.match(providerPayoutService, /const includeSettlementRuns = !normalizedStatus \|\| normalizedStatus === "all" \|\| normalizedStatus === "settled"/);
  assert.match(providerPayoutService, /UNION ALL\s*\$\{runRecords\}/);
  assert.match(providerPayoutService, /FROM provider_settlement_runs/);
  assert.match(providerPayoutService, /COUNT\(\*\) OVER\(\)::int AS total_count/);
});
