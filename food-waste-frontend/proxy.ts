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
  "/notifications",
  "/admin",
  "/provider",
  "/ngo",
  "/volunteer",
  "/reservations",
  "/payment-success",
  "/payment-failed",
];
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
  const isAuthenticated = hasAuthCookie(req);

  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
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
    "/notifications/:path*",
    "/admin/:path*",
    "/provider/:path*",
    "/ngo/:path*",
    "/volunteer/:path*",
    "/reservations/:path*",
    "/payment-success/:path*",
    "/payment-failed/:path*",
  ],
};
