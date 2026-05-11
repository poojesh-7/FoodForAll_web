const validator = require("validator");

const isProvided = (value) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const isValidId = (value) =>
  isProvided(value) && validator.isUUID(String(value).trim());

const isValidEmail = (value) =>
  isProvided(value) && validator.isEmail(String(value).trim());

const isValidPhone = (value) =>
  isProvided(value) && validator.isMobilePhone(String(value).trim(), "any");

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
  toNumber,
};
