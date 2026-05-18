const { isProductionLike } = require("./env");

function runtimeSchemaMutationsEnabled() {
  return (
    !isProductionLike(process.env.APP_ENV) ||
    process.env.ALLOW_RUNTIME_SCHEMA_MUTATION === "true"
  );
}

function shouldSkipRuntimeSchemaMutation() {
  return !runtimeSchemaMutationsEnabled();
}

module.exports = {
  runtimeSchemaMutationsEnabled,
  shouldSkipRuntimeSchemaMutation,
};
