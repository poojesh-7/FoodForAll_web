const { sanitizeOptionalText } = require("../utils/sanitize");

const QUANTITY_UNITS = [
  "Meal Box",
  "Food Packet",
  "Plate",
  "Container",
  "Tray",
  "Loaf",
  "Bottle",
  "Liter",
  "Kilogram",
  "Piece",
  "Other",
];

function normalizeQuantityUnit(value) {
  const unit = String(value ?? "").trim();
  if (!unit) {
    const error = new Error("Quantity unit is required");
    error.statusCode = 400;
    throw error;
  }

  if (!QUANTITY_UNITS.includes(unit)) {
    const error = new Error("Invalid quantity unit");
    error.statusCode = 400;
    throw error;
  }

  return unit;
}

function normalizeCustomQuantityUnit(unit, value) {
  if (unit !== "Other") {
    return null;
  }

  const customUnit = sanitizeOptionalText(value, {
    maxLength: 80,
    preserveNewlines: false,
  });

  if (!customUnit) {
    const error = new Error("Custom quantity unit is required when quantity unit is Other");
    error.statusCode = 400;
    throw error;
  }

  return customUnit;
}

function normalizeQuantityUnitFields(body, fallbackUnit = "Piece") {
  const hasQuantityUnit = Object.prototype.hasOwnProperty.call(body, "quantity_unit");
  const unit = normalizeQuantityUnit(hasQuantityUnit ? body.quantity_unit : fallbackUnit);
  const customUnit = normalizeCustomQuantityUnit(unit, body.custom_quantity_unit);

  if (unit !== "Other" && body.custom_quantity_unit !== undefined && body.custom_quantity_unit !== null && String(body.custom_quantity_unit).trim() !== "") {
    const error = new Error("Custom quantity unit is only allowed when quantity unit is Other");
    error.statusCode = 400;
    throw error;
  }

  return {
    quantityUnit: unit,
    customQuantityUnit: customUnit,
  };
}

module.exports = {
  QUANTITY_UNITS,
  normalizeQuantityUnitFields,
};
