/**
 * Cascade level 1 — barcode exact match (Plan 2.2.2).
 *
 * Single SQL round-trip. RESEARCH §Pattern 3 invariant: each level is one
 * query — no loops, no client-side filtering.
 *
 * Returns `null` when:
 *   - `barcode` is undefined/empty (no signal to match on); OR
 *   - no `master_products` row has this barcode.
 *
 * Wrapped in `p-retry` with 2 retries for transient Supabase blips (per
 * RESEARCH §Pattern 3 / §7). We do NOT use `withRetryAndDLQ` here because
 * a barcode miss is a normal outcome — only network/auth failures retry.
 */

import pRetry from "p-retry";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function matchByBarcode(
  supabase: SupabaseClient,
  barcode: string | undefined,
): Promise<{ master_sku: string } | null> {
  if (!barcode || barcode.trim() === "") return null;

  return pRetry(
    async () => {
      const { data, error } = await supabase
        .from("master_products")
        .select("master_sku")
        .eq("barcode", barcode)
        .limit(1)
        .maybeSingle();

      if (error) {
        // Surface to p-retry; transient errors will retry, terminal errors
        // bubble up after exhausting retries (callers in cascade.ts wrap
        // the whole call in try/catch and degrade to `unresolved`).
        throw error;
      }
      if (!data) return null;
      return { master_sku: (data as { master_sku: string }).master_sku };
    },
    { retries: 2 },
  );
}
