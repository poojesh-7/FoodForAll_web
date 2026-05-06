const admin = require("firebase-admin");
const serviceAccount = require("../../../../food-waste-ef8ef-firebase-adminsdk-fbsvc-98ea856101.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
