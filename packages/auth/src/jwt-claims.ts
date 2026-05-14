/**
 * JWT claims helpers. The custom_access_token Auth Hook (migration 0009)
 * writes the user_role enum into `claims.app_metadata.role` only —
 * top-level `claims.role` is reserved for the Postgres DB role
 * (authenticated/anon/service_role) that RLS keys off of.
 */

import type { UserRole } from "@faka/schema";

export interface JwtClaims {
  sub: string;
  email?: string;
  role?: UserRole;
  app_metadata?: { role?: UserRole };
  exp?: number;
  [key: string]: unknown;
}

export function extractRole(
  claims: JwtClaims | null | undefined,
): UserRole | null {
  if (!claims) return null;
  // Read ONLY from app_metadata.role. Top-level `role` is the
  // Postgres DB role (authenticated/anon/service_role) — never the
  // application user_role.
  return claims.app_metadata?.role ?? null;
}

/**
 * Decode a JWT WITHOUT verifying. Use this only after Supabase has already
 * validated the token (e.g. after `supabase.auth.getUser()` returned a
 * non-null user). Never use it to authenticate; it's a parser, not a
 * verifier.
 */
export function decodeJwtNoVerify(token: string): JwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1]!;
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf-8");
    return JSON.parse(decoded) as JwtClaims;
  } catch {
    return null;
  }
}
