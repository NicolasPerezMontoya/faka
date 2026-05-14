/**
 * Re-embed cron job (Plan 2.3.4 — daily 04:00 UTC = 23:00 Bogota).
 *
 * Walks a bounded slice of `master_products` and ensures each row has an
 * up-to-date `product_embeddings` entry. The heavy lifting lives in
 * `generateEmbeddingsForProducts` (Plan 2.2.3 / `@faka/connectors`); this
 * file is the cron entry-point + observability wrapper.
 *
 * Algorithm:
 *   1. Pick up to `REEMBED_BATCH_SIZE` (default 500) master_sku rows ordered
 *      by `created_at asc` (oldest-first, the natural "haven't been re-checked
 *      in a while" proxy — a strict source_hash anti-staleness scan would
 *      need a per-row last_embedded_at column we don't have yet; instead we
 *      lean on `generateEmbeddingsForProducts`'s sha256 short-circuit to make
 *      identical-source rows no-op API-side).
 *   2. Call `generateEmbeddingsForProducts(supabase, openai, ids,
 *      { concurrency: 5 })`. Its source_hash short-circuit means
 *      unchanged products skip the API entirely (RESEARCH §Pitfall 5).
 *   3. `recordConnectorRun({ kind: 'channel', canal: 'wordpress', ... })`
 *      with the generated/skipped/errors breakdown stuffed in
 *      `metadata_json`. Canal=wordpress reflects the primary consumer of
 *      embeddings today (the F2 WP matching cascade); revisit when other
 *      channels start exercising level-4 in earnest (F3+).
 *   4. Exit 0 — even when partial errors landed (the cascade keeps moving
 *      next tick); status is `partial` when some rows failed, `succeeded`
 *      when all succeeded, `failed` only when the batch could not start
 *      (e.g., supabase unreachable).
 *
 * Degraded mode:
 *   - `OPENAI_API_KEY` empty/unset → exit 0 with
 *     `status='succeeded', records_processed=0,
 *      errors_json={ reason: 'no_embedding_provider' }`. This matches F1's
 *     "missing-key is graceful, not fatal" stance (PATTERNS §3) — Railway's
 *     cron container shouldn't loop on backoff just because we haven't
 *     wired the key yet.
 *
 * Idempotency: the service's `source_hash` SHA-256 short-circuit makes
 * re-runs safe and cheap. We do NOT add a top-of-loop hash check here
 * (RESEARCH §Pitfall 5 — single source of truth lives in the service).
 *
 * Anti-duplication invariants:
 *   - MUST NOT import the bare `openai` npm package — the embeddings client
 *     comes from `@ai-sdk/openai`'s `.embedding()` factory, wrapped to the
 *     duck-typed `EmbeddingsClient` shape (RESEARCH §Don't Hand-Roll).
 *   - MUST NOT inline source-text concatenation or hashing — that lives in
 *     `service.ts` and ONLY there.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateEmbeddingsForProducts,
  type EmbeddingsClient,
} from "@faka/connectors/embeddings";
import { recordConnectorRun } from "@faka/connectors";
import { log } from "../lib/log.js";
import { getSupabase } from "../lib/supabase.js";

const DEFAULT_BATCH_SIZE = 500;

export interface ReembedRunSummary {
  status: "succeeded" | "partial" | "failed" | "skipped";
  records_processed: number;
  records_failed: number;
  generated: number;
  skipped: number;
  reason?: string;
}

/**
 * Construct an `EmbeddingsClient` (the duck-typed `{ embeddings: { create } }`
 * shape that level-4 / re-embed-service consume) from the AI SDK's
 * `embed()` primitive. Returns `undefined` when the OPENAI key is absent
 * (degraded mode — callers short-circuit).
 *
 * We deliberately do NOT depend on the bare `openai` npm package per
 * RESEARCH §Don't Hand-Roll; the bridge here keeps the production wiring
 * to a single file so tests can swap a mock at the cron entry-point.
 */
async function buildOpenAIEmbeddingsClient(): Promise<
  EmbeddingsClient | undefined
