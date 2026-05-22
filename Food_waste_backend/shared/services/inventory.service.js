function toQuantity(value) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    const error = new Error("Invalid inventory quantity");
    error.statusCode = 400;
    throw error;
  }

  return quantity;
}

async function reserveListingStock(
  client,
  { listingId, quantity, completeWhenEmpty = true }
) {
  const quantityValue = toQuantity(quantity);
  const result = await client.query(
    `
    UPDATE food_listings
    SET remaining_quantity = remaining_quantity - $1,
        status = CASE
          WHEN $3::boolean AND remaining_quantity - $1 <= 0 THEN 'completed'
          ELSE status
        END
    WHERE id=$2
    AND remaining_quantity >= $1
    RETURNING id, remaining_quantity, status
    `,
    [quantityValue, listingId, completeWhenEmpty]
  );

  if (!result.rows.length) {
    const error = new Error("Not enough quantity");
    error.statusCode = 409;
    error.reason = "insufficient_inventory";
    throw error;
  }

  return result.rows[0];
}

async function restoreListingStock(
  client,
  { listingId, quantity, reactivateIfAvailable = true }
) {
  const quantityValue = toQuantity(quantity);
  const result = await client.query(
    `
    UPDATE food_listings
    SET remaining_quantity = remaining_quantity + $1,
        status = CASE
          WHEN $3::boolean AND pickup_end_time > NOW() AND status='completed' THEN 'active'
          ELSE status
        END
    WHERE id=$2
    RETURNING id, remaining_quantity, status
    `,
    [quantityValue, listingId, reactivateIfAvailable]
  );

  return result.rows[0] || null;
}

module.exports = {
  reserveListingStock,
  restoreListingStock,
};
