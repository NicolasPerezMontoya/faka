/**
 * Mercado Libre variations → `product_variants` mapper (Plan 2.1.2.2 + PATTERNS §5).
 *
 * Pure-function core + one async UPSERT helper. The async helper writes the
 * three-row chain (PATTERNS §5 — lifted from F1 csv/index.ts:217-264):
 *
 *   1. `master_products` INSERT — only if no `product_mappings` row already
 *      maps `(canal='mercadolibre', external_id=item.id)` to an existing
 *      master_sku.
 *   2. `product_variants` UPSERT — keyed on the NATURAL key
 *      `(master_sku, atributos_json)`. The additive migration in this same
 *      plan adds the unique constraint that anchors the conflict target.
 *   3. `product_mappings` UPSERT — keyed on `(canal, external_id)`.
 *
 * ── Deterministic atributos_json shape (RESEARCH §Code Examples) ─────────────
 *
 * ML's `variation.attribute_combinations` is an array; the order of entries
 * is NOT stable across responses (we have observed Color/Talla on one fetch
 * and Talla/Color on the next for the same variation). To make the conflict
 * target stable, the mapper:
 *
 *   (a) lowercases attribute names so "Color" / "color" collapse,
 *   (b) sorts the resulting (name, value_name) pairs by name,
 *   (c) materializes them as a plain object with sorted keys (re-built via
 *       Object.fromEntries(sortedPairs)) so that `JSON.stringify` of two
 *       same-content but differently-ordered inputs produces the SAME bytes.
 *
 * The `variationFingerprint(attrs)` helper returns the canonical JSON string
 * — useful for tests + as a debug aid when the UPSERT misses (operator can
 * grep `product_variants.atributos_json::text` for the fingerprint to find
 * the row).
 *
 * ── Pricing trade-off (PATTERNS §5 FLAGGED) ──────────────────────────────────
 *
 * F1's `product_variants` has no `price` column. v1 stashes per-variant
 * pricing under `atributos_json.__pricing` (key prefixed with `__` so the
 * fingerprint logic SKIPS it — fingerprints are pricing-independent). F4+
 * may promote pricing to a real column; until then, the inline metadata
 * keeps the data discoverable without a schema break.
 *
 * ── Out-of-scope items (Pitfall 9 + Assumption A2) ───────────────────────────
 *
 * `item.catalog_product_id != null` items are out of v1 scope. `upsertProductWithVariants`
 * DLQ's + returns early. The api-client (`getItemDetail`) ALSO filters these
 * out — the second gate here is defense in depth (if a caller bypasses the
 * api-client we still don't poison master_products).
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 *   • W1 invariant — keep CSV's column-mapping helper out of this file.
 *   • DO NOT import from `@faka/connectors/(matching)` here — this file
 *     produces the candidates the cascade consumes; it never CALLS the
 *     cascade (PATTERNS §F2-CASCADE-REUSE).
 *   • DO NOT add a `price` column to `product_variants` in this phase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { withRetryAndDLQ } from "../retry.js";
import type { MLItem, MLVariation } from "./types.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** A single (name, value) pair from ML's `attribute_combinations` array. */
export interface AttributeCombination {
  name: string;
  value_name: string | null;
}

/**
 * The stable shape we persist under `product_variants.atributos_json`.
 *
 * - Keys are lowercase attribute names (e.g. "color", "talla").
 * - Values are the verbatim `value_name` strings ("Rojo", "M").
 * - The reserved `__pricing` key carries per-variant price metadata; it is
 *   IGNORED by the fingerprint (so price changes don't cause variant
 *   duplication on UPSERT).
 */
export type AtributosJson = Record<string, unknown>;

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

/**
 * Canonicalize attribute combinations into a stable `Record<lowercase_name, value>`.
 * Reserved `__*` keys are filtered out so accidental injection from a
 * malformed ML response doesn't pollute the fingerprint.
 */
function canonicalizeAttributes(
  attrs: AttributeCombination[],
): Record<string, string | null> {
  const pairs = attrs
    .filter((a) => typeof a.name === "string" && a.name.length > 0)
    .filter((a) => !a.name.startsWith("__"))
    .map((a) => [a.name.trim().toLowerCase(), a.value_name ?? null] as const);
  // Sort by canonical key for stable JSON output.
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return Object.fromEntries(pairs);
}

