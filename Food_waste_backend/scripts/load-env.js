const fs = require("fs");
const dotenv = require("dotenv");

function loadEnv() {
  const explicitFile = process.env.ENV_FILE;
  const candidates = explicitFile ? [explicitFile] : [".env", "dev.env"];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false, quiet: true });
    }
  }
}

module.exports = {
  loadEnv,
};
