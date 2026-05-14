const validator = require("validator");
const { normalizeEmail } = require("./identity");
const { normalizePhoneNumber } = require("./phone");

const isProvided = (value) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const isValidId = (value) =>
  isProvided(value) && validator.isUUID(String(value).trim());

const isValidEmail = (value) =>
  isProvided(value) && validator.isEmail(normalizeEmail(value) || "");

const isValidPhone = (value) =>
  Boolean(normalizePhoneNumber(value));

const toNumber = (value) => Number(value);

const isValidLatitude = (value) => {
  if (!isProvided(value)) return false;
  const number = toNumber(value);
  return Number.isFinite(number) && number >= -90 && number <= 90;
};

const isValidLongitude = (value) => {
  if (!isProvided(value)) return false;
  const number = toNumber(value);
  return Number.isFinite(number) && number >= -180 && number <= 180;
};

const isIntegerInRange = (value, min, max) => {
  if (!isProvided(value)) return false;
  const number = toNumber(value);
  return Number.isInteger(number) && number >= min && number <= max;
};

const isNumberInRange = (value, min, max) => {
  if (!isProvided(value)) return false;
  const number = toNumber(value);
  return Number.isFinite(number) && number >= min && number <= max;
};

const parseBoolean = (value) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
};

module.exports = {
  isIntegerInRange,
  isNumberInRange,
  isProvided,
  isValidId,
  isValidEmail,
  isValidPhone,
  isValidLatitude,
  isValidLongitude,
  parseBoolean,
  normalizeEmail,
  toNumber,
};
