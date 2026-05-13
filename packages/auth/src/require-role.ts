/**
 * requireRole — Server Action helper. Asserts the caller's role matches
 * one of the allowed roles. Returns the role for downstream use (e.g.
 * audit logs need role_at_time).
 *
 * Throws a ForbiddenError on mismatch. Server Actions should catch and
 * return a structured `{ ok: false, error: 'forbidden' }` to the client
 * rather than letting the error propagate to a 500.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { UserRole } from "@faka/schema";

export class ForbiddenError extends Error {
  constructor(
    public readonly requiredRoles: ReadonlyArray<UserRole>,
    public readonly actualRole: UserRole | null,
  ) {
    super(
      `forbidden: required one of [${requiredRoles.join(", ")}], got ${actualRole ?? "unauthenticated"}`,
    );
    this.name = "ForbiddenError";
  }
}

export interface RoleContext {
  user: User;
  role: UserRole;
}

/**
 * Use inside Server Actions. Passes the Supabase server client built by
 * `apps/dashboard/lib/supabase/server.ts:createClient`.
 */
export async function requireRole(
  supabase: SupabaseClient,
  allowed: ReadonlyArray<UserRole>,
): Promise<RoleContext> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new ForbiddenError(allowed, null);
  }
  const role: UserRole | null =
    (data.user.app_metadata?.role as UserRole | undefined) ?? null;
  if (!role || !allowed.includes(role)) {
    throw new ForbiddenError(allowed, role);
  }
  return { user: data.user, role };
}