> {
  if (
    !process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY.trim() === ""
  ) {
    return undefined;
  }

  const { openai } = await import("@ai-sdk/openai");
  const { embed } = await import("ai");

  return {
    embeddings: {
      create: async ({ model, input }) => {
        const result = await embed({
          model: openai.embedding(model),
          value: input,
        });
        return { data: [{ embedding: result.embedding }] };
      },
    },
  };
}

export async function runReembedJob(deps?: {
  supabase?: SupabaseClient;
  openai?: EmbeddingsClient;
  batchSize?: number;
}): Promise<ReembedRunSummary> {
  const startedAt = new Date();
  const supabase = deps?.supabase ?? getSupabase();
  const batchSize = deps?.batchSize ?? readBatchSizeEnv();

  log.info(
    { ts: startedAt.toISOString(), batchSize },
    "cron.reembed-products.start",
  );

  // Degraded — no provider; record + exit clean.
  const openai = deps?.openai ?? (await buildOpenAIEmbeddingsClient());
  if (!openai) {
    await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "wordpress",
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      status: "succeeded",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "no_embedding_provider" },
      duration_ms: Date.now() - startedAt.getTime(),
      metadata_json: { job: "reembed-products", embed_count: 0, skipped: 0 },
    });
    log.warn("cron.reembed-products.degraded:no_embedding_provider");
    return {
      status: "skipped",
      records_processed: 0,
      records_failed: 0,
      generated: 0,
      skipped: 0,
      reason: "no_embedding_provider",
    };
  }

  // Pick a batch of master_sku rows. Ordering by created_at asc gives the
  // oldest rows first; the service's source_hash short-circuit handles
  // already-up-to-date rows for ~0 API cost. RESEARCH §Pitfall 6 — keep
  // HNSW writes batched.
  const { data: ids, error: idsErr } = await supabase
    .from("master_products")
    .select("master_sku")
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (idsErr) {
    log.error(
      { err: idsErr.message },
      "cron.reembed-products.master_products_query_failed",
    );
    await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "wordpress",
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      status: "failed",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "master_products_query_failed", message: idsErr.message },
      duration_ms: Date.now() - startedAt.getTime(),
      metadata_json: { job: "reembed-products" },
    });
    return {
      status: "failed",
      records_processed: 0,
      records_failed: 0,
      generated: 0,
      skipped: 0,
      reason: idsErr.message,
    };
  }

  const productIds = ((ids ?? []) as Array<{ master_sku: string }>).map(
    (r) => r.master_sku,
  );

  const summary = await generateEmbeddingsForProducts(
    supabase,
    openai,
    productIds,
    { concurrency: 5 },
  );

  const status: ReembedRunSummary["status"] =
    summary.errors.length === 0
      ? "succeeded"
      : summary.generated + summary.skipped > 0
        ? "partial"
        : "failed";

  await recordConnectorRun(supabase, {
    kind: "channel",
    canal: "wordpress",
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    status,
    records_processed: summary.generated + summary.skipped,
    records_failed: summary.errors.length,
    retry_count: 0,
    errors_json:
      summary.errors.length > 0
        ? {
            count: summary.errors.length,
            messages: summary.errors.slice(0, 10).map((e) => e.message),
          }
        : null,
    duration_ms: Date.now() - startedAt.getTime(),
    metadata_json: {
      job: "reembed-products",
      batch_size: batchSize,
      embed_count: summary.generated,
      skipped: summary.skipped,
    },
  });

  log.info(
    {
      generated: summary.generated,
      skipped: summary.skipped,
      errors: summary.errors.length,
    },
    "cron.reembed-products.done",
  );

  return {
    status,
    records_processed: summary.generated + summary.skipped,
    records_failed: summary.errors.length,
    generated: summary.generated,
    skipped: summary.skipped,
  };
}

function readBatchSizeEnv(): number {
  const raw = process.env.REEMBED_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH_SIZE;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BATCH_SIZE;
  return Math.floor(n);
}
