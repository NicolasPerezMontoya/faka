/**
 * ADR-002 LOCKED — TS representation of the role matrix.
 *
 * Used by UI to hide/show buttons. NOT the security boundary — the security
 * boundary is enforced server-side via:
 *   1. RLS policies on Postgres tables (migration 0010)
 *   2. SECURITY INVOKER per-role views (migration 0011) + grants (0012)
 *   3. requireRole() helper in Server Actions
 *
 * This file is the "client-side hint" layer so the dashboard renders the
 * right UI for each role without leaking forbidden actions through the
 * markup.
 */

import type { UserRole } from "@faka/schema";

export type Capability =
  | "create_users"
  | "configure_connectors"
  | "upload_csv"
  | "validate_matches"
  | "view_tx_volume"
  | "view_customers"
  | "view_money"
  | "view_insights"
  | "use_chat"
  | "view_audit_log";

export const ROLE_MATRIX: Record<Capability, ReadonlyArray<UserRole>> = {
  create_users: ["super_admin"],
  configure_connectors: ["super_admin", "admin"],
  upload_csv: ["super_admin", "admin", "manager"],
  validate_matches: ["super_admin", "admin", "manager"],
  view_tx_volume: ["super_admin", "admin", "manager", "analista"],
  view_customers: ["super_admin", "admin"],
  view_money: ["super_admin", "admin", "manager"],
  view_insights: ["super_admin", "admin", "manager", "analista"],
  use_chat: ["super_admin", "admin", "manager", "analista"],
  view_audit_log: ["super_admin", "admin"],
};

export function can(
  capability: Capability,
  role: UserRole | null | undefined,
): boolean {
  if (!role) return false;
  return ROLE_MATRIX[capability].includes(role);
}

/**
 * Route-level role requirements. The middleware in `middleware.ts` reads
 * this map to gate page access. Routes not listed here require any
 * authenticated user.
 */
export const ROUTE_ROLE_REQUIREMENTS: Record<
  string,
  ReadonlyArray<UserRole>
> = {
  "/admin": ["super_admin"],
  "/operacion": ["super_admin", "admin", "manager"],
  "/operacion/upload": ["super_admin", "admin", "manager"],
  "/operacion/historial": ["super_admin", "admin", "manager"],
  // F2.1 Plan 2.1.3.4 — ML connect bootstrap. super_admin + admin only
  // (only the owner connects a channel; manager/analista never authorize).
  "/operacion/conectar-mercadolibre": ["super_admin", "admin"],
  "/clientes": ["super_admin", "admin"], // Mini-CRM hidden from Manager/Analista (ADR-004)
  "/inteligencia": ["super_admin", "admin", "manager", "analista"],
  "/hoy": ["super_admin", "admin", "manager", "analista"],
  "/ventas": ["super_admin", "admin", "manager", "analista"],
  "/productos": ["super_admin", "admin", "manager", "analista"],
  "/canales": ["super_admin", "admin", "manager", "analista"],
  "/matching": ["super_admin", "admin", "manager"], // Analista read-only on Hoy + Productos; no validation power.
};

/**
 * Check if a path is allowed for a given role. Matches the longest prefix.
 * Returns true for unlisted routes (default-allow for authenticated users).
 */
export function isPathAllowed(
  path: string,
  role: UserRole | null | undefined,
): boolean {
  if (!role) return false;
  let bestPrefix = "";
  for (const route of Object.keys(ROUTE_ROLE_REQUIREMENTS)) {
    if (path === route || path.startsWith(route + "/")) {
      if (route.length > bestPrefix.length) bestPrefix = route;
    }
  }
  if (bestPrefix === "") return true;
  return ROUTE_ROLE_REQUIREMENTS[bestPrefix]!.includes(role);
}
