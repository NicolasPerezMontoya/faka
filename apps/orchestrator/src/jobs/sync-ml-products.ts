/**
 * Mercado Libre products sync — every 60 min (Plan 2.1.3.3).
 *
 * Pulls ML items via `search_type=scan` + `scroll_id` pagination (bypasses
 * the legacy 1000-record cap), batches `/items?ids=...` detail fetches in
 * groups of 20 with `include_attributes=all`, and persists each item via
 * `upsertProductWithVariants` (the F2.1 W2 variant-mapper). Keeps
 * `master_products` + `product_mappings` + `product_variants` current so
 * the F2 cascade (which runs on sale_items in `sync-ml-orders`) has fresh
 * candidates to match against.
 *
 * ── Cascade is NOT called here ──────────────────────────────────────────────
 *
 * Products are the CANDIDATES, not the to-be-matched. Cascade orchestration
 * runs on `sale_items` from the orders sync (Plan 2.1.3.2). The matching
 * package is intentionally NOT imported here — this file is products-only.
 * Re-embedding of the master_products catalog is the `reembed-products`
 * cron's job (F2 Wave 3) — it uses the `source_hash` short-circuit to skip
 * unchanged rows.
 *
 * ── Flow ────────────────────────────────────────────────────────────────────
 *
 *   1. `loadMercadoLibreConfig` — degraded path: succeeded no-op + exit 0.
 *   2. Resolve seller user_id from `oauth_tokens` (limit 1). No row → same
 *      succeeded no-op shape (cliente hasn't authorized yet).
 *   3. Drain `scroll_id` end-to-end: each page is up to 50 ids, then a
 *      `/items?ids=…` 20-batch fetch for detail. catalog_product_id items
 *      are DLQ'd inside the api-client (Pitfall 9) — we never see them.
 *   4. Per item: `upsertProductWithVariants(supabase, item)` from
 *      `@faka/connectors/mercadolibre/variant-mapper` — the three-write
 *      UPSERT chain (master_products INSERT-if-absent + product_variants
 *      UPSERT on (master_sku, atributos_json) + product_mappings UPSERT
 *      on (canal, external_id)).
 *   5. `recordConnectorRun({kind:'channel', canal:'mercadolibre',
 *      metadata_json:{tipo:'products', source:'rest_pull'}})`.
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 *   - W2: kind='channel' + canal='mercadolibre'. The tipo differentiator
 *     lives in metadata_json, NOT the channel enum.
 *   - F2-CASCADE-REUSE: zero cascade imports here.
 *   - Single-seller: oauth_tokens lookup uses .limit(1).
 *   - Partial-batch resilience: one item's UPSERT failure does NOT stop
 *     the rest; failures accumulate into errors_json + final status.
 *   - Safety cap: MAX_PAGES = 200 — defensive against an api-client bug
 *     producing an infinite scroll cursor (RESEARCH §Pitfall 3 cross-cite).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordConnectorRun } from "@faka/connectors";
import {
  createMLApiClient,
  loadMercadoLibreConfig,
  upsertProductWithVariants,
  type LoadedMLConfig,
  type MLItem,
} from "@faka/connectors/mercadolibre";
import { log as orchestratorLog } from "../lib/log.js";
import { getSupabase } from "../lib/supabase.js";

// Defensive cap on scroll pagination — ML does not document a hard ceiling
// but practical catalogs stay well under this; an api-client regression
// producing an infinite scroll would otherwise burn the rate-limit budget
// silently.
const MAX_SCROLL_PAGES = 200;

export interface JobLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface SyncMlProductsDeps {
  getSupabase?: () => SupabaseClient;
  loadConfig?: () => LoadedMLConfig;
  createApiClient?: typeof createMLApiClient;
  logger?: JobLogger;
  now?: () => Date;
}

export interface SyncMlProductsResult {
  status: "succeeded" | "partial" | "failed" | "not_configured";
  items_fetched: number;
  records_processed: number;
  records_failed: number;
  pages_scanned: number;
  duration_ms: number;
  connector_run_id: string | null;
}

interface PerItemError {
  external_id: string;
  message: string;
}

function defaultLogger(): JobLogger {
  return {
    debug: (obj, msg) => orchestratorLog.debug(obj, msg),
    info: (obj, msg) => orchestratorLog.info(obj, msg),
    warn: (obj, msg) => orchestratorLog.warn(obj, msg),
    error: (obj, msg) => orchestratorLog.error(obj, msg),
  };
}

async function resolveSellerUserId(
  supabase: SupabaseClient,
  log: JobLogger,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("user_id")
    .eq("canal", "mercadolibre")
    .limit(1)
    .maybeSingle();
  if (error) {
    log.warn(
      { err: error.message },
      "sync.ml.products.oauth_tokens.lookup_failed",
    );
    return null;
  }
  if (!data) return null;
  return (data as { user_id: string }).user_id;
}

export async function runSyncMlProducts(
  deps: SyncMlProductsDeps = {},
): Promise<SyncMlProductsResult> {
  const log = deps.logger ?? defaultLogger();
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const cfg = (deps.loadConfig ?? (() => loadMercadoLibreConfig()))();
  const apiClientFactory = deps.createApiClient ?? createMLApiClient;
  const supabase = (deps.getSupabase ?? getSupabase)();

  // [1] Degraded mode.
  if (!cfg.ok) {
    log.warn(
      {
        job: "sync-ml-products",
        reason: "not_configured",
        missing: cfg.missing,
      },
      "sync.ml.products.degraded",
    );
    const completed = now();
    const run = await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "mercadolibre",
      started_at: startedAt.toISOString(),
      completed_at: completed.toISOString(),
      status: "succeeded",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "not_configured", missing: cfg.missing },
      duration_ms: completed.getTime() - startedAt.getTime(),
      metadata_json: { tipo: "products", source: "rest_pull" },
    });
    return {
      status: "not_configured",
      items_fetched: 0,
      records_processed: 0,
      records_failed: 0,
      pages_scanned: 0,
      duration_ms: completed.getTime() - startedAt.getTime(),
      connector_run_id: run.id,
    };
  }

  // [2] No oauth_tokens row → degraded path (cliente has not authorized yet).
  const sellerUserId = await resolveSellerUserId(supabase, log);
  if (!sellerUserId) {
    log.warn(
      { job: "sync-ml-products", reason: "no_oauth_token_row" },
      "sync.ml.products.degraded",
    );
    const completed = now();
    const run = await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "mercadolibre",
      started_at: startedAt.toISOString(),
      completed_at: completed.toISOString(),
      status: "succeeded",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "no_oauth_token_row" },
      duration_ms: completed.getTime() - startedAt.getTime(),
      metadata_json: { tipo: "products", source: "rest_pull" },
    });
    return {
      status: "not_configured",
      items_fetched: 0,
      records_processed: 0,
      records_failed: 0,
      pages_scanned: 0,
      duration_ms: completed.getTime() - startedAt.getTime(),
      connector_run_id: run.id,
    };
  }

  log.info(
    { job: "sync-ml-products" },
    "sync.ml.products.start",
  );

  const client = apiClientFactory({
    config: cfg.cfg,
    supabase,
    userId: sellerUserId,
    logger: {
      debug: (msg: string, meta?: Record<string, unknown>) =>
        log.debug({ ...(meta ?? {}) }, msg),
      info: (msg: string, meta?: Record<string, unknown>) =>
        log.info({ ...(meta ?? {}) }, msg),
      warn: (msg: string, meta?: Record<string, unknown>) =>
        log.warn({ ...(meta ?? {}) }, msg),
      error: (msg: string, meta?: Record<string, unknown>) =>
        log.error({ ...(meta ?? {}) }, msg),
    },
  });

  const errors: PerItemError[] = [];
  let processed = 0;
  let fetched = 0;
  let pagesScanned = 0;
  let scrollId: string | undefined;

  // [3-4] Drain scroll cursor end-to-end. ML's items endpoint does not
  // expose a `since` filter — the variant-mapper's idempotent UPSERT
  // chain absorbs re-fetches, and we run hourly so the churn cost is
  // bounded.
  try {
    while (pagesScanned < MAX_SCROLL_PAGES) {
      const page = await client.getItems({
        sellerId: sellerUserId,
        scrollId,
      });
      pagesScanned += 1;
      if (page.items.length === 0) break;

      const details: MLItem[] = await client.getItemDetail(page.items);
      fetched += details.length;

      for (const item of details) {
        const externalId = String(item.id ?? "");
        const out = await upsertProductWithVariants(supabase, item);
        if (!out.ok) {
          errors.push({
            external_id: externalId,
            message: out.error ?? "upsert_failed",
          });
          continue;
        }
        processed += 1;
      }

      if (!page.scroll_id) break;
      scrollId = page.scroll_id;
    }
  } catch (err) {
    log.error(
      { job: "sync-ml-products", err: (err as Error).message },
      "sync.ml.products.fetch_failed",
    );
    const completed = now();
    const run = await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "mercadolibre",
      started_at: startedAt.toISOString(),
      completed_at: completed.toISOString(),
      status: "failed",
      records_processed: processed,
      records_failed: errors.length + 1,
      retry_count: 0,
      errors_json: {
        reason: "fetch_failed",
        message: (err as Error).message,
        errors,
      },
      duration_ms: completed.getTime() - startedAt.getTime(),
      metadata_json: {
        tipo: "products",
        source: "rest_pull",
        pages_scanned: pagesScanned,
        items_fetched: fetched,
      },
    });
    return {
      status: "failed",
      items_fetched: fetched,
      records_processed: processed,
      records_failed: errors.length + 1,
      pages_scanned: pagesScanned,
      duration_ms: completed.getTime() - startedAt.getTime(),
      connector_run_id: run.id,
    };
  }

  // [5] Single connector_runs row per tick.
  const status: "succeeded" | "partial" | "failed" =
    errors.length === 0
      ? "succeeded"
      : processed === 0
        ? "failed"
        : "partial";
  const completed = now();
  const durationMs = completed.getTime() - startedAt.getTime();
  const run = await recordConnectorRun(supabase, {
    kind: "channel",
    canal: "mercadolibre",
    started_at: startedAt.toISOString(),
    completed_at: completed.toISOString(),
    status,
    records_processed: processed,
    records_failed: errors.length,
    errors_json: errors.length > 0 ? { errors } : null,
    duration_ms: durationMs,
    metadata_json: {
      tipo: "products",
      source: "rest_pull",
      pages_scanned: pagesScanned,
      items_fetched: fetched,
    },
  });

  log.info(
    {
      job: "sync-ml-products",
      processed,
      errors: errors.length,
      pages_scanned: pagesScanned,
      items_fetched: fetched,
      duration_ms: durationMs,
    },
    "sync.ml.products.done",
  );

  return {
    status,
    items_fetched: fetched,
    records_processed: processed,
    records_failed: errors.length,
    pages_scanned: pagesScanned,
    duration_ms: durationMs,
    connector_run_id: run.id,
  };
}
