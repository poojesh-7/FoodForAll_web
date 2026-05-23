const path = require("path");
const {
  assertBackendArchitecture,
} = require("../shared/utils/backendArchitectureValidation");

try {
  const report = assertBackendArchitecture({
    rootDir: path.resolve(__dirname, ".."),
    logger: {
      info(message, meta) {
        process.stdout.write(`${message}: ${JSON.stringify(meta)}\n`);
      },
      warn(message, meta) {
        process.stderr.write(`${message}: ${JSON.stringify(meta)}\n`);
      },
      error(message, meta) {
        process.stderr.write(`${message}: ${JSON.stringify(meta)}\n`);
      },
    },
  });

  process.stdout.write(
    `Scanned ${report.summary.filesScanned} files, ${report.summary.routesScanned} routes, ${report.summary.mountedRoutesScanned} mounts\n`,
  );
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
