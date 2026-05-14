"use server";

import { revalidatePath } from "next/cache";
import { auditLog } from "@faka/db";
import { requireRole, ForbiddenError } from "@faka/auth";
import { createClient } from "@/lib/supabase/server";

export type RejectResult =
  | { ok: true }
  | { ok: false; error: string };

// Sticky rejection: marks the mapping as human-validated so the cascade
// won't propose the same match again. `master_sku` is preserved (schema
// NOT NULL); the rejection itself is captured by the audit_log row with
// action='mapping_rejected'. The cascade orchestrator (Wave 2 / 2.2.5)
// short-circuits on `validado_humano=true` and re-reads the latest audit
// log to learn the verdict.
export async function rejectMapping(
  mappingId: string,
): Promise<RejectResult> {
  const supabase = createClient();

  let ctx;
  try {
    ctx = await requireRole(supabase, ["super_admin", "admin", "manager"]);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "forbidden" };
    return { ok: false, error: "auth_failed" };
  }

  const { data, error } = await supabase
    .from("product_mappings")
    .update({
      validado_humano: true,
      validated_by: ctx.user.id,
      validated_at: new Date().toISOString(),
    })
    .eq("id", mappingId)
    .select("id, master_sku")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "mapping_not_found" };
  }

  await auditLog(supabase, {
    user_id: ctx.user.id,
    role_at_time: ctx.role,
    action: "mapping_rejected",
    target_table: "product_mappings",
    target_id: mappingId,
    payload_json: { master_sku: data.master_sku },
  });

  revalidatePath("/matching");
  revalidatePath(`/matching/${mappingId}`);
  return { ok: true };
}
