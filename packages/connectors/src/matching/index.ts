/**
 * Matching cascade — public surface (Plan 2.2.2 partial barrel).
 *
 * Plan 2.2.5 extends this barrel with `runMatchCascade` + `persistMatch`
 * once the orchestrator + persistence layers land. For now we export:
 *
 *   - The level functions (level 1 barcode, level 2 supplier_code, level 3
 *     normalized-name) that 2.2.5's cascade.ts will call in sequence.
 *   - The threshold loader (`loadThresholds`) — SINGLE entry point for
 *     env-driven cascade tuning. Level 4/5 (plans 2.2.3 / 2.2.4) and the
 *     orchestrator (2.2.5) all read thresholds through this function.
 *   - The contract types (`MatchResult`, `SaleItemCandidate`,
 *     `CascadeContext`, `Thresholds`, `MatchMethod`) so downstream callers
 *     have one import path: `from "@faka/connectors/matching"`.
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
export { loadThresholds } from "./thresholds.js";
export type {
  MatchResult,
  SaleItemCandidate,
  CascadeContext,
  Thresholds,
  MatchMethod,
} from "./types.js";
