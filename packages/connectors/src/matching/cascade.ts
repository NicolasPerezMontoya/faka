/**
 * Cascade orchestrator (Plan 2.2.5) — the single entry point that wires
 * levels 1-5 + the validated-mapping cache short-circuit.
 *
 * Strategy (RESEARCH section Pattern 3 verbatim, with RESEARCH section
 * Pitfall 7 mitigation 1 "learn once" on top):
 *
 *   0. **Cache check first** (`findValidatedMapping`) — if a human has
 *      previously validated a mapping for `(canal, external_product_id)`,
 *      return that mapping immediately with `source: "cache"`. F1 invariant:
 *      human approval is sticky; the cascade MUST NOT re-arbitrate work the
 *      operator already signed off on.
 *   1. **Level 1 — barcode** exact match on `master_products.barcode`.
 *   2. **Level 2 — supplier_code** exact match.
 *   3. **Level 3 — normalized name** equality (PG-side normalizer +
 *      TS mirror keep this a single indexed lookup).
 *   4. **Level 4 — embeddings**. Three outcomes:
 *        - `score >= embeddingsHigh`        → return as `embeddings_high`.
 *        - `embeddingsMid <= score < High`  → forward the candidate to L5.
 *        - `score < embeddingsMid`          → unresolved (queue).
 *   5. **Level 5 — LLM arbiter** for the mid-confidence candidate. Accept
 *      threshold `arbiterAccept` -> `llm_arbiter_match`. Otherwise return
 *      `llm_arbiter_reject` with the arbiter's reported confidence so the
 *      validation queue UI can show why it landed there.
 *
 * Error envelope (PATTERNS section 3 — "audit failures must not block"
 * stance applied to the cascade): the whole body is wrapped in try/catch;
 * an uncaught exception returns `{ method: "unresolved", score: 0,
 * master_sku: null }` rather than throwing. The async event processor
 * (Plan 2.3.2) treats unresolved items as "land in queue", so a failed
 * cascade for one item never blocks the rest of the batch.
 *
 * No audit-log writes here (RESEARCH / PATTERNS section 3): the cascade is
 * a system operation, not a user mutation. F1's `auditLog` is reserved for
 * app-layer user actions (e.g., a human validating a mapping in the queue
 * UI — that DOES write an audit row, but from the dashboard route, not
 * from here).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel, MatchMethod } from "@faka/schema";
import { matchByBarcode } from "./level-1-barcode.js";
import { matchBySupplierCode } from "./level-2-supplier-code.js";
import {
  matchByNormalizedName,
  normalize,
} from "./level-3-normalized-name.js";
import {
  matchByEmbedding,
  type EmbeddingsClient,
} from "./level-4-embeddings.js";
import { arbitrateCandidate } from "./level-5-llm-arbiter.js";
import { TokenBudgetTracker } from "./token-budget.js";
import type {
  CascadeContext,
  MatchResult,
  SaleItemCandidate,
} from "./types.js";

const UNRESOLVED: MatchResult = {
  method: "unresolved",
  score: 0,
  master_sku: null,
};

/**
 * Look up an existing **validated** mapping for `(canal, external_product_id)`.
 *
 * Returns:
 *   - `null` when no mapping exists, when the row is unvalidated
 *     (`validado_humano = false`), or on query error.
 *   - The validated mapping wrapped in `MatchResult` shape with
 *     `source: "cache"` so the orchestrator can short-circuit.
 *
 * The returned `method` mirrors the `match_method` that was originally
 * stored — we don't synthesize a new "human_validated_cache" enum value
 * because (a) the Postgres `match_method` enum doesn't have one, and
 * (b) the validation queue UI's filter logic (Plan 2.4.x) already
 * understands the original method. `source: "cache"` is the disambiguator.
 *
 * The returned `score` is forced to `1.0` (not the original score) to
 * reflect human confirmation — downstream code that gates on `score >=
 * queueCutoff` MUST keep cache hits out of the queue.
 */
export async function findValidatedMapping(
  supabase: SupabaseClient,
  canal: Channel,
  externalProductId: string,
): Promise<MatchResult | null> {
  if (!externalProductId || externalProductId.trim() === "") return null;

  const { data, error } = await supabase
    .from("product_mappings")
    .select("master_sku, match_method, validado_humano")
    .eq("canal", canal)
    .eq("external_id", externalProductId)
    .eq("validado_humano", true)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    master_sku: string;
    match_method: MatchMethod;
    validado_humano: boolean;
  };

  if (!row.validado_humano) return null;

  return {
    method: row.match_method,
    score: 1.0,
    master_sku: row.master_sku,
    source: "cache",
  };
}

