const { loadEnv } = require("./load-env");

loadEnv();

const { validateEnvironment } = require("../shared/config/env");

try {
  validateEnvironment();
  process.stdout.write("Environment validation passed\n");
} catch (err) {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
}
