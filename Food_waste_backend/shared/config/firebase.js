const admin = require("firebase-admin");
const fs = require("fs");

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(
      fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")
    );
  }

  try {
    return require("../../../../food-waste-ef8ef-firebase-adminsdk-fbsvc-98ea856101.json");
  } catch (err) {
    return null;
  }
}

const serviceAccount = loadServiceAccount();

if (serviceAccount && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else if (!serviceAccount) {
  console.warn(
    "[Firebase] No service account configured. Push notifications are disabled."
  );
}

module.exports = serviceAccount ? admin : null;