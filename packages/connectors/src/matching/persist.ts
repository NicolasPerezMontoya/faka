/**
 * Persistence for cascade results (Plan 2.2.5).
 *
 * `persistMatch` writes the outcome of one `runMatchCascade` call to the
 * database. Three side-effects, in order:
 *
 *   1. **Idempotent UPSERT into `product_mappings`** on the composite key
 *      `(canal, external_id)`. The unique constraint enforces this
 *      one-row-per-channel-product invariant (migration 0004). We reuse
 *      F1's `idempotentUpsert` helper (PATTERNS section "Shared Patterns /
 *      Idempotent UPSERT") so retries and DLQ replays don't duplicate rows.
 *
 *   2. **Sticky `sale_items.master_sku` update** when the cascade resolved
 *      the item. We only set `master_sku` on rows where it is currently
 *      `NULL` — once a human (via the validation queue) or the cascade has
 *      landed a value, we never overwrite it. This is the F1 "learn once"
 *      invariant: human approval beats machine inference, always.
 *
 *   3. **Queue routing** — for sub-cutoff scores we explicitly set
 *      `validado_humano = false` so the partial index
 *      `product_mappings_pending_validation_idx` picks the row up. The
 *      column already defaults to `false`, but writing it explicitly keeps
 *      the contract local to this function (RESEARCH section Pitfall 11 —
 *      items below threshold land in the queue, and the
 *      `re-cascade-unmatched` cron in Plan 2.3.4 retries them up to 7 days).
 *
 * Cache hits (`result.source === "cache"`) are a no-op for `product_mappings`
 * (the row already exists and is validated) but DO trigger the `sale_items`
 * sticky update so a previously-validated mapping starts attaching to new
 * orders that reference the same `(canal, external_product_id)`.
 *
 * Audit log is NOT written from here (RESEARCH section "audit failures must
 * not block"). System-driven matches are observable through `connector_runs`
 * and `product_mappings.updated_at`; human validations write audit rows from
 * the dashboard route, not from the cascade.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { idempotentUpsert } from "../idempotency.js";
import type { MatchResult, SaleItemCandidate, Thresholds } from "./types.js";

export interface PersistMatchOptions {
  /**
   * Thresholds, so we know what `queueCutoff` to use for the
   * `validado_humano = false` queue-routing nudge. Optional — when absent,
   * we skip the explicit re-write (the column default already enforces the
   * invariant for new rows).
   */
  thresholds?: Thresholds;
}

/**
 * Apply a `MatchResult` to the database for one sale-item candidate.
 *
 * Returns `void` — errors from the underlying calls are surfaced via the
 * helper's `{ error }` channel (logged by the caller); we don't throw so
 * the async event processor can keep draining the queue on partial failure.
 */
export async function persistMatch(
  supabase: SupabaseClient,
  item: SaleItemCandidate,
  result: MatchResult,
  opts: PersistMatchOptions = {},
): Promise<void> {
  // --------------------------------------------------------------------------
  // (1) UPSERT product_mappings — skipped for cache hits because the row by
  //     definition already exists and is human-validated; rewriting it would
  //     touch updated_at unnecessarily and could clobber `validated_at`.
  // --------------------------------------------------------------------------
  if (result.source !== "cache") {
    // The PG `master_sku` column is `not null`; rows without a master_sku
    // can't be expressed by the table. The validation queue is fed via
    // `sale_items.master_sku IS NULL` instead, so we only write a
    // `product_mappings` row when the cascade resolved something.
    if (result.master_sku !== null) {
      // RESEARCH section Pitfall 11 — the cascade ALWAYS writes
      // `validado_humano = false`. Only the human-validation route (Plan
      // 2.4.x) flips the flag to true. The partial index
      // `product_mappings_pending_validation_idx` (migration 0004) then
      // surfaces rows where `validado_humano = false` to the queue UI; the
      // UI filters further by `score < queueCutoff` for "needs review"
      // (anything else is a high-confidence match the system landed
      // without asking).
      await idempotentUpsert(
        supabase,
        "product_mappings",
        {
          canal: item.canal,
          external_id: item.external_product_id,
          external_name: item.product_name ?? null,
          external_sku: item.supplier_code ?? null,
          master_sku: result.master_sku,
          match_method: result.method,
          score: result.score,
          // Always false on cascade writes. Validated rows are only ever
          // flipped to true by the human-validation route (Plan 2.4.x),
          // never by us — the partial index
          // `product_mappings_pending_validation_idx` then picks the row
          // up for the queue UI when score < queueCutoff.
          validado_humano: false,
          last_arbitrated_at: new Date().toISOString(),
        },
        { onConflict: "canal,external_id" },
      );
    }
  }

  // --------------------------------------------------------------------------
  // (2) Sticky sale_items.master_sku update — only on a real match.
  //     The `WHERE master_sku IS NULL` guard is the F1 "learn once"
  //     invariant: never overwrite an existing mapping. Cache hits also
  //     trigger this path so newly-arrived sale_items get attached to
  //     previously-validated master products.
  // --------------------------------------------------------------------------
  if (result.master_sku !== null && result.method !== "unresolved") {
    await supabase
      .from("sale_items")
      .update({ master_sku: result.master_sku })
      .eq("external_product_id", item.external_product_id)
      .is("master_sku", null);
    // Note: we don't filter by canal on sale_items because sale_items
    // belongs to sales, and sales carries the canal. The external_product_id
    // uniqueness inside a canal + the IS NULL guard make the update safe;
    // a stray cross-canal collision (extremely unlikely with prefixed
    // external_ids) would at worst attach a sticky master_sku, which the
    // validation queue can correct.
  }
}
