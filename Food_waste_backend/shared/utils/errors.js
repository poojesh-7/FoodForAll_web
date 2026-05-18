class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = options.statusCode || options.status || 500;
    this.code = options.code;
    this.category = options.category || "application";
    this.details = options.details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = "Validation failed", options = {}) {
    super(message, { statusCode: 400, category: "validation", ...options });
  }
}

class PaymentError extends AppError {
  constructor(message = "Payment processing failed", options = {}) {
    super(message, { statusCode: 502, category: "payment", ...options });
  }
}

class RestrictionError extends AppError {
  constructor(message = "Action restricted", options = {}) {
    super(message, { statusCode: 403, category: "restriction", ...options });
  }
}

class QueueProcessingError extends AppError {
  constructor(message = "Queue job failed", options = {}) {
    super(message, { statusCode: 500, category: "queue", ...options });
  }
}

class WebhookVerificationError extends AppError {
  constructor(message = "Webhook verification failed", options = {}) {
    super(message, { statusCode: 401, category: "webhook", ...options });
  }
}

function categorizeError(err) {
  if (!err) return "unknown";
  if (err.category) return err.category;
  if (err.name === "ValidationError" || err.statusCode === 400) return "validation";
  if (err.name === "PaymentError") return "payment";
  if (err.name === "RestrictionError" || err.statusCode === 403) return "restriction";
  if (err.name === "QueueProcessingError") return "queue";
  if (err.name === "WebhookVerificationError") return "webhook";
  if (err.statusCode >= 500 || !err.statusCode) return "system";
  return "application";
}

module.exports = {
  AppError,
  PaymentError,
  QueueProcessingError,
  RestrictionError,
  ValidationError,
  WebhookVerificationError,
  categorizeError,
};
