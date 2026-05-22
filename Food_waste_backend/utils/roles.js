const SELF_SERVICE_ROLES = Object.freeze(["user", "volunteer"]);
const PRIVILEGED_ROLES = Object.freeze(["provider", "ngo", "admin"]);

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function isPrivilegedRole(role) {
  return PRIVILEGED_ROLES.includes(normalizeRole(role));
}

function isSelfServiceRole(role) {
  return SELF_SERVICE_ROLES.includes(normalizeRole(role));
}

function validateSelfServiceRole(role) {
  const normalizedRole = normalizeRole(role);

  return {
    allowed: isSelfServiceRole(normalizedRole),
    privileged: isPrivilegedRole(normalizedRole),
    role: normalizedRole,
  };
}

module.exports = {
  PRIVILEGED_ROLES,
  SELF_SERVICE_ROLES,
  isPrivilegedRole,
  isSelfServiceRole,
  normalizeRole,
  validateSelfServiceRole,
};
