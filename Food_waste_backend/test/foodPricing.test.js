const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deriveSavings,
  validateFoodPricing,
} = require("../shared/services/foodPricing.service");

test("paid listing derives savings and percentage", () => {
  const result = deriveSavings({
    is_free: false,
    price: 20,
    original_price: 50,
  });

  assert.deepEqual(result, {
    savings_amount: 30,
    discount_percentage: 60,
    has_discount: true,
  });
});

test("paid listing rejects rescue price above regular price", () => {
  const result = validateFoodPricing({
    is_free: false,
    price: 50,
    original_price: 20,
  });

  assert.equal(result.valid, false);
  assert.match(result.error, /Rescue price must be lower than the regular price/i);
});

test("paid listing rejects equal price and regular price", () => {
  const result = validateFoodPricing({
    is_free: false,
    price: 50,
    original_price: 50,
  });

  assert.equal(result.valid, false);
});

test("free listing keeps zero price valid", () => {
  const result = validateFoodPricing({
    is_free: true,
    price: 0,
    original_price: null,
  });

  assert.equal(result.valid, true);
});
