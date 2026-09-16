function normalizeNumeric(value) {
  if (value === undefined || value === null || value === "") return null;

  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}


function deriveSavings({ is_free, price, original_price }) {
  const rescuePrice = normalizeNumeric(price);
  const regularPrice = normalizeNumeric(original_price);

  if (is_free === true || rescuePrice === 0) {
    if (regularPrice !== null && regularPrice > 0 && rescuePrice === 0) {
      return {
        savings_amount: regularPrice,
        discount_percentage: 100,
        has_discount: true,
      };
    }

    return {
      savings_amount: 0,
      discount_percentage: 0,
      has_discount: false,
    };
  }

  if (regularPrice === null || rescuePrice === null) {
    return {
      savings_amount: 0,
      discount_percentage: 0,
      has_discount: false,
    };
  }

  if (regularPrice <= rescuePrice) {
    return {
      savings_amount: 0,
      discount_percentage: 0,
      has_discount: false,
    };
  }

  const savingsAmount = regularPrice - rescuePrice;
  const discountPercentage = (savingsAmount / regularPrice) * 100;

  return {
    savings_amount: Number(savingsAmount.toFixed(2)),
    discount_percentage: Number(discountPercentage.toFixed(0)),
    has_discount: true,
  };
}

function validateFoodPricing({ is_free, price, original_price }) {
  const isFree = Boolean(is_free);
  const rescuePrice = normalizeNumeric(price);
  const regularPrice = normalizeNumeric(original_price);

  if (isFree) {
    if (rescuePrice !== null && rescuePrice !== 0) {
      return {
        valid: false,
        error: "Free food cannot have a price.",
      };
    }

    return { valid: true };
  }

  if (rescuePrice === null || rescuePrice <= 0) {
    return {
      valid: false,
      error: "Rescue price must be greater than 0 for paid listings.",
    };
  }

  if (regularPrice === null || regularPrice <= 0) {
    return {
      valid: false,
      error: "Regular price must be greater than 0 for paid listings.",
    };
  }

  if (regularPrice <= rescuePrice) {
    return {
      valid: false,
      error: "Rescue price must be lower than the regular price.",
    };
  }

  return { valid: true };
}

module.exports = {
  deriveSavings,
  validateFoodPricing,
};