/**
 * Deterministic JSON-string fingerprint of an attribute combination set.
 * Two inputs that differ ONLY in array ordering or attribute-name casing
 * produce the same fingerprint; inputs with different (name, value) pairs
 * produce different fingerprints.
 *
 * NOT used as a stored column today (the unique constraint targets
 * `atributos_json` itself) — exposed for tests and operator debugging.
 */
export function variationFingerprint(attrs: AttributeCombination[]): string {
  return JSON.stringify(canonicalizeAttributes(attrs));
}

/**
 * Pure mapping from one ML variation → the UPSERT payload shape.
 *
 * `masterSku` is the parent master_products.master_sku UUID; the caller
 * resolves it via the `product_mappings` lookup before invoking this
 * function. We accept it as a parameter so the mapper stays sync + side-
 * effect-free.
 */
export function mapVariation(
  mlVariation: MLVariation,
  masterSku: string,
): {
  master_sku: string;
  master_variant_sku_hint: string | null;
  atributos_json: AtributosJson;
  pricing: { price: number; available_quantity: number };
} {
  const base = canonicalizeAttributes(mlVariation.attribute_combinations ?? []);
  const atributos: AtributosJson = { ...base };
  // PATTERNS §5 FLAGGED: stash per-variant pricing inline (no schema change
  // in v1). Prefix with `__` so it's filtered out of fingerprints.
  atributos.__pricing = {
    price: mlVariation.price,
    available_quantity: mlVariation.available_quantity,
    sold_quantity: mlVariation.sold_quantity ?? 0,
    ml_variation_id: mlVariation.id,
  };
  return {
    master_sku: masterSku,
    master_variant_sku_hint:
      typeof mlVariation.seller_custom_field === "string" &&
      mlVariation.seller_custom_field.trim().length > 0
        ? mlVariation.seller_custom_field.trim()
        : null,
    atributos_json: atributos,
    pricing: {
      price: mlVariation.price,
      available_quantity: mlVariation.available_quantity,
    },
  };
}

// -----------------------------------------------------------------------------
// Async UPSERT
// -----------------------------------------------------------------------------

/**
 * UPSERT a single variation into `product_variants`.
 *
 * Conflict target: `(master_sku, atributos_json)` — the unique constraint
 * lives in migration `20260615000002_product_variants_unique.sql`. If the
 * migration hasn't been applied, the UPSERT returns a structured error
 * (Postgres "no unique constraint matching the ON CONFLICT specification")
 * and the caller logs + skips the row.
 */
export async function upsertVariation(
  supabase: SupabaseClient,
  masterSku: string,
  mlVariation: MLVariation,
): Promise<{
  ok: true;
  master_variant_sku: string;
  created: boolean;
} | {
  ok: false;
  error: string;
}> {
  const mapped = mapVariation(mlVariation, masterSku);
  const { data, error } = await supabase
    .from("product_variants")
    .upsert(
      {
        master_sku: mapped.master_sku,
        atributos_json: mapped.atributos_json,
      },
      { onConflict: "master_sku,atributos_json" },
    )
    .select("master_variant_sku, created_at, updated_at")
    .single();
  if (error) {
    return { ok: false, error: error.message };
  }
  const row = data as
    | { master_variant_sku: string; created_at: string; updated_at: string }
    | null;
  if (!row) {
    return { ok: false, error: "no_row_returned" };
  }
  return {
    ok: true,
    master_variant_sku: row.master_variant_sku,
    // Best-effort "was this an insert?" signal — the row was just created if
    // created_at === updated_at within a millisecond window.
    created: row.created_at === row.updated_at,
  };
}

/**
 * Three-write UPSERT chain for an entire ML item with its variations.
 *
 *   1. Look up `product_mappings (canal='mercadolibre', external_id=item.id)`.
 *   2. If no mapping exists, INSERT a `master_products` row and capture the
 *      generated `master_sku`. Otherwise reuse it.
 *   3. For each variation, UPSERT into `product_variants` keyed on the
 *      natural `(master_sku, atributos_json)`.
 *   4. UPSERT `product_mappings` to bind `(canal, external_id) → master_sku`.
 *
 * Returns a structured envelope so callers (the products cron) can record
 * counts in `connector_runs.metadata_json`.
 */
