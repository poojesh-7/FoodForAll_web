const logger = require("../shared/utils/logger");
const {
  contextFromRequest,
  mergeContext,
  runWithContext,
} = require("../shared/utils/requestContext");

function requestContextMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const context = contextFromRequest(req);

  runWithContext(context, () => {
    req.requestId = context.requestId;
    res.setHeader("x-request-id", context.requestId);

    res.on("finish", () => {
      mergeContext({
        userId: req.user?.id,
        role: req.user?.role,
      });

      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1000000;
      const meta = {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs),
        userId: req.user?.id,
        role: req.user?.role,
        ip: req.ip,
      };

      if (res.statusCode >= 500) {
        logger.error("HTTP request completed with server error", meta);
      } else if (res.statusCode >= 400) {
        logger.warn("HTTP request completed with client error", meta);
      } else {
        logger.info("HTTP request completed", meta);
      }
    });

    next();
  });
}

module.exports = requestContextMiddleware;
