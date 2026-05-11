const admin = require("../shared/config/firebase");
const logger = require("../shared/utils/logger");

exports.verifyFirebaseToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        error: "No token provided",
      });
    }

    const decoded = await admin.auth().verifyIdToken(token);

    req.firebaseUser = decoded; // contains phone_number, uid

    next();
  } catch (err) {
    logger.error("Firebase authentication failed", { err });
    return res.status(401).json({
      error: "Invalid Firebase token",
    });
  }
};
