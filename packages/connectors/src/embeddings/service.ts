/**
 * Re-embedding service (Plan 2.2.3 — RESEARCH §Pitfall 5 + §Pitfall 6).
 *
 * Generates / refreshes `product_embeddings` rows for a batch of master
 * products. Wired by the daily `reembed-products` cron (Plan 2.3.4) and
 * directly callable on demand (e.g., after a `master_products` bulk
 * import).
 *
 * Algorithm (RESEARCH §Pitfall 5 — the source_hash short-circuit):
 *   1. For each `master_sku` in the batch, read its canonical fields
 *      (`nombre_canonico`, `brand`, `category`).
 *   2. Compute `source_text = (nombre_canonico + ' ' + brand + ' ' +
 *      category).trim()` (RESEARCH Open Question §4 RESOLVED — the
 *      concatenation that produces the highest precision/recall on
 *      Spanish FMCG names).
 *   3. Truncate `source_text` to 512 chars (RESEARCH §Security).
 *   4. Hash with sha256. Compare against the existing
 *      `product_embeddings.source_hash`. If equal → **skip** (no API
 *      call). This is the ONLY thing standing between us and a full-
 *      catalog re-embed on every cron tick.
 *   5. Otherwise: call `openai.embeddings.create(...)` (retry-wrapped),
 *      UPSERT into `product_embeddings` with the new vector + hash +
 *      source_text + model + updated_at.
 *   6. Concurrency via `p-limit` (RESEARCH §Supporting libs) — default
 *      5 in-flight requests; tunable via the `concurrency` option.
 *   7. Errors per product DO NOT throw — accumulate in `errors[]` and
 *      return a partial-success summary. This matches F1's
 *      partial-batch resilience (PATTERNS §3).
 *
 * Degraded mode:
 *   - `openai === undefined` OR `OPENAI_API_KEY` empty → return
 *     `{ generated: 0, skipped: 0, errors: [<missing-key>] }`. The cron
 *     entry-point in 2.3.4 logs this and exits 0 (Railway clean exit).
 *
 * Anti-duplication: this file MUST NOT import the bare `openai` npm
 * package (RESEARCH §Don't Hand-Roll). Production callers construct the
 * embeddings client from `@ai-sdk/openai` (already a `@faka/llm` dep);
 * tests pass a duck-typed mock.
 */

import { createHash } from "node:crypto";
import pLimit from "p-limit";
import pRetry from "p-retry";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmbeddingsClient } from "../matching/level-4-embeddings.js";

const MAX_INPUT_CHARS = 512;

export interface ReembedSummary {
  generated: number;
  skipped: number;
  errors: Error[];
}

export interface ReembedOptions {
  concurrency?: number;
}

interface MasterProductRow {
  master_sku: string;
  nombre_canonico: string;
  brand: string | null;
  category: string | null;
}

interface ExistingEmbeddingRow {
  master_sku: string;
  source_hash: string;
}

function buildSourceText(row: MasterProductRow): string {
  const parts = [row.nombre_canonico, row.brand ?? "", row.category ?? ""];
  return parts.join(" ").trim().slice(0, MAX_INPUT_CHARS);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function generateEmbeddingsForProducts(
  supabase: SupabaseClient,
  openai: EmbeddingsClient | undefined,
  productIds: string[],
  options: ReembedOptions = {},
): Promise<ReembedSummary> {
  const { concurrency = 5 } = options;

  // Degraded mode — no provider. Surface a single explanatory error so
  // the cron can record it into `connector_runs.errors_json`.
  if (!openai) {
    return {
      generated: 0,
      skipped: 0,
      errors: [new Error("no_embedding_provider (openai client undefined)")],
    };
  }
  if (
    !process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY.trim() === ""
  ) {
    return {
      generated: 0,
      skipped: 0,
      errors: [new Error("no_embedding_provider (OPENAI_API_KEY empty)")],
    };
  }

  if (productIds.length === 0) {
    return { generated: 0, skipped: 0, errors: [] };
  }

  const model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

  // Fetch product fields + existing embedding hashes in two bulk reads;
  // both are bounded by `productIds.length` (RESEARCH §Pitfall 6 — keep
  // HNSW writes batched, but reads are cheap).
  const { data: products, error: prodErr } = await supabase
    .from("master_products")
    .select("master_sku, nombre_canonico, brand, category")
    .in("master_sku", productIds);
  if (prodErr) {
    return { generated: 0, skipped: 0, errors: [prodErr as unknown as Error] };
  }

  const { data: existingEmbeds, error: embErr } = await supabase
    .from("product_embeddings")
    .select("master_sku, source_hash")
    .in("master_sku", productIds);
  if (embErr) {
    return { generated: 0, skipped: 0, errors: [embErr as unknown as Error] };
  }

  const existingByMasterSku = new Map<string, string>();
  for (const row of (existingEmbeds ?? []) as ExistingEmbeddingRow[]) {
    existingByMasterSku.set(row.master_sku, row.source_hash);
  }

  const limit = pLimit(concurrency);
  let generated = 0;
  let skipped = 0;
  const errors: Error[] = [];

  await Promise.all(
    ((products ?? []) as MasterProductRow[]).map((row) =>
      limit(async () => {
        try {
          const sourceText = buildSourceText(row);
          if (sourceText.length === 0) {
            // Nothing to embed — count as skipped, not an error.
            skipped += 1;
            return;
          }

          const sourceHash = sha256(sourceText);
          const existingHash = existingByMasterSku.get(row.master_sku);
          if (existingHash && existingHash === sourceHash) {
            // RESEARCH §Pitfall 5: identical source_text → no API call.
            skipped += 1;
            return;
          }

          const resp = await pRetry(
            () => openai.embeddings.create({ model, input: sourceText }),
            { retries: 3, factor: 2 },
          );

          const vec = resp?.data?.[0]?.embedding;
          if (!vec || !Array.isArray(vec)) {
            throw new Error(
              `embeddings.create returned no vector for ${row.master_sku}`,
            );
          }

          const { error: upsertErr } = await supabase
            .from("product_embeddings")
            .upsert(
              {
                master_sku: row.master_sku,
                embedding: vec,
                source_text: sourceText,
                source_hash: sourceHash,
                model,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "master_sku" },
            );
          if (upsertErr) throw upsertErr;

          generated += 1;
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }),
    ),
  );

  return { generated, skipped, errors };
}
