/**
 * Next.js middleware — RESEARCH §4 verbatim adapted to faka's role matrix.
 *
 * 1. Refresh the Supabase session cookie if it's about to expire.
 * 2. If the user is NOT logged in and is hitting a gated route → /login.
 * 3. If the user IS logged in but their role doesn't match the route → /forbidden.
 * 4. Inject `x-user-role` header so Server Components can read role without
 *    re-querying Supabase.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { extractRole } from "./jwt-claims.js";
import { isPathAllowed, ROUTE_ROLE_REQUIREMENTS } from "./role-matrix.js";
import type { UserRole } from "@faka/schema";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/auth/callback",
  "/oauth/callback",
  "/api/health",
  "/forbidden",
]);

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith("/_next/")) return true;
  if (path.startsWith("/favicon")) return true;
  if (path.startsWith("/public/")) return true;
  return false;
}

function isGatedRoute(path: string): boolean {
  return Object.keys(ROUTE_ROLE_REQUIREMENTS).some(
    (route) => path === route || path.startsWith(route + "/"),
  );
}

export async function authMiddleware(
  request: NextRequest,
): Promise<NextResponse> {
  const response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Public paths — pass through.
  if (isPublic(path)) {
    return response;
  }

  // Unauthenticated → /login.
  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — extract role from app_metadata (set by custom_access_token Auth Hook).
  const role: UserRole | null =
    (user.app_metadata?.role as UserRole | undefined) ??
    extractRole(user as never) ??
    null;

  // Role-gate gated routes.
  if (isGatedRoute(path) && !isPathAllowed(path, role)) {
    const forbiddenUrl = request.nextUrl.clone();
    forbiddenUrl.pathname = "/forbidden";
    return NextResponse.redirect(forbiddenUrl);
  }

  // Inject role header for Server Components.
  response.headers.set("x-user-role", role ?? "analista");
  response.headers.set("x-user-id", user.id);
  if (user.email) response.headers.set("x-user-email", user.email);

  return response;
}

/** Default matcher — gates everything except static/api-health. */
export const DEFAULT_MATCHER = [
  "/((?!_next/static|_next/image|favicon.ico|public/|api/health).*)",
];