export async function upsertProductWithVariants(
  supabase: SupabaseClient,
  item: MLItem,
): Promise<{
  ok: true;
  master_sku: string;
  variants_upserted: number;
} | {
  ok: false;
  error: string;
}> {
  // [0] Out-of-scope: catalog-products-mode items. DLQ + skip (defense in
  //     depth — api-client also filters these).
  if (item.catalog_product_id != null) {
    await supabase.from("dead_letter_queue").insert({
      canal: "mercadolibre",
      source: "items.catalog_product_not_supported",
      payload_json: { id: item.id, catalog_product_id: item.catalog_product_id },
      error: "catalog_product_id_set",
      attempts: 1,
      last_attempted_at: new Date().toISOString(),
    });
    return { ok: false, error: "catalog_product_mode_unsupported_v1" };
  }

  // [0.5] Variation-filter trap (RESEARCH §Pitfall 5): if the item declares
  //       attributes but has zero variations, ML may have server-filtered
  //       out-of-stock variations. Log + DLQ but do NOT block — a parent
  //       master_products row is still useful for name-based matching.
  if (
    (!item.variations || item.variations.length === 0) &&
    (item.attributes ?? []).length > 0
  ) {
    await supabase.from("dead_letter_queue").insert({
      canal: "mercadolibre",
      source: "items.variations_filtered",
      payload_json: { id: item.id, attribute_count: item.attributes?.length ?? 0 },
      error: "variations_array_empty_but_attributes_present",
      attempts: 1,
      last_attempted_at: new Date().toISOString(),
    });
  }

  // [1] Look up existing mapping.
  const { data: existingMapping, error: lookupErr } = await supabase
    .from("product_mappings")
    .select("master_sku")
    .eq("canal", "mercadolibre")
    .eq("external_id", item.id)
    .maybeSingle();
  if (lookupErr) {
    return { ok: false, error: `product_mappings_lookup_failed: ${lookupErr.message}` };
  }

  let masterSku: string;
  if (existingMapping && (existingMapping as { master_sku?: string }).master_sku) {
    masterSku = (existingMapping as { master_sku: string }).master_sku;
  } else {
    // [2] Create new master_products row.
    const inserted = await withRetryAndDLQ(
      async () => {
        const { data, error } = await supabase
          .from("master_products")
          .insert({
            nombre_canonico: item.title,
            brand: null,
            category: item.category_id ?? null,
            barcode: null,
            supplier_code: typeof item.seller_custom_field === "string"
              ? item.seller_custom_field
              : null,
            precio_sugerido: item.price ?? null,
            costo_promedio: null,
            imagen_principal: item.thumbnail ?? item.secure_thumbnail ?? null,
            estado: "activo",
            attributes_json: {
              ml_item_id: item.id,
              site_id: item.site_id,
              listing_type_id: item.listing_type_id ?? null,
            },
          })
          .select("master_sku")
          .single();
        if (error) {
          throw new Error(`master_products_insert_failed: ${error.message}`);
        }
        return (data as { master_sku: string }).master_sku;
      },
      {
        canal: "mercadolibre",
        source: "items.master_products_insert",
        payload: { item_id: item.id, title: item.title },
      },
      supabase,
    );
    if (!inserted) {
      return { ok: false, error: "master_products_insert_failed_after_retries" };
    }
    masterSku = inserted;
  }

  // [3] UPSERT variations (one row per variation; idempotent on retries via
  //     the (master_sku, atributos_json) natural key).
  let variantsUpserted = 0;
  for (const variation of item.variations ?? []) {
    const out = await upsertVariation(supabase, masterSku, variation);
    if (out.ok) {
      variantsUpserted += 1;
    }
    // Failed variant UPSERTs do NOT abort the whole chain — partial-batch
    // resilience invariant (PATTERNS §"Pure-function normalizer envelope").
  }

  // [4] UPSERT product_mappings — bind canal+external_id → master_sku.
  const { error: mapErr } = await supabase.from("product_mappings").upsert(
    {
      master_sku: masterSku,
      canal: "mercadolibre",
      external_id: item.id,
      external_sku: typeof item.seller_custom_field === "string"
        ? item.seller_custom_field
        : null,
      external_name: item.title,
      match_method: "normalized_name_exact",
      score: 0.9,
      validado_humano: false,
    },
    { onConflict: "canal,external_id" },
  );
  if (mapErr) {
    return { ok: false, error: `product_mappings_upsert_failed: ${mapErr.message}` };
  }

  return { ok: true, master_sku: masterSku, variants_upserted: variantsUpserted };
}
