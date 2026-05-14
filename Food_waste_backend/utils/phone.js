const validator = require("validator");

function normalizePhoneNumber(value) {
  if (value === undefined || value === null) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  let phone = raw.replace(/[\s().-]/g, "");
  phone = phone.replace(/^00/, "+");

  if (/^0[6-9]\d{9}$/.test(phone)) {
    phone = phone.slice(1);
  }

  if (/^[6-9]\d{9}$/.test(phone)) {
    phone = `+91${phone}`;
  } else if (/^91[6-9]\d{9}$/.test(phone)) {
    phone = `+${phone}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return null;
  }

  if (!validator.isMobilePhone(phone, "any", { strictMode: true })) {
    return null;
  }

  return phone;
}

function getPhoneLookupValues(value) {
  const normalizedPhone = normalizePhoneNumber(value);
  if (!normalizedPhone) return [];

  const variants = new Set([normalizedPhone]);
  const raw = String(value).trim();

  if (raw) {
    variants.add(raw);
    variants.add(raw.replace(/[\s().-]/g, ""));
  }

  if (normalizedPhone.startsWith("+91")) {
    const nationalNumber = normalizedPhone.slice(3);
    variants.add(nationalNumber);
    variants.add(`0${nationalNumber}`);
    variants.add(`91${nationalNumber}`);
  }

  return Array.from(variants).filter(Boolean);
}

module.exports = {
  getPhoneLookupValues,
  normalizePhoneNumber,
};
