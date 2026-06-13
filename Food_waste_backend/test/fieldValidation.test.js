const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeBusinessName,
  normalizeFssaiNumber,
  normalizePersonName,
  normalizeRegistrationNumber,
  normalizeRequiredAddress,
  normalizeRequiredPhone,
  normalizeServiceRadiusKm,
} = require("../utils/fieldValidation");

test("strict profile validation accepts meaningful identity fields", () => {
  assert.equal(normalizePersonName("Asha Kumar"), "Asha Kumar");
  assert.equal(normalizeRequiredPhone("9876543210"), "+919876543210");
  assert.equal(normalizeBusinessName("Seva Food Trust"), "Seva Food Trust");
  assert.equal(normalizeRegistrationNumber("NGO/KA-2026-17"), "NGO/KA-2026-17");
  assert.equal(normalizeFssaiNumber("1234 5678 9012 34"), "12345678901234");
  assert.equal(normalizeRequiredAddress("12 MG Road, Bengaluru"), "12 MG Road, Bengaluru");
  assert.equal(normalizeServiceRadiusKm("25", 10), 25);
});

test("strict profile validation rejects placeholders and malformed values", () => {
  assert.throws(() => normalizePersonName("asdf"), /meaningful/);
  assert.throws(() => normalizeBusinessName("Restaurant Name"), /meaningful/);
  assert.throws(() => normalizeRegistrationNumber("!!!!"), /meaningful/);
  assert.throws(() => normalizeFssaiNumber("12345"), /14 digit/);
  assert.throws(() => normalizeRequiredAddress("aaaaa"), /meaningful/);
  assert.throws(() => normalizeRequiredPhone("123"), /valid/);
  assert.throws(() => normalizeServiceRadiusKm("200", 10), /whole number between 1 and 100/);
});