/**
 * Run the full match cascade for one sale-item candidate.
 *
 * Returns a `MatchResult` describing the outcome. **Never throws** — on any
 * uncaught exception inside the levels, returns an `unresolved` result so
 * the caller (`persistMatch` → async event processor) can land the item
 * in the validation queue and move on.
 */
export async function runMatchCascade(
  item: SaleItemCandidate,
  ctx: CascadeContext,
): Promise<MatchResult> {
  try {
    // ---- Step 0 — validated-mapping cache short-circuit ---------------------
    const cached = await findValidatedMapping(
      ctx.supabase,
      item.canal,
      item.external_product_id,
    );
    if (cached) return cached;

    // ---- Step 1 — barcode (exact) -------------------------------------------
    if (item.barcode && item.barcode.trim() !== "") {
      const r1 = await matchByBarcode(ctx.supabase, item.barcode);
      if (r1) {
        return {
          method: "barcode_exact",
          score: 1.0,
          master_sku: r1.master_sku,
          source: "live",
        };
      }
    }

    // ---- Step 2 — supplier_code (exact) -------------------------------------
    if (item.supplier_code && item.supplier_code.trim() !== "") {
      const r2 = await matchBySupplierCode(ctx.supabase, item.supplier_code);
      if (r2) {
        return {
          method: "supplier_code_exact",
          score: 1.0,
          master_sku: r2.master_sku,
          source: "live",
        };
      }
    }

    // ---- Step 3 — normalized name (exact on normalized string) --------------
    const norm = normalize(item.product_name ?? "");
    if (norm !== "") {
      const r3 = await matchByNormalizedName(ctx.supabase, norm);
      if (r3) {
        return {
          method: "normalized_name_exact",
          score: 0.9,
          master_sku: r3.master_sku,
          source: "live",
        };
      }
    }

    // ---- Step 4 — embeddings ------------------------------------------------
    const r4 = await matchByEmbedding(
      ctx.supabase,
      ctx.openai as EmbeddingsClient | undefined,
      item.product_name ?? "",
    );

    // 4a) High-confidence — short-circuit, no LLM needed.
    if (r4 && r4.score >= ctx.thresholds.embeddingsHigh) {
      return {
        method: "embeddings_high",
        score: r4.score,
        master_sku: r4.master_sku,
        source: "live",
      };
    }

    // 4b) Mid-confidence — forward to L5 arbiter.
    if (r4 && r4.score >= ctx.thresholds.embeddingsMid) {
      // Lazily construct a single-canal TokenBudgetTracker — `ctx` carries
      // thresholds + canal-agnostic state; the budget is canal-scoped.
      const tokenBudget = new TokenBudgetTracker(
        ctx.supabase,
        ctx.thresholds.llmDailyTokenCap,
        item.canal,
      );

      const verdict = await arbitrateCandidate(
        ctx.llmConfig ?? null,
        {
          name: item.product_name,
          barcode: item.barcode,
          supplier_code: item.supplier_code,
          channel: item.canal,
        },
        {
          master_sku: r4.candidate.master_sku,
          name: r4.candidate.nombre_canonico,
        },
        { tokenBudget },
      );

      if (verdict.isMatch && verdict.confidence >= ctx.thresholds.arbiterAccept) {
        return {
          method: "llm_arbiter_match",
          score: verdict.confidence,
          master_sku: r4.candidate.master_sku,
          source: "live",
        };
      }

      // Arbiter rejected — keep the L4 score on the row so the queue UI
      // can sort by "closest miss first" for human review.
      return {
        method: "llm_arbiter_reject",
        score: r4.score,
        master_sku: null,
        source: "live",
      };
    }

    // 4c) Below `embeddingsMid` — fall through to unresolved with whatever
    // score level 4 produced (or 0 if level 4 was degraded/returned null).
    return {
      method: "unresolved",
      score: r4?.score ?? 0,
      master_sku: null,
      source: "live",
    };
  } catch {
    // PATTERNS section 3 — "audit failures must not block". An uncaught
    // exception inside any level becomes an unresolved result; the item
    // lands in the validation queue and the next batch keeps moving.
    return { ...UNRESOLVED };
  }
}
