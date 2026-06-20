function providerReviewAggregateJoin(foodAlias = "f", alias = "provider_reviews") {
  return `
    LEFT JOIN (
      SELECT
        reviewed_listing.provider_id,
        ROUND(AVG(r.rating)::numeric, 1)::double precision AS average_rating,
        COUNT(r.id)::int AS total_reviews
      FROM ratings r
      JOIN food_listings reviewed_listing
        ON reviewed_listing.id = r.listing_id
      GROUP BY reviewed_listing.provider_id
    ) ${alias}
      ON ${alias}.provider_id = ${foodAlias}.provider_id
  `;
}

function providerReviewSummarySelect(alias = "provider_reviews") {
  return `
    COALESCE(${alias}.average_rating, 0)::double precision AS "averageRating",
    COALESCE(${alias}.total_reviews, 0)::int AS "totalReviews",
    COALESCE(${alias}.average_rating, 0)::double precision AS average_rating,
    COALESCE(${alias}.total_reviews, 0)::int AS total_reviews
  `;
}

module.exports = {
  providerReviewAggregateJoin,
  providerReviewSummarySelect,
};
