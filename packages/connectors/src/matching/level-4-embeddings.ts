/**
 * Cascade level 4 — semantic match via pgvector embeddings (Plan 2.2.3).
 *
 * Strategy (RESEARCH §Pattern 3 + §Pitfall 7 + §Security):
 *   1. Generate a query embedding for the inbound product name. Truncate to
 *      512 chars (RESEARCH §Security — bounds prompt-injection blast radius
 *      and API cost on pathological inputs).
 *   2. RPC `find_similar_products(query_vec, k)` (Plan 2.1.1 migration) →
 *      `[ { master_sku, distance } ]`. Cosine distance ∈ [0..2].
 *   3. Convert to cosine similarity score: `1 − distance / 2` ∈ [0..1].
 *   4. Reject `distance > 1.5` (RESEARCH §Pattern 3 — low-confidence floor:
 *      cosine sim < 0.25, meaningless for product matching) → return null.
 *   5. Fetch `master_products.nombre_canonico` for the top hit so the cascade
 *      orchestrator (2.2.5) has a candidate to forward to level 5.
 *
 * Degraded mode (RESEARCH §"Don't Hand-Roll" — opt-in API):
 *   - `openai === undefined` → return null (no provider configured).
 *   - `OPENAI_API_KEY` env empty → return null (key absent).
 *   - **Never throws.** The cascade orchestrator treats null as "level 4
 *     produced no signal" and falls through to level 5 (or the queue).
 *
 * Anti-duplication invariant: this file MUST NOT import the bare `openai`
 * npm package. We accept a duck-typed `EmbeddingsClient` (the shape both
 * `@ai-sdk/openai`'s embedding-model handle and a hand-rolled wrapper can
 * satisfy) so tests can pass a plain mock. Production callers construct
 * the handle from `@ai-sdk/openai` via the `@faka/llm` package's provider
 * resolution (RESEARCH §Don't Hand-Roll).
 */

import pRetry from "p-retry";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchResult } from "./types.js";

/**
 * Duck-typed embeddings client. Matches the shape of OpenAI-style SDKs
 * (`.embeddings.create({ model, input })`) but is deliberately not bound
 * to the bare `openai` package — production code constructs this from
 * `@ai-sdk/openai` (RESEARCH §Don't Hand-Roll), tests pass a mock.
 */
export interface EmbeddingsClient {
  embeddings: {
    create(args: { model: string; input: string }): Promise<{
      data: Array<{ embedding: number[] }>;
    }>;
  };
}

const MAX_INPUT_CHARS = 512;
const LOW_CONFIDENCE_DISTANCE = 1.5;

/**
 * Level 4 return shape. The cascade orchestrator (Plan 2.2.5) wraps this
 * into a full `MatchResult` (adding `method: "embedding_similarity"`); we
 * expose `master_sku` + `score` as fields whose semantics match
 * `MatchResult`'s same-named fields (single source of truth in types.ts)
 * and add the `candidate` so level 5 has the anchor it needs.
 */
export interface EmbeddingMatchResult
  extends Pick<MatchResult, "master_sku" | "score"> {
  master_sku: string; // narrow: level 4 only returns when we have a match
  candidate: { master_sku: string; nombre_canonico: string };
}

export async function matchByEmbedding(
  supabase: SupabaseClient,
  openai: EmbeddingsClient | undefined,
  productName: string,
  candidateLimit = 5,
): Promise<EmbeddingMatchResult | null> {
  // Degraded mode — no provider configured. Cascade short-circuits past
  // level 4 to either level 5 (if a candidate landed earlier) or queue.
  if (!openai) return null;
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === "")
    return null;
  if (!productName || productName.trim() === "") return null;

  const model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  const source = productName.trim().slice(0, MAX_INPUT_CHARS);

  let queryVec: number[];
  try {
    queryVec = await pRetry(
      async () => {
        const resp = await openai.embeddings.create({ model, input: source });
        const vec = resp?.data?.[0]?.embedding;
        if (!vec || !Array.isArray(vec)) {
          throw new Error("embeddings.create returned no vector");
        }
        return vec;
      },
      { retries: 3, factor: 2 },
    );
  } catch {
    // Provider unreachable / quota exhausted / key invalid. Treat as
    // degraded — cascade falls through. We swallow rather than throw
    // because the cascade orchestrator wraps the level call in
    // try/catch already (2.2.5) but spec is "Never throws."
    return null;
  }

  // pgvector RPC — `find_similar_products(query_vec, k)` returns
  // (master_sku uuid, distance float). Supabase's RPC client accepts
  // vector params as a JS array.
  const { data: similarities, error: rpcError } = await supabase.rpc(
    "find_similar_products",
    { query_vec: queryVec, k: candidateLimit },
  );
  if (rpcError) return null;
  if (!similarities || similarities.length === 0) return null;

  const top = similarities[0] as { master_sku: string; distance: number };
  if (typeof top.distance !== "number") return null;
  if (top.distance > LOW_CONFIDENCE_DISTANCE) return null;

  // Cosine distance (0..2) → cosine similarity (0..1).
  const score = 1 - top.distance / 2;

  const { data: canon, error: canonError } = await supabase
    .from("master_products")
    .select("master_sku, nombre_canonico")
    .eq("master_sku", top.master_sku)
    .limit(1)
    .maybeSingle();

  if (canonError || !canon) return null;

  const row = canon as { master_sku: string; nombre_canonico: string };
  return {
    master_sku: row.master_sku,
    score,
    candidate: {
      master_sku: row.master_sku,
      nombre_canonico: row.nombre_canonico,
    },
  };
}
