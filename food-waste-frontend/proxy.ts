import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedRoutes = [
  "/dashboard",
  "/select-role",
  "/complete-profile",
  "/ngo/register",
  "/restaurant/register",
  "/pending-verification",
  "/profile",
];

const guestOnlyRoutes = ["/login"];

function matchesRoute(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function hasAuthCookie(req: NextRequest) {
  return Boolean(
    req.cookies.get("accessToken")?.value || req.cookies.get("refreshToken")?.value
  );
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtectedRoute = matchesRoute(pathname, protectedRoutes);
  const isGuestOnlyRoute = matchesRoute(pathname, guestOnlyRoutes);
  const isAuthenticated = hasAuthCookie(req);

  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isGuestOnlyRoute && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/select-role/:path*",
    "/complete-profile/:path*",
    "/ngo/register/:path*",
    "/restaurant/register/:path*",
    "/pending-verification/:path*",
    "/profile/:path*",
    "/login",
  ],
};
