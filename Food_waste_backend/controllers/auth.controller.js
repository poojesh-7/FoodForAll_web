const pool = require("../shared/config/db");
const redis = require("../shared/config/redis");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const twilio = require("twilio");
const {
  isProvided,
  isValidEmail,
  isValidPhone,
  isValidLatitude,
  isValidLongitude,
  toNumber,
} = require("../utils/validation");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
// SEND OTP
exports.sendOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        error: "Valid phone number required",
      });
    }

    // await client.verify.v2
    //   .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    //   .verifications.create({
    //     to: `+91${phone}`,
    //     channel: "sms",
    //   });

    res.json({
      success: true,
      message: "OTP sent successfully",
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to send OTP",
    });
  }
};

// // VERIFY OTP
// exports.verifyOTP = async (req, res) => {
//   try {
//     const { phone, otp } = req.body;

//     if (!phone || !otp) {
//       return res.status(400).json({
//         error: "Phone and OTP required",
//       });
//     }
    
//     // const verificationCheck =
//     //   await client.verify.v2
//     //     .services(
//     //       process.env.TWILIO_VERIFY_SERVICE_SID
//     //     )
//     //     .verificationChecks.create({
//     //       to: `+91${phone}`,
//     //       code: otp,
//     //     });
    
//     //     if (verificationCheck.status !== "approved") {
//     //   return res.status(401).json({
//     //     error: "Invalid OTP",
//     //   });
//     // }
//     // console.log("OTP check result:", verificationCheck.status);

//     // CHECK USER
//     const result = await pool.query(
//       `SELECT id, role FROM users WHERE phone=$1`,
//       [phone]
//     );

//     // EXISTING USER
//     if (result.rows.length) {
//       const user = result.rows[0];

//       const {
//         generateAccessToken,
//         generateRefreshToken,
//       } = require("../utils/token");

//       const accessToken =
//         generateAccessToken(user);

//       const refreshToken =
//         generateRefreshToken();

//         const expiry = new Date();
//         expiry.setDate(expiry.getDate() + 7);
        
//         await pool.query(
//           `
//           UPDATE users
//           SET refresh_token=$1,
//             refresh_token_expiry=$2
//         WHERE id=$3
//         `,
//         [refreshToken, expiry, user.id]
//       );
      
//       res.cookie("accessToken", accessToken, {
//         httpOnly: true,
//         // secure: process.env.NODE_ENV === "production",
//         secure: false,
//         sameSite: "lax",
//         maxAge: 15 * 60 * 1000, // 15 min
//       });

//       res.cookie("refreshToken", refreshToken, {
//         httpOnly: true,
//         // secure: process.env.NODE_ENV === "production",
//         secure: false,
//         sameSite: "lax",
//         maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
//       });
      
//       return res.json({
//         user,
//         isNewUser: false,
//       });
//     }
    
//     console.log(accessToken, refreshToken);
//     // NEW USER
//     return res.json({
//       message:
//         "New user, complete profile",
//       isNewUser: true,
//       phone,
//     });

//   } catch (err) {
//     console.error(err);

//     res.status(500).json({
//       error: "OTP verification failed",
//     });
//   }
// };

exports.verifyOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        error: "Valid phone required",
      });
    }

    const normalizedPhone = String(phone).trim();

    // 🔥 OTP disabled for dev

    // CHECK USER
    let result = await pool.query(
      `SELECT id, role FROM users WHERE phone=$1`,
      [normalizedPhone]
    );

    let user;

    // 🆕 CREATE USER IF NOT EXISTS
    if (!result.rows.length) {
      const newUser = await pool.query(
        `
        INSERT INTO users (phone, role)
        VALUES ($1, $2)
        RETURNING id, role
        `,
        [normalizedPhone, null] // or "user" default
      );

      user = newUser.rows[0];
    } else {
      user = result.rows[0];
    }

    const {
      generateAccessToken,
      generateRefreshToken,
    } = require("../utils/token");

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7);

    await pool.query(
      `
      UPDATE users
      SET refresh_token=$1,
          refresh_token_expiry=$2
      WHERE id=$3
      `,
      [refreshToken, expiry, user.id]
    );

    // 🍪 SET COOKIES
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: "OTP verified successfully",
      data: {
        user,
        isNewUser: !result.rows.length,
      },
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "OTP verification failed",
    });
  }
};

exports.setRole = async (req, res) => {
  try {
    const userId = req.user.id;
    const { role } = req.body;

    if (!isProvided(role)) {
      return res.status(400).json({
        success: false,
        message: "Role is required",
        data: null,
      });
    }

    const normalizedRole = String(role).trim();
    const allowedRoles = ["user", "volunteer", "ngo", "provider"];

    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role",
        data: null,
      });
    }

    const result = await pool.query(
      `UPDATE users SET role=$1 WHERE id=$2 RETURNING id, role`,
      [normalizedRole, userId]
    );

    const updatedUser = result.rows[0];

    // 🔥 Regenerate access token with updated role
    const { generateAccessToken } = require("../utils/token");

    const accessToken = generateAccessToken(updatedUser);

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: "Role set successfully",
      data: {
        user: updatedUser,
      },
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Failed to set role",
      data: null,
    });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        error: "Refresh token required",
      });
    }

    const result = await pool.query(
      `
      SELECT id, role, refresh_token, refresh_token_expiry
      FROM users
      WHERE refresh_token=$1
      `,
      [refreshToken]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: "Invalid refresh token",
      });
    }

    const user = result.rows[0];

    if (new Date(user.refresh_token_expiry) < new Date()) {
      return res.status(401).json({
        error: "Refresh token expired",
      });
    }

    // 🔁 Rotate refresh token
    const newRefreshToken = require("crypto")
      .randomBytes(64)
      .toString("hex");

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7);

    await pool.query(
      `
      UPDATE users
      SET refresh_token=$1,
          refresh_token_expiry=$2
      WHERE id=$3
      `,
      [newRefreshToken, expiry, user.id]
    );

    // 🔐 Generate new access token
    const accessToken = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    // 🍪 Set cookies (IMPORTANT FIX)
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      // secure: process.env.NODE_ENV === "production",
      secure: false,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      // secure: process.env.NODE_ENV === "production",
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({ success: true });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Token refresh failed",
    });
  }
};

