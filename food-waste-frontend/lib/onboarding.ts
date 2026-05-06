import type {
  AuthMeUser,
  AuthUser,
  UserRole,
} from "@backend/contracts/api-contracts";

type OnboardingUser = Partial<AuthMeUser & AuthUser>;
type VerificationRole = Extract<UserRole, "ngo" | "provider">;

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
  void role;
  return "/dashboard";
}

export function getRoleRegistrationRoute(role: UserRole | null | undefined) {
  if (role === "provider") return "/restaurant/register";
  if (role === "ngo") return "/ngo/register";
  return "/complete-profile";
}

export function getPostAuthRedirect(user: OnboardingUser | null | undefined) {
  if (!user?.role) return "/select-role";
  if (user.role === "provider" || user.role === "ngo") {
    return getRoleRegistrationRoute(user.role);
  }
  if (!isProfileComplete(user)) return getRoleRegistrationRoute(user.role);
  return getRoleDashboard(user.role);
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
    (user?.role === "provider" || user?.role === "ngo")
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

  if (
    (user.role === "user" || user.role === "volunteer") &&
    !isProfileComplete(user)
  ) {
    return pathname === "/complete-profile" ? null : "/complete-profile";
  }

  if (pathname === "/select-role" || pathname.startsWith("/select-role/")) {
    return getPostAuthRedirect(user);
  }

  if (
    (pathname === "/complete-profile" || pathname.startsWith("/complete-profile/")) &&
    (user.role === "provider" || user.role === "ngo")
  ) {
    return getPostAuthRedirect(user);
  }

  if (
    (pathname.startsWith("/provider") || pathname.startsWith("/restaurant/register")) &&
    user?.role !== "provider"
  ) {
    return getPostAuthRedirect(user);
  }

  if (pathname.startsWith("/ngo/register") && user?.role !== "ngo") {
    return getPostAuthRedirect(user);
  }

  if (
    pathname.startsWith(pendingVerificationRoute) &&
    user.role !== "provider" &&
    user.role !== "ngo"
  ) {
    return getPostAuthRedirect(user);
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
