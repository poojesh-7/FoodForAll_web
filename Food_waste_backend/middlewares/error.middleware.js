const logger = require("../shared/utils/logger");
const { captureError } = require("../shared/services/errorTracking.service");

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getStatusCode(err) {
  const status = Number(err?.statusCode || err?.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

function sendError(res, statusCode, message, details) {
  const payload = {
    success: false,
    message,
    error: message,
    data: null,
  };

  if (details !== undefined && !isProduction()) {
    payload.details = details;
  }

  return res.status(statusCode).json(payload);
}

function notFoundHandler(req, res) {
  return sendError(res, 404, "Route not found");
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err?.message === "Origin not allowed by CORS") {
    return sendError(res, 403, "Origin not allowed by CORS");
  }

  if (err instanceof SyntaxError && "body" in err) {
    return sendError(res, 400, "Invalid JSON body");
  }

  if (err?.type === "entity.too.large") {
    return sendError(res, 413, "Request body is too large");
  }

  if (err?.name === "MulterError") {
    let message = "Invalid upload";
    if (err.code === "LIMIT_FILE_SIZE") {
      message = "Uploaded file is too large";
    } else if (err.code === "LIMIT_FILE_COUNT") {
      message = "Too many files uploaded";
    }
    return sendError(res, 400, message);
  }

  if (
    err?.message === "Only JPG, JPEG, PNG allowed" ||
    err?.message === "Only JPG, JPEG, PNG, or WEBP images allowed" ||
    err?.message === "Uploaded file content does not match its image type" ||
    err?.message === "Uploaded file is empty"
  ) {
    return sendError(res, 400, err.message);
  }

  const statusCode = getStatusCode(err);
  const publicMessage =
    statusCode >= 500 && isProduction()
      ? "Internal server error"
      : err?.message || "Internal server error";

  logger.error("API request failed", {
    err,
    request: {
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id,
      role: req.user?.role,
      ip: req.ip,
    },
  });
  void captureError(err, {
    category: err?.category,
    eventName: "api_request_failed",
    severity: statusCode >= 500 ? "error" : "warning",
    method: req.method,
    path: req.originalUrl,
    statusCode,
    userId: req.user?.id,
    role: req.user?.role,
    alert: statusCode >= 500,
    alertKey: statusCode >= 500 ? `api:${req.method}:${req.route?.path || req.path}` : undefined,
  });

  return sendError(res, statusCode, publicMessage, err?.message);
}

module.exports = {
  errorHandler,
  notFoundHandler,
  sendError,
};
