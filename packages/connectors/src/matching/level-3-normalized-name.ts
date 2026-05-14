/**
 * Cascade level 3 — normalized-name exact match (Plan 2.2.2).
 *
 * Strategy (RESEARCH §Pattern 3, §Don't Hand-Roll):
 *   1. Postgres owns the canonical normalizer: function `public.normalize_name(text)`
 *      defined in migration 20260601000004. `master_products.nombre_normalizado`
 *      is a STORED generated column populated by that function + indexed.
 *   2. TypeScript mirrors the same transform (`normalize`) so the client can
 *      hash the inbound product name client-side and do a single SQL equality
 *      lookup against the indexed column — one round-trip.
 *
 * IMPORTANT: keep `normalize()` and `public.normalize_name()` semantically
 * aligned. The Postgres function uses `lower(unaccent(t))` + a regex strip
 * of non-alphanumeric/space + whitespace squash. The TS mirror uses
 * Unicode NFD + diacritic strip + lowercase + the same character-class
 * strip. They produce the same output for the inputs we care about
 * (Spanish accented product names).
 *
 *   "Acéíte Olíva 1L"  →  "aceite oliva 1l"   (both implementations)
 *   "  Crème  Brûlée  "  →  "creme brulee"    (both implementations)
 *
 * Returns `null` when the normalized name is empty or no master_products
 * row has the same `nombre_normalizado`.
 */

import pRetry from "p-retry";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pure normalizer mirroring `public.normalize_name(text)`.
 *   1. Unicode NFD decomposition + strip combining diacritics.
 *   2. Lowercase.
 *   3. Strip anything that isn't [a-z0-9 ] (matches the Postgres regex).
 *   4. Squash whitespace runs.
 *   5. Trim.
 */
export function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function matchByNormalizedName(
  supabase: SupabaseClient,
  normalizedName: string,
): Promise<{ master_sku: string } | null> {
  if (!normalizedName || normalizedName.trim() === "") return null;

  return pRetry(
    async () => {
      const { data, error } = await supabase
        .from("master_products")
        .select("master_sku")
        .eq("nombre_normalizado", normalizedName)
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return { master_sku: (data as { master_sku: string }).master_sku };
    },
    { retries: 2 },
  );
}
