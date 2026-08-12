const assert = require('node:assert/strict');
const test = require('node:test');

const providerFinancialCtrl = require('../controllers/providerFinancial.controller');
const providerService = require('../shared/services/providerPayout.service');

test('Controller returns wrapped records object', async () => {
  // stub listProviderSettlementRecords
  const sample = { records: [{ id: 'r1', amount: 100 }], limit: 50, offset: 0, count: 1 };
  const original = providerService.listProviderSettlementRecords;
  providerService.listProviderSettlementRecords = async () => sample;

  const req = { user: { id: 'prov_1' }, query: {} };
  let jsonPayload = null;
  const res = {
    json: (payload) => { jsonPayload = payload; },
    status: (code) => ({ json: (p) => { jsonPayload = p; } }),
  };

  try {
    await providerFinancialCtrl.getMySettlementRecords(req, res);
    assert.ok(jsonPayload && jsonPayload.records, 'Response should have top-level records');
    assert.ok(Array.isArray(jsonPayload.records.records), 'Inner records should be an array');
    assert.equal(jsonPayload.records.limit, 50);
  } finally {
    providerService.listProviderSettlementRecords = original;
  }
});
