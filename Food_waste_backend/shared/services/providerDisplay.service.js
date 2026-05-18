function resolveProviderDisplayName(provider = {}) {
  return (
    String(provider.restaurant_name || "").trim() ||
    String(provider.business_name || "").trim() ||
    String(provider.provider_name || provider.name || "").trim() ||
    "Restaurant unavailable"
  );
}

function providerDisplaySelect(alias = "provider_restaurant", userAlias = "provider") {
  return `
    COALESCE(
      NULLIF(TRIM(${alias}.restaurant_name), ''),
      NULLIF(TRIM(${alias}.business_name), ''),
      NULLIF(TRIM(${userAlias}.name), ''),
      'Restaurant unavailable'
    )
  `;
}

module.exports = {
  providerDisplaySelect,
  resolveProviderDisplayName,
};
