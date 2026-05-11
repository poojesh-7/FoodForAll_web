const { rateLimit } = require("express-rate-limit");

function jsonRateLimitHandler(req, res) {
  return res.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
    data: null,
  });
}

function createLimiter(options) {
  return rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: jsonRateLimitHandler,
    ...options,
  });
}

const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

const reservationCreateLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 12,
});

const registrationLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 6,
});

const adminActionLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 60,
});

module.exports = {
  adminActionLimiter,
  authLimiter,
  registrationLimiter,
  reservationCreateLimiter,
};
