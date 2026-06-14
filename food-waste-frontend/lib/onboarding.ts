import type {
  AuthMeUser,
  AuthUser,
  UserRole,
} from "@shared/contracts/api-contracts";

type OnboardingUser = Partial<AuthMeUser & AuthUser>;
type VerificationRole = Extract<UserRole, "ngo" | "provider">;
type VerificationStatus = AuthMeUser["verification_status"];

export const pendingVerificationRoute = "/pending-verification";

const onboardingRoutes = [
  "/select-role",
  "/complete-profile",
  "/restaurant/register",
  "/ngo/register",
  pendingVerificationRoute,
];

export function isOnboardingRoute(pathname: string) {
  return onboardingRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export function isProfileComplete(user: OnboardingUser | null | undefined) {
  return Boolean(user?.role && user?.name && user?.email && user?.phone);
}

export function getRoleDashboard(role: UserRole | null | undefined) {
  if (role === "admin") return "/admin";
  if (role === "ngo") return "/ngo";
  if (role === "volunteer") return "/volunteer/dashboard";
  return "/dashboard";
}

export function getRoleRegistrationRoute(role: UserRole | null | undefined) {
  if (role === "provider") return "/restaurant/register";
  if (role === "ngo") return "/ngo/register";
  return "/complete-profile";
}

function isVerificationRole(role: UserRole | null | undefined): role is VerificationRole {
  return role === "provider" || role === "ngo";
}

function getVerificationStatus(user: OnboardingUser | null | undefined): VerificationStatus {
  if (!isVerificationRole(user?.role)) return "approved";
  if (user?.verification_status) return user.verification_status;
  if (user?.is_verified) return "approved";
  return "unregistered";
}

export function getPostAuthRedirect(user: OnboardingUser | null | undefined) {
  if (!user?.role) return "/select-role";

  if (user.role !== "admin" && !isProfileComplete(user)) {
    return "/complete-profile";
  }

  if (isVerificationRole(user.role)) {
    const verificationStatus = getVerificationStatus(user);

    if (verificationStatus === "approved" || user.is_verified) {
      return getRoleDashboard(user.role);
    }

    if (
      verificationStatus === "rejected" ||
      verificationStatus === "unregistered"
    ) {
      return getRoleRegistrationRoute(user.role);
    }

    return pendingVerificationRoute;
  }

  return getRoleDashboard(user.role);
}

export function isUserOnboarded(user: OnboardingUser | null | undefined) {
  if (!user?.role) return false;
  return getPostAuthRedirect(user) === getRoleDashboard(user.role);
}

export function getRegistrationRedirect(
  role: VerificationRole,
  isVerified: boolean | null | undefined
) {
  return isVerified ? getRoleDashboard(role) : pendingVerificationRoute;
}

export function getOnboardingRedirect(
  user: OnboardingUser | null | undefined,
  pathname: string
) {
  const target = getPostAuthRedirect(user);

  if (pathname === target) return null;
  if (
    pathname === pendingVerificationRoute &&
    isVerificationRole(user?.role)
  ) {
    return null;
  }
  if (isOnboardingRoute(pathname)) return target;

  return target === getRoleDashboard(user?.role) ? null : target;
}

export function getRouteAccessRedirect(
  user: OnboardingUser | null | undefined,
  pathname: string
) {
  if (!user?.role) {
    return pathname === "/select-role" ? null : "/select-role";
  }

  if (user.role !== "admin" && !isProfileComplete(user)) {
    return pathname === "/complete-profile" ? null : "/complete-profile";
  }

  if (pathname === "/select-role" || pathname.startsWith("/select-role/")) {
    return getPostAuthRedirect(user);
  }

  if (pathname.startsWith(pendingVerificationRoute)) {
    if (!isVerificationRole(user.role)) {
      return getPostAuthRedirect(user);
    }

    const verificationStatus = getVerificationStatus(user);

    if (verificationStatus === "approved" || user.is_verified) {
      return getRoleDashboard(user.role);
    }

    if (
      verificationStatus === "rejected" ||
      verificationStatus === "unregistered"
    ) {
      return getRoleRegistrationRoute(user.role);
    }

    return null;
  }

  if (
    pathname.startsWith("/admin") &&
    user?.role !== "admin"
  ) {
    return getPostAuthRedirect(user);
  }

  if (
    (pathname.startsWith("/provider") || pathname.startsWith("/restaurant/register")) &&
    user?.role !== "provider"
  ) {
    return getPostAuthRedirect(user);
  }

  if (user.role === "provider") {
    const verificationStatus = getVerificationStatus(user);

    if (
      pathname.startsWith("/provider") &&
      verificationStatus !== "approved" &&
      !user.is_verified
    ) {
      return verificationStatus === "rejected" ||
        verificationStatus === "unregistered"
        ? "/restaurant/register"
        : pendingVerificationRoute;
    }

    if (
      pathname.startsWith("/restaurant/register") &&
      (verificationStatus === "approved" || user.is_verified)
    ) {
      return getRoleDashboard(user.role);
    }
  }

  if (pathname.startsWith("/volunteer") && user?.role !== "volunteer") {
    return getPostAuthRedirect(user);
  }

  if (pathname.startsWith("/reservations") && user?.role !== "user") {
    return getPostAuthRedirect(user);
  }

  if (
    (pathname.startsWith("/payment-success") ||
      pathname.startsWith("/payment-failed")) &&
    user?.role !== "user"
  ) {
    return getPostAuthRedirect(user);
  }

  if (pathname.startsWith("/ngo/register") && user?.role !== "ngo") {
    return getPostAuthRedirect(user);
  }

  if (
    pathname.startsWith("/ngo") &&
    !pathname.startsWith("/ngo/register") &&
    user?.role !== "ngo"
  ) {
    return getPostAuthRedirect(user);
  }

  if (user.role === "ngo") {
    const verificationStatus = getVerificationStatus(user);

    if (
      pathname.startsWith("/ngo") &&
      !pathname.startsWith("/ngo/register") &&
      verificationStatus !== "approved" &&
      !user.is_verified
    ) {
      return verificationStatus === "rejected" ||
        verificationStatus === "unregistered"
        ? "/ngo/register"
        : pendingVerificationRoute;
    }

    if (
      pathname.startsWith("/ngo/register") &&
      (verificationStatus === "approved" || user.is_verified)
    ) {
      return getRoleDashboard(user.role);
    }
  }

  return null;
}

export function isPendingVerificationError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not verified") ||
    normalized.includes("verification")
  );
}
