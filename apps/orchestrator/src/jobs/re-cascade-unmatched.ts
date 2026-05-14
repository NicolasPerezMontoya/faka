/**
 * Re-cascade-unmatched cron job (Plan 2.3.4 — every 6 hours).
 *
 * Scans `sale_items` rows that landed in the queue (`master_sku IS NULL`)
 * within the last 7 days and re-runs the matching cascade. Two reasons to
 * retry: (1) the embeddings catalog has grown since the original attempt
 * (a fresh `reembed-products` run may have introduced new vectors), and
 * (2) a human may have created new `master_products` rows that now satisfy
 * level 1-3 exact matches (RESEARCH §Pitfall 11).
 *
 * Algorithm:
 *   1. Build cascade context (thresholds + EmbeddingsClient + LLM config).
 *      A missing OPENAI key still lets levels 1-3 run; a missing LLM provider
 *      caps the cascade at level 4. Both are graceful (RESEARCH §Don't Hand-
 *      Roll).
 *   2. Pull the head of the queue: `sale_items.master_sku IS NULL AND
 *      created_at > now() - interval '7 days'`, capped at
 *      `RECASCADE_BATCH_SIZE` (default 200) to control LLM cost (RESEARCH
 *      §Pitfall 7).
 *   3. For each row: derive the `SaleItemCandidate` shape from
 *      `sale_items` (`product_name`, `external_product_id`, `external_sku`
 *      → `supplier_code`) joined with `sales` for the canal. Then
 *      `runMatchCascade` + `persistMatch`. Both are idempotent
 *      (Plan 2.2.5 contract).
 *   4. Single `recordConnectorRun({ kind: 'channel', canal: 'wordpress', ... })`
 *      at the end with rollup counts (resolved / still_queued / errors) and
 *      cumulative LLM tokens in `metadata_json.llm_tokens` so the next
 *      `TokenBudgetTracker.current()` call picks them up.
 *   5. Exit 0 even on partial errors — a single row failure must not stop
 *      the others (PATTERNS §3, F1 partial-batch resilience).
 *
 * Token budget guard (RESEARCH §Pitfall 7 mitigation 4):
 *   - Construct a `TokenBudgetTracker` keyed to `canal='wordpress'`. Before
 *     each cascade call, check `exhausted()`; once the daily cap is hit,
 *     short-circuit the remaining rows to "skipped — budget exhausted"
 *     and record the partial run. The cascade orchestrator itself enforces
 *     the same check inside level 5 — we duplicate the gate here so we
 *     also save level 4's embedding API spend (RESEARCH §Pitfall 7
 *     mitigation 4 explicitly: "the cron MUST check the budget too").
 *
 * Idempotency: `persistMatch` UPSERTs on `(canal, external_id)` and only
 * writes `sale_items.master_sku` when it is currently NULL — re-runs are
 * naturally safe. The 7-day window auto-expires items the operator never
 * validated, keeping the cron's cost bounded.
 *
 * Anti-duplication invariants:
 *   - MUST import `runMatchCascade` + `persistMatch` from
 *     `@faka/connectors/matching` — do NOT re-implement the cascade here.
 *   - MUST construct `TokenBudgetTracker` directly (not via the cascade);
 *     we need to gate the OUTER loop, not just level 5.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runMatchCascade,
  persistMatch,
  loadThresholds,
  TokenBudgetTracker,
  type CascadeContext,
  type SaleItemCandidate,
  type EmbeddingsClient,
} from "@faka/connectors/matching";
import { recordConnectorRun } from "@faka/connectors";
import { resolveLLMConfig, type ResolvedLLMConfig } from "@faka/llm";
import type { Channel } from "@faka/schema";
import { log } from "../lib/log.js";
import { getSupabase } from "../lib/supabase.js";

const DEFAULT_BATCH_SIZE = 200;
const WINDOW_DAYS = 7;
/** Cron canal — fixed because the daily WP cascade is the primary consumer. */
const CRON_CANAL: Channel = "wordpress";

interface SaleItemRow {
  id: string;
  product_name: string;
  external_product_id: string | null;
  external_sku: string | null;
  master_sku: string | null;
  created_at: string;
  sales: { canal: Channel } | { canal: Channel }[] | null;
}

export interface RecascadeRunSummary {
  status: "succeeded" | "partial" | "failed" | "skipped";
  records_processed: number;
  records_failed: number;
  resolved: number;
  still_queued: number;
  budget_exhausted_skips: number;
  llm_tokens_consumed: number;
  reason?: string;
}