exports.completeProfile = async (req, res) => {
  try {
    const {
      phone,
      name,
      email,
      role,
      address,
      latitude,
      longitude,
    } = req.body;

    console.log(req.body);

    if (!isProvided(phone) || !isProvided(name) || !isProvided(email) || !isProvided(role)) {
      return res.status(400).json({
        error: "Phone, name, email, and role are required",
      });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        error: "Invalid phone",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "Invalid email",
      });
    }

    const normalizedRole = String(role).trim();
    const allowedRoles = ["user", "volunteer", "ngo", "provider"];

    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({
        error: "Invalid role",
      });
    }

    const normalizedPhone = String(phone).trim();

    const normalizedEmail =
      String(email).toLowerCase().trim();

    const normalizedName =
      String(name).trim();

    const normalizedAddress =
      isProvided(address) ? String(address).trim() : null;

    const hasLatitude = isProvided(latitude);
    const hasLongitude = isProvided(longitude);

    if (hasLatitude !== hasLongitude) {
      return res.status(400).json({
        error:
          "Both latitude and longitude must be provided",
      });
    }

    if (hasLatitude && !isValidLatitude(latitude)) {
      return res.status(400).json({
        error: "Invalid latitude",
      });
    }

    if (hasLongitude && !isValidLongitude(longitude)) {
      return res.status(400).json({
        error: "Invalid longitude",
      });
    }

    const latitudeValue = hasLatitude ? toNumber(latitude) : null;
    const longitudeValue = hasLongitude ? toNumber(longitude) : null;
    const hasLocation = hasLatitude && hasLongitude;

    const result = await pool.query(
      `
      INSERT INTO users (
        name,
        phone,
        email,
        role,
        address,
        latitude,
        longitude,
        location,
        is_verified
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        true
      )
      ON CONFLICT (phone)
      DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        address = EXCLUDED.address,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        location = EXCLUDED.location,
        is_verified = true
      RETURNING
        id,
        name,
        phone,
        email,
        role,
        address,
        latitude,
        longitude
      `,
      [
        normalizedName,
        normalizedPhone,
        normalizedEmail,
        normalizedRole,
        normalizedAddress,
        latitudeValue,
        longitudeValue,

        hasLocation
          ? `SRID=4326;POINT(${longitudeValue} ${latitudeValue})`
          : null,
      ]
    );
    const user = result.rows[0];

    const {
      generateAccessToken,
      generateRefreshToken,
    } = require("../utils/token");

    const accessToken =
      generateAccessToken(user);

    const refreshToken =
      generateRefreshToken();

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7);

    await pool.query(
      `
      UPDATE users
      SET refresh_token=$1,
          refresh_token_expiry=$2
      WHERE id=$3
      `,
      [refreshToken, expiry, user.id]
    );

    // 🍪 SET COOKIES (FIX)
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      // secure: process.env.NODE_ENV === "production",
      secure: false,
      sameSite: "lax",
      maxAge: 15 * 60 * 1000, // 15 min
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      // secure: process.env.NODE_ENV === "production",
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // ✅ SEND CLEAN RESPONSE
    res.json({
      user,
    });

  } catch (err) {
    console.error(err);

    if (err.code === "23505") {
      return res.status(409).json({
        error: "User already exists",
      });
    }

    res.status(500).json({
      error: "Profile completion failed",
    });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      address,
      latitude,
      longitude,
    } = req.body;

    if (!isProvided(latitude) || !isProvided(longitude)) {
      return res.status(400).json({
        error:
          "Latitude and longitude required",
      });
    }

    if (!isValidLatitude(latitude)) {
      return res.status(400).json({
        error: "Invalid latitude",
      });
    }

    if (!isValidLongitude(longitude)) {
      return res.status(400).json({
        error: "Invalid longitude",
      });
    }

    const latitudeValue = toNumber(latitude);
    const longitudeValue = toNumber(longitude);

    const result = await pool.query(
      `
      UPDATE users
      SET
        address = $1,
        latitude = $2,
        longitude = $3,
        location = ST_SetSRID(
          ST_MakePoint($3,$2),
          4326
        )::geography
      WHERE id = $4
      RETURNING
        id,
        address,
        latitude,
        longitude
      `,
      [
        address || null,
        latitudeValue,
        longitudeValue,
        userId,
      ]
    );

    res.json({
      message:
        "Location updated successfully",
      user: result.rows[0],
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error:
        "Failed to update location",
    });
  }
};

// GET ME
exports.getMe = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        phone,
        role,
        is_verified,
        created_at
      FROM users
      WHERE id=$1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json({
      success: true,
      user: result.rows[0],
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to fetch user",
    });
  }
};

// LOGOUT
exports.logout = async (req, res) => {
  try {
    // 🔒 Optional DB cleanup only if user exists
    if (req.user?.id) {
      await pool.query(
        `
        UPDATE users
        SET refresh_token=NULL,
            refresh_token_expiry=NULL
        WHERE id=$1
        `,
        [req.user.id]
      );
    }

    // 🍪 Always clear cookies
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Logout failed",
    });
  }
};
