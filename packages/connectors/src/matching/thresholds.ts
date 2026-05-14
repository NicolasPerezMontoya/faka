/**
 * Threshold loader (Plan 2.2.2 — RESEARCH §Pattern 3 verbatim).
 *
 * SINGLE SOURCE OF TRUTH for cascade thresholds. The env var names match
 * what's documented in Plan 2.0.2 (env layout). Level files MUST call
 * `loadThresholds(env)` once at startup and pass the result through
 * `CascadeContext.thresholds`; they MUST NOT read `process.env` directly
 * and MUST NOT inline numeric literals.
 *
 * Defaults are RESEARCH §Pattern 3 verbatim:
 *   - MATCH_EMBED_HIGH       0.92
 *   - MATCH_EMBED_MID        0.78
 *   - MATCH_ARBITER          0.80
 *   - MATCH_QUEUE_CUTOFF     0.78
 *   - LLM_DAILY_TOKEN_CAP    200000
 */

import type { Thresholds } from "./types.js";

export function loadThresholds(
  env: NodeJS.ProcessEnv = process.env,
): Thresholds {
  return {
    embeddingsHigh: Number(env.MATCH_EMBED_HIGH ?? 0.92),
    embeddingsMid: Number(env.MATCH_EMBED_MID ?? 0.78),
    arbiterAccept: Number(env.MATCH_ARBITER ?? 0.8),
    queueCutoff: Number(env.MATCH_QUEUE_CUTOFF ?? 0.78),
    llmDailyTokenCap: Number(env.LLM_DAILY_TOKEN_CAP ?? 200000),
  };
}
