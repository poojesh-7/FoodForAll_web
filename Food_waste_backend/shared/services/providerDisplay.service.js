function resolveProviderDisplayName(provider = {}) {
  return (
    String(provider.restaurant_name || "").trim() ||
    String(provider.business_name || "").trim() ||
    String(provider.provider_name || provider.name || "").trim() ||
    "Unknown provider"
  );
}

function providerDisplaySelect(alias = "provider_restaurant", userAlias = "provider") {
  return `
    COALESCE(
      NULLIF(TRIM(${alias}.restaurant_name), ''),
      NULLIF(TRIM(${alias}.business_name), ''),
      NULLIF(TRIM(${userAlias}.name), ''),
      'Unknown provider'
    )
  `;
}

module.exports = {
  providerDisplaySelect,
  resolveProviderDisplayName,
};
