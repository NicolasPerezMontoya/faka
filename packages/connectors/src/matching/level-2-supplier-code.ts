/**
 * Cascade level 2 — supplier_code exact match (Plan 2.2.2).
 *
 * Same shape as level 1: single SQL round-trip on `master_products.supplier_code`.
 * The unique index `master_products_supplier_code_uidx` (migration 0004)
 * makes this O(log n).
 *
 * Returns `null` when `supplierCode` is absent or no match. p-retry wraps
 * for transient DB blips (consistent with level 1).
 */

import pRetry from "p-retry";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function matchBySupplierCode(
  supabase: SupabaseClient,
  supplierCode: string | undefined,
): Promise<{ master_sku: string } | null> {
  if (!supplierCode || supplierCode.trim() === "") return null;

  return pRetry(
    async () => {
      const { data, error } = await supabase
        .from("master_products")
        .select("master_sku")
        .eq("supplier_code", supplierCode)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return { master_sku: (data as { master_sku: string }).master_sku };
    },
    { retries: 2 },
  );
}
