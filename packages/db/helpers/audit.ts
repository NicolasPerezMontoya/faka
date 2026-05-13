/**
 * audit_log writer — app-layer only (RESEARCH §8: do NOT trigger from DB).
 *
 * Captures `role_at_time` as a snapshot of the caller's role at write time
 * so later demotion (Super Admin → Admin → Manager) does not rewrite
 * history.
 *
 * Truncates `payload_json` if its serialized form exceeds ~64KB; appends
 * `_truncated: true` marker (RESEARCH §6 Pitfall — audit log size).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEvent } from "@faka/schema";

const PAYLOAD_BYTES_CAP = 64 * 1024;

function truncatePayload(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= PAYLOAD_BYTES_CAP) return payload;
    const truncated = serialized.slice(0, PAYLOAD_BYTES_CAP - 1024);
    const lastBrace = truncated.lastIndexOf('"');
    const safeSlice = lastBrace > 0 ? truncated.slice(0, lastBrace) : truncated;
    return {
      _truncated: true,
      _original_bytes: serialized.length,
      _preview: safeSlice,
    };
  } catch {
    return { _truncated: true, _serialization_error: true };
  }
}

export async function auditLog(
  supabase: SupabaseClient,
  event: AuditEvent,
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    user_id: event.user_id,
    role_at_time: event.role_at_time,
    action: event.action,
    target_table: event.target_table,
    target_id: event.target_id ?? null,
    payload_json: truncatePayload(event.payload_json ?? null),
    at: new Date().toISOString(),
  });
  if (error) {
    // Audit failures are unusual; log to console but do NOT throw —
    // audit failures must not break the user-facing mutation.
    console.error("audit_log_insert_failed:", error.message);
  }
}
