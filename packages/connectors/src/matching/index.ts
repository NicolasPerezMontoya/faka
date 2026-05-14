/**
 * Matching cascade — public surface (Plan 2.2.5 — keystone barrel).
 *
 * This barrel is the single import path for the cascade:
 *
 *   import {
 *     runMatchCascade,
 *     persistMatch,
 *     findValidatedMapping,
 *     loadThresholds,
 *     type CascadeContext,
 *     type MatchResult,
 *     type SaleItemCandidate,
 *   } from "@faka/connectors/matching";
 *
 * Downstream callers (F2.1 ML's Plan 2.1.3.2, F2.3 orchestrator's
 * Plan 2.3.2 process-wp-events cron) MUST import from here — not from the
 * individual level files. The level functions are re-exported for unit
 * tests and for low-level callers (e.g., the validation queue UI's "show
 * what level 4 thinks about this row" affordance).
 *
 * Plan 2.2.5 additions over Plan 2.2.2's partial barrel:
 *   - `runMatchCascade`        — the orchestrator entry point.
 *   - `persistMatch`           — sticky UPSERT into product_mappings +
 *                                non-overwriting sale_items.master_sku update.
 *   - `findValidatedMapping`   — exposed standalone so the validation
 *                                queue UI can use the same cache lookup.
 */

export { matchByBarcode } from "./level-1-barcode.js";
export { matchBySupplierCode } from "./level-2-supplier-code.js";
export {
  matchByNormalizedName,
  normalize,
} from "./level-3-normalized-name.js";
export {
  matchByEmbedding,
  type EmbeddingsClient,
  type EmbeddingMatchResult,
} from "./level-4-embeddings.js";
export {
  arbitrateCandidate,
  ESTIMATED_TOKENS_PER_ARBITRATION,
  type MatchVerdict,
} from "./level-5-llm-arbiter.js";
export { TokenBudgetTracker, bogotaTodayUtcRange } from "./token-budget.js";
export { loadThresholds } from "./thresholds.js";
export { runMatchCascade, findValidatedMapping } from "./cascade.js";
export { persistMatch, type PersistMatchOptions } from "./persist.js";
export type {
  MatchResult,
  SaleItemCandidate,
  CascadeContext,
  Thresholds,
  MatchMethod,
} from "./types.js";
