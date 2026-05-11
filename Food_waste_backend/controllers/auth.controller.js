const pool = require("../shared/config/db");
const redis = require("../shared/config/redis");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const twilio = require("twilio");
const {
  generateAccessToken,
  generateRefreshToken,
} = require("../utils/token");
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

const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_REUSE_GRACE_SECONDS = 30;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getCookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? "none" : "lax",
    path: "/",
    maxAge,
  };
}

function getClearCookieOptions() {
  const { maxAge, ...options } = getCookieOptions(0);
  return options;
}

function setAccessCookie(res, accessToken) {
  res.cookie(
    "accessToken",
    accessToken,
    getCookieOptions(ACCESS_TOKEN_MAX_AGE_MS)
  );
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(
    "refreshToken",
    refreshToken,
    getCookieOptions(REFRESH_TOKEN_MAX_AGE_MS)
  );
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);
}

function getRefreshReuseKey(refreshToken) {
  return `auth:refresh-reuse:${crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex")}`;
}

async function rememberRotatedRefreshToken(oldRefreshToken, session) {
  await redis.setEx(
    getRefreshReuseKey(oldRefreshToken),
    REFRESH_REUSE_GRACE_SECONDS,
    JSON.stringify(session)
  );
}

async function getRecentlyRotatedRefreshToken(oldRefreshToken) {
  const raw = await redis.get(getRefreshReuseKey(oldRefreshToken));
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    return session?.accessToken && session?.refreshToken ? session : null;
  } catch {
    return null;
  }
}

async function getRecentlyRotatedRefreshTokenWithRetry(oldRefreshToken) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const session = await getRecentlyRotatedRefreshToken(oldRefreshToken);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return null;
}

function getRefreshExpiry() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  return expiry;
}

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

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();

    const expiry = getRefreshExpiry();

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
    setAuthCookies(res, { accessToken, refreshToken });

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
    const accessToken = generateAccessToken(updatedUser);

    setAccessCookie(res, accessToken);

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
      const reusedSession = await getRecentlyRotatedRefreshTokenWithRetry(
        refreshToken
      );

      if (reusedSession) {
        setAuthCookies(res, reusedSession);
        return res.json({ success: true });
      }

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
    const newRefreshToken = generateRefreshToken();
    const expiry = getRefreshExpiry();

    const updateResult = await pool.query(
      `
      UPDATE users
      SET refresh_token=$1,
          refresh_token_expiry=$2
      WHERE id=$3
        AND refresh_token=$4
      RETURNING id
      `,
      [newRefreshToken, expiry, user.id, refreshToken]
    );

    // 🔐 Generate new access token
    if (!updateResult.rows.length) {
      const reusedSession = await getRecentlyRotatedRefreshTokenWithRetry(
        refreshToken
      );

      if (reusedSession) {
        setAuthCookies(res, reusedSession);
        return res.json({ success: true });
      }

      return res.status(401).json({
        error: "Refresh token was already rotated",
      });
    }

    const accessToken = generateAccessToken(user);
    const session = { accessToken, refreshToken: newRefreshToken };

    try {
      await rememberRotatedRefreshToken(refreshToken, session);
    } catch (err) {
      console.warn("Unable to store refresh reuse grace entry:", err.message);
    }

    // 🍪 Set cookies (IMPORTANT FIX)
    setAuthCookies(res, session);

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

    const accessToken =
      generateAccessToken(user);

    const refreshToken =
      generateRefreshToken();

    const expiry = getRefreshExpiry();

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
    setAuthCookies(res, { accessToken, refreshToken });

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
        u.id,
        u.name,
        u.email,
        u.phone,
        u.role,
        CASE
          WHEN u.role = 'ngo' THEN COALESCE((
            SELECT n.is_verified
            FROM ngos n
            WHERE n.user_id = u.id
            ORDER BY n.id DESC
            LIMIT 1
          ), false)
          WHEN u.role = 'provider' THEN COALESCE((
            SELECT r.is_verified
            FROM restaurants r
            WHERE r.user_id = u.id
            ORDER BY r.id DESC
            LIMIT 1
          ), false)
          ELSE u.is_verified
        END AS is_verified,
        CASE
          WHEN u.role = 'ngo' THEN (
            SELECT n.rejection_reason
            FROM ngos n
            WHERE n.user_id = u.id
            ORDER BY n.id DESC
            LIMIT 1
          )
          WHEN u.role = 'provider' THEN (
            SELECT r.rejection_reason
            FROM restaurants r
            WHERE r.user_id = u.id
            ORDER BY r.id DESC
            LIMIT 1
          )
          ELSE NULL
        END AS rejection_reason,
        CASE
          WHEN u.role = 'ngo' AND NOT EXISTS (
            SELECT 1 FROM ngos n WHERE n.user_id = u.id
          ) THEN 'unregistered'
          WHEN u.role = 'provider' AND NOT EXISTS (
            SELECT 1 FROM restaurants r WHERE r.user_id = u.id
          ) THEN 'unregistered'
          WHEN u.role = 'ngo' AND EXISTS (
            SELECT 1 FROM ngos n
            WHERE n.user_id = u.id
              AND n.is_verified = true
          ) THEN 'approved'
          WHEN u.role = 'provider' AND EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.user_id = u.id
              AND r.is_verified = true
          ) THEN 'approved'
          WHEN u.role = 'ngo' AND EXISTS (
            SELECT 1 FROM ngos n
            WHERE n.user_id = u.id
              AND n.is_verified = false
              AND n.rejection_reason IS NOT NULL
          ) THEN 'rejected'
          WHEN u.role = 'provider' AND EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.user_id = u.id
              AND r.is_verified = false
              AND r.rejection_reason IS NOT NULL
          ) THEN 'rejected'
          WHEN u.role IN ('ngo', 'provider') THEN 'pending'
          ELSE 'approved'
        END AS verification_status,
        u.created_at
      FROM users u
      WHERE u.id=$1
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
    res.clearCookie("accessToken", getClearCookieOptions());
    res.clearCookie("refreshToken", getClearCookieOptions());

    return res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Logout failed",
    });
  }
};
