import { z } from "zod";

/**
 * AuditEvent — input shape for the `audit_log` helper in
 * `@faka/db/helpers/audit`. Columns mirror ADR-002:43 exactly.
 *
 * `role_at_time` captures the caller's role AT WRITE TIME so demotion
 * later (Super Admin → Admin → Manager) doesn't rewrite history.
 *
 * `payload_json` is truncated by the helper if it exceeds ~64KB (a
 * `_truncated: true` marker is appended; see RESEARCH §6 Pitfall).
 */

export const UserRoleSchema = z.enum([
  "super_admin",
  "admin",
  "manager",
  "analista",
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const AuditEventSchema = z.object({
  user_id: z.string().uuid().nullable(),
  role_at_time: UserRoleSchema.nullable(),
  action: z.string().min(1),
  target_table: z.string().min(1),
  target_id: z.string().nullable().optional(),
  payload_json: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
