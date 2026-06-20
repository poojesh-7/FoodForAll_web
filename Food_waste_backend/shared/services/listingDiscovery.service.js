const FOOD_CATEGORIES = [
  "meals",
  "bakery",
  "beverages",
  "fruits",
  "vegetables",
  "dairy",
  "snacks",
  "prepared_food",
  "grocery",
  "other",
];

const DIETARY_TAGS = [
  "vegetarian",
  "vegan",
  "egg",
  "non_veg",
  "halal",
  "jain",
  "gluten_free",
];

const LISTING_SORTS = [
  "nearest",
  "newest",
  "pickup_ending_soon",
  "highest_quantity",
  "lowest_price",
  "highest_price",
  "highest_rated",
  "most_reviewed",
];

function withStatus(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseList(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(parseList);

  const text = String(value).trim();
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.flatMap(parseList);
    } catch {
      return text.split(",");
    }
  }

  return text.split(",");
}

function normalizeCategory(value, { required = false } = {}) {
  const category = String(value ?? "").trim().toLowerCase();
  if (!category) {
    if (required) throw withStatus("Food category is required");
    return null;
  }

  if (!FOOD_CATEGORIES.includes(category)) {
    throw withStatus("Invalid food category");
  }

  return category;
}

function normalizeDietaryTags(value) {
  const tags = [
    ...new Set(
      parseList(value)
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const invalid = tags.find((tag) => !DIETARY_TAGS.includes(tag));
  if (invalid) throw withStatus("Invalid dietary tag");

  return tags;
}

function normalizeDiscoveryFilters(query = {}) {
  const filters = {
    search: String(query.search ?? "").trim(),
    category: normalizeCategory(query.category),
    dietaryTags: normalizeDietaryTags(query.dietaryTags ?? query.dietary_tags),
    sort: String(query.sort ?? "").trim().toLowerCase() || null,
    distance:
      query.distance !== undefined && query.distance !== ""
        ? Number(query.distance)
        : null,
    minQuantity:
      query.minQuantity !== undefined && query.minQuantity !== ""
        ? Number(query.minQuantity)
        : null,
    maxPrice:
      query.maxPrice !== undefined && query.maxPrice !== ""
        ? Number(query.maxPrice)
        : null,
  };

  if (filters.search.length > 120) {
    throw withStatus("Search must be 120 characters or fewer");
  }

  if (filters.sort && !LISTING_SORTS.includes(filters.sort)) {
    throw withStatus("Invalid listing sort");
  }

  if (filters.distance !== null && (!Number.isFinite(filters.distance) || filters.distance < 0.1 || filters.distance > 100)) {
    throw withStatus("Distance must be between 0.1 and 100 km");
  }

  if (filters.minQuantity !== null && (!Number.isInteger(filters.minQuantity) || filters.minQuantity < 1 || filters.minQuantity > 10000)) {
    throw withStatus("Minimum quantity must be an integer between 1 and 10000");
  }

  if (filters.maxPrice !== null && (!Number.isFinite(filters.maxPrice) || filters.maxPrice < 0 || filters.maxPrice > 100000)) {
    throw withStatus("Maximum price must be between 0 and 100000");
  }

  return filters;
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function appendDiscoveryWhere(clauses, params, filters, options = {}) {
  const {
    foodAlias = "f",
    userAlias = "u",
    restaurantAlias = "restaurant",
    distanceExpression,
  } = options;

  if (filters.search) {
    const placeholder = addParam(params, `%${filters.search}%`);
    clauses.push(`(
      ${foodAlias}.title ILIKE ${placeholder}
      OR ${userAlias}.name ILIKE ${placeholder}
      OR COALESCE(${restaurantAlias}.restaurant_name, '') ILIKE ${placeholder}
      OR ${foodAlias}.category ILIKE ${placeholder}
    )`);
  }

  if (filters.category) {
    clauses.push(`${foodAlias}.category = ${addParam(params, filters.category)}`);
  }

  if (filters.dietaryTags.length > 0) {
    clauses.push(`${foodAlias}.dietary_tags && ${addParam(params, filters.dietaryTags)}::text[]`);
  }

  if (filters.minQuantity !== null) {
    clauses.push(`${foodAlias}.remaining_quantity >= ${addParam(params, filters.minQuantity)}`);
  }

  if (filters.maxPrice !== null) {
    clauses.push(`${foodAlias}.price <= ${addParam(params, filters.maxPrice)}`);
  }

  if (filters.distance !== null && distanceExpression) {
    clauses.push(`${distanceExpression} <= ${addParam(params, filters.distance)} * 1000`);
  }
}

function buildDiscoveryOrder(filters, { distanceExpression, defaultSort = "pickup_ending_soon" } = {}) {
  const sort = filters.sort || defaultSort;

  if (sort === "nearest" && distanceExpression) {
    return `${distanceExpression} ASC, f.pickup_end_time ASC`;
  }
  if (sort === "newest") return "f.created_at DESC, f.id DESC";
  if (sort === "highest_quantity") return "f.remaining_quantity DESC, f.pickup_end_time ASC";
  if (sort === "lowest_price") return "f.price ASC, f.pickup_end_time ASC";
  if (sort === "highest_price") return "f.price DESC, f.pickup_end_time ASC";
  if (sort === "highest_rated") {
    return "provider_reviews.average_rating DESC NULLS LAST, provider_reviews.total_reviews DESC NULLS LAST, f.pickup_end_time ASC";
  }
  if (sort === "most_reviewed") {
    return "provider_reviews.total_reviews DESC NULLS LAST, provider_reviews.average_rating DESC NULLS LAST, f.pickup_end_time ASC";
  }

  return "f.pickup_end_time ASC, f.created_at DESC";
}

module.exports = {
  FOOD_CATEGORIES,
  DIETARY_TAGS,
  appendDiscoveryWhere,
  buildDiscoveryOrder,
  normalizeCategory,
  normalizeDietaryTags,
  normalizeDiscoveryFilters,
};
