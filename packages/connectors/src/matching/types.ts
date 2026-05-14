/**
 * Matching cascade — type contracts (Plan 2.2.2).
 *
 * Single source of truth for the cascade's data shapes. Level files (level-1
 * … level-5) MUST import `MatchResult`, `SaleItemCandidate`, `CascadeContext`,
 * and `Thresholds` from here — do not redefine.
 *
 * Design references (Phase 2 RESEARCH §Pattern 3, PATTERNS §3):
 *   - No F1 analog — the cascade is F2 net-new.
 *   - The `MatchMethod` enum is published by `@faka/schema` (mirrors the
 *     Postgres enum from migration 0002). Do NOT redefine it here.
 *   - `Canal` (channel) also comes from `@faka/schema` (PATTERNS §10 boundary).
 *   - `ResolvedLLMConfig | null` is the degraded-mode signal: `null` means
 *     "no provider configured; arbiter short-circuits to reject". The plan
 *     calls this `LLMConfig`; in `@faka/llm` the exported alias is
 *     `ResolvedLLMConfig`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel, MatchMethod } from "@faka/schema";
import type { ResolvedLLMConfig } from "@faka/llm";

// Re-export so level files have a single import path for cascade types.
export type { MatchMethod };

/**
 * Outcome of running the cascade for one sale-item candidate.
 *
 *   - `method`         which level produced the result (or `"unresolved"`).
 *   - `score`          confidence in [0..1]. Levels 1-3 are exact matches
 *                      and report a fixed score (1.0 / 0.9). Level 4 reports
 *                      cosine similarity. Level 5 reports the arbiter's
 *                      reported confidence.
 *   - `master_sku`     resolved canonical product UUID, or `null` when no
 *                      level produced a match.
 *   - `source`         optional provenance flag — `"cache"` means the result
 *                      came from a pre-validated `product_mappings` row
 *                      (cache short-circuit in 2.2.5); `"live"` means the
 *                      cascade actually ran. Omitted by levels 1-5; only
 *                      `cascade.ts` sets it.
 */
export interface MatchResult {
  method: MatchMethod;
  score: number;
  master_sku: string | null;
  source?: "cache" | "live";
}

/**
 * Input the cascade needs for a single line item.
 *
 * `canal` and `external_product_id` are mandatory because the cascade keys
 * its idempotent UPSERT into `product_mappings` on `(canal, external_id)`.
 * Optional fields are the level-specific signals — absent fields skip the
 * corresponding cascade step.
 */
export interface SaleItemCandidate {
  canal: Channel;
  external_product_id: string;
  product_name: string;
  barcode?: string;
  supplier_code?: string;
}

/**
 * Tunable thresholds — loaded once at run startup via `loadThresholds(env)`.
 *
 * RESEARCH §Pattern 3: these numbers must be env-overridable so we can
 * adjust without redeploying. The level files MUST read these from the
 * `Thresholds` object passed in `CascadeContext.thresholds` — do not
 * inline literal constants.
 */
export interface Thresholds {
  /** Auto-accept threshold for level 4 (embeddings). Default 0.92. */
  embeddingsHigh: number;
  /** Send-to-arbiter threshold for level 4. Below this → unresolved. Default 0.78. */
  embeddingsMid: number;
  /** Arbiter `confidence` ≥ this → accept its match. Default 0.80. */
  arbiterAccept: number;
  /** Score < this → mark validado_humano=false so the queue picks it up. Default 0.78. */
  queueCutoff: number;
  /** Daily LLM token cap (across the canal's runs). Default 200000. */
  llmDailyTokenCap: number;
}

/**
 * Runtime context for the cascade. The orchestrator constructs this once
 * per cron tick (or per webhook batch) and passes it through.
 *
 * `openai` is the AI SDK embedding model handle; we accept `unknown` to
 * keep `types.ts` free of an AI SDK version-pin (level-4 narrows it).
 * `llmConfig: null` and absent `openai` are both valid degraded states.
 */
export interface CascadeContext {
  supabase: SupabaseClient;
  thresholds: Thresholds;
  openai?: unknown;
  llmConfig?: ResolvedLLMConfig | null;
}

// `MatchMethod` is re-exported above (single import path for level files).
