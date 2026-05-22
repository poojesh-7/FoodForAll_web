const SELF_SERVICE_ROLES = Object.freeze(["user", "volunteer"]);
const ONBOARDING_ROLES = Object.freeze(["provider", "ngo"]);
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

function isOnboardingRole(role) {
  return ONBOARDING_ROLES.includes(normalizeRole(role));
}

function validateSelfServiceRole(role) {
  const normalizedRole = normalizeRole(role);

  return {
    allowed: isSelfServiceRole(normalizedRole),
    privileged: isPrivilegedRole(normalizedRole),
    role: normalizedRole,
  };
}

function validateOnboardingRoleSelection(role, currentRole = null) {
  const normalizedRole = normalizeRole(role);
  const normalizedCurrentRole = normalizeRole(currentRole);
  const privileged = isPrivilegedRole(normalizedRole);

  if (isSelfServiceRole(normalizedRole)) {
    return {
      allowed: true,
      onboarding: false,
      privileged,
      reason: null,
      role: normalizedRole,
    };
  }

  if (!isOnboardingRole(normalizedRole)) {
    return {
      allowed: false,
      onboarding: false,
      privileged,
      reason: privileged ? "privileged_role_forbidden" : "unsupported_role",
      role: normalizedRole,
    };
  }

  const canStartOnboarding =
    !normalizedCurrentRole ||
    SELF_SERVICE_ROLES.includes(normalizedCurrentRole) ||
    normalizedCurrentRole === normalizedRole;

  return {
    allowed: canStartOnboarding,
    onboarding: true,
    privileged,
    reason: canStartOnboarding ? null : "privileged_role_switch_forbidden",
    role: normalizedRole,
  };
}

module.exports = {
  ONBOARDING_ROLES,
  PRIVILEGED_ROLES,
  SELF_SERVICE_ROLES,
  isPrivilegedRole,
  isOnboardingRole,
  isSelfServiceRole,
  normalizeRole,
  validateOnboardingRoleSelection,
  validateSelfServiceRole,
};