/**
 * Same OpenAI bridge as `reembed-products.ts` — kept inline (not a shared
 * helper) because the two jobs may diverge on embedding model overrides in
 * F3+ (different canals → different models). The duplication is intentional
 * and explicit per RESEARCH §Pattern X — extract only after the third
 * caller.
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

export async function runRecascadeJob(deps?: {
  supabase?: SupabaseClient;
  openai?: EmbeddingsClient;
  llmConfig?: ResolvedLLMConfig | null;
  batchSize?: number;
  now?: Date;
}): Promise<RecascadeRunSummary> {
  const startedAt = deps?.now ?? new Date();
  const supabase = deps?.supabase ?? getSupabase();
  const batchSize = deps?.batchSize ?? readBatchSizeEnv();
  const thresholds = loadThresholds();

  log.info(
    { ts: startedAt.toISOString(), batchSize },
    "cron.re-cascade-unmatched.start",
  );

  const openai =
    "openai" in (deps ?? {})
      ? deps?.openai
      : await buildOpenAIEmbeddingsClient();

  // Resolve LLM provider. `provider === "none"` is fine — the cascade
  // falls through to "unresolved" at level 5 in that case (Plan 2.2.5).
  const llmConfig =
    deps?.llmConfig !== undefined ? deps.llmConfig : resolveLLMConfig({});

  // 7-day window. We do this in JS so the supabase query stays a simple
  // range filter (no `interval` arithmetic over the wire).
  const cutoffMs = startedAt.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  // Pull queue head + the canal via the sales join. `external_product_id`
  // and `product_name` are stored on `sale_items` directly.
  const { data: rows, error: queryErr } = await supabase
    .from("sale_items")
    .select(
      "id, product_name, external_product_id, external_sku, master_sku, created_at, sales!inner(canal)",
    )
    .is("master_sku", null)
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (queryErr) {
    log.error(
      { err: queryErr.message },
      "cron.re-cascade-unmatched.queue_query_failed",
    );
    await recordConnectorRun(supabase, {
      kind: "channel",
      canal: CRON_CANAL,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      status: "failed",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "queue_query_failed", message: queryErr.message },
      duration_ms: Date.now() - startedAt.getTime(),
      metadata_json: { job: "re-cascade-unmatched" },
    });
    return {
      status: "failed",
      records_processed: 0,
      records_failed: 0,
      resolved: 0,
      still_queued: 0,
      budget_exhausted_skips: 0,
      llm_tokens_consumed: 0,
      reason: queryErr.message,
    };
  }

  const items = (rows ?? []) as SaleItemRow[];
  if (items.length === 0) {
    await recordConnectorRun(supabase, {
      kind: "channel",
      canal: CRON_CANAL,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      status: "succeeded",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: null,
      duration_ms: Date.now() - startedAt.getTime(),
      metadata_json: {
        job: "re-cascade-unmatched",
        resolved: 0,
        still_queued: 0,
      },
    });
    log.info("cron.re-cascade-unmatched.empty_queue");
    return {
      status: "succeeded",
      records_processed: 0,
      records_failed: 0,
      resolved: 0,
      still_queued: 0,
      budget_exhausted_skips: 0,
      llm_tokens_consumed: 0,
    };
  }

  // Token budget gate (RESEARCH §Pitfall 7) — wrap the entire loop, not
  // just level 5. Same canal as the recordConnectorRun emits below so
  // the next run's `current()` aggregates this run's spend too.
  const tokenBudget = new TokenBudgetTracker(
    supabase,
    thresholds.llmDailyTokenCap,
    CRON_CANAL,
  );

  const ctx: CascadeContext = {
    supabase,
    thresholds,
    openai,
    llmConfig,
  };

  let resolved = 0;
  let stillQueued = 0;
  let errors = 0;
  let budgetSkips = 0;
  const errorMessages: string[] = [];

  for (const row of items) {
    // Resolve the canal — supabase typings sometimes hand back the joined
    // row as an array (when there's no FK uniqueness hint), so normalize.
    const canal = pickCanal(row.sales);
    if (!canal) {
      stillQueued += 1;
      continue;
    }

    if (!row.external_product_id || row.external_product_id.trim() === "") {
      // No external_id ⇒ cascade can't UPSERT into product_mappings (its
      // composite key needs it). Leave the row in the queue for human
      // attention.
      stillQueued += 1;
      continue;
    }

    // Budget gate — short-circuit the rest of the loop once exhausted.
    if (await tokenBudget.exhausted()) {
      budgetSkips += 1;
      continue;
    }

    const candidate: SaleItemCandidate = {
      canal,
      external_product_id: row.external_product_id,
      product_name: row.product_name,
      supplier_code: row.external_sku ?? undefined,
    };

    try {
      const result = await runMatchCascade(candidate, ctx);
      await persistMatch(supabase, candidate, result, { thresholds });
      if (result.master_sku !== null && result.method !== "unresolved") {
        resolved += 1;
      } else {
        stillQueued += 1;
      }
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (errorMessages.length < 10) errorMessages.push(message);
      log.error(
        { sale_item_id: row.id, err: message },
        "cron.re-cascade-unmatched.row_failed",
      );
    }
  }

  const tokensConsumed = tokenBudget.consumedThisRun();
  const status: RecascadeRunSummary["status"] =
    errors === 0 ? "succeeded" : resolved + stillQueued > 0 ? "partial" : "failed";

  await recordConnectorRun(supabase, {
    kind: "channel",
    canal: CRON_CANAL,
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    status,
    records_processed: items.length,
    records_failed: errors,
    retry_count: 0,
    errors_json:
      errors > 0
        ? { count: errors, messages: errorMessages }
        : null,
    duration_ms: Date.now() - startedAt.getTime(),
    metadata_json: {
      job: "re-cascade-unmatched",
      resolved,
      still_queued: stillQueued,
      budget_exhausted_skips: budgetSkips,
      llm_tokens: tokensConsumed,
      window_days: WINDOW_DAYS,
    },
  });

  log.info(
    {
      resolved,
      still_queued: stillQueued,
      errors,
      budget_skips: budgetSkips,
      llm_tokens: tokensConsumed,
    },
    "cron.re-cascade-unmatched.done",
  );

  return {
    status,
    records_processed: items.length,
    records_failed: errors,
    resolved,
    still_queued: stillQueued,
    budget_exhausted_skips: budgetSkips,
    llm_tokens_consumed: tokensConsumed,
  };
}

function pickCanal(
  sales: SaleItemRow["sales"],
): Channel | null {
  if (!sales) return null;
  if (Array.isArray(sales)) {
    return sales[0]?.canal ?? null;
  }
  return sales.canal ?? null;
}

function readBatchSizeEnv(): number {
  const raw = process.env.RECASCADE_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH_SIZE;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BATCH_SIZE;
  return Math.floor(n);
}
