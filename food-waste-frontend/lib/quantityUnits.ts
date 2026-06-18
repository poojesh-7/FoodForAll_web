export const quantityUnits = [
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
] as const;

export type QuantityUnit = (typeof quantityUnits)[number];

export const fallbackQuantityUnit: QuantityUnit = "Piece";

function isQuantityUnit(value: unknown): value is QuantityUnit {
  return quantityUnits.includes(value as QuantityUnit);
}

export function normalizeQuantityUnit(value: unknown): QuantityUnit {
  const unit = String(value ?? "").trim();
  return isQuantityUnit(unit) ? unit : fallbackQuantityUnit;
}

function pluralizeUnit(unit: string, quantity: number) {
  if (quantity === 1) return unit;

  if (/[^aeiou]y$/i.test(unit)) return unit.replace(/y$/i, "ies");
  if (/f$/i.test(unit)) return unit.replace(/f$/i, "ves");
  if (/fe$/i.test(unit)) return unit.replace(/fe$/i, "ves");
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  return `${unit}s`;
}

export function getQuantityUnitLabel(source: {
  quantity_unit?: unknown;
  custom_quantity_unit?: unknown;
}) {
  const unit = normalizeQuantityUnit(source.quantity_unit);
  if (unit !== "Other") return unit;

  const customUnit = String(source.custom_quantity_unit ?? "").trim();
  return customUnit || fallbackQuantityUnit;
}

export function formatQuantityWithUnit(
  quantity: unknown,
  source: {
    quantity_unit?: unknown;
    custom_quantity_unit?: unknown;
  }
) {
  if (quantity === null || quantity === undefined || quantity === "") return "-";

  const numericQuantity = Number(quantity);
  const unit = getQuantityUnitLabel(source);
  const displayUnit = Number.isFinite(numericQuantity)
    ? pluralizeUnit(unit, numericQuantity)
    : unit;

  return `${String(quantity)} ${displayUnit}`;
}
