const jwt = require("jsonwebtoken");

exports.generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
};

exports.generateRefreshToken = () => {
  return require("crypto").randomBytes(64).toString("hex");
};
