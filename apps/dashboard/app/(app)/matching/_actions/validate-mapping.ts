"use server";

import { revalidatePath } from "next/cache";
import { auditLog } from "@faka/db";
import { requireRole, ForbiddenError } from "@faka/auth";
import { createClient } from "@/lib/supabase/server";

export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string };

export async function validateMapping(
  mappingId: string,
): Promise<ValidateResult> {
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
    action: "mapping_validated",
    target_table: "product_mappings",
    target_id: mappingId,
    payload_json: { master_sku: data.master_sku },
  });

  revalidatePath("/matching");
  revalidatePath(`/matching/${mappingId}`);
  return { ok: true };
}
