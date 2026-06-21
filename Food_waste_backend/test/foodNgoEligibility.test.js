const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const controllerPath = path.join(__dirname, "..", "controllers", "food.controller.js");
const source = fs.readFileSync(controllerPath, "utf8");

test("provider NGO list filters only currently eligible NGOs", () => {
  assert.match(source, /JOIN users u ON u\.id=n\.user_id/);
  assert.match(source, /LEFT JOIN trust_scores ts/);
  assert.match(source, /u\.role = 'ngo'/);
  assert.match(source, /u\.banned_until IS NULL OR u\.banned_until <= NOW\(\)/);
  assert.match(source, /u\.cooldown_until IS NULL OR u\.cooldown_until <= NOW\(\)/);
  assert.match(source, /LOWER\(TRIM\(n\.organization_name\)\) <> 'anonymized ngo'/);
  assert.match(source, /LOWER\(TRIM\(COALESCE\(u\.name, ''\)\)\) NOT LIKE 'deleted user %'/);
  assert.match(source, /ts\.projected_restriction_level/);
  assert.match(source, /ts\.projected_cooldown_until/);
});

test("direct provider NGO requests validate the same NGO eligibility", () => {
  assert.match(source, /Blocked provider request to ineligible NGO/);
  assert.match(source, /NGO is not eligible for new requests/);
  assert.match(source, /return res\.status\(403\)\.json\(\{ error: "NGO is not eligible for new requests" \}\)/);
});
