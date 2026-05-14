/**
 * Hourly REST pull — WordPress products (Plan 2.3.3).
 *
 * Companion to `sync-wp-orders.ts`. Pulls `/products?modified_after=...` so
 * the cascade levels 1-2 (barcode + supplier_code) have up-to-date master
 * data + so `product_mappings` stays current with channel-side renames /
 * SKU edits (RESEARCH §Pattern 2 + §Pitfall 3).
 *
 *   1. `loadWordPressConfig` — degraded path identical to orders job
 *      (records a `connector_runs` row with `reason:'not_configured'` and
 *      returns a `not_configured` result).
 *   2. `since = max(connector_runs.completed_at WHERE tipo='products' AND
 *      status IN ('succeeded','partial'))` OR fallback to 25h ago.
 *   3. `fetchProducts(since, cfg)` — paginated, p-retry wrapped, partial-
 *      batch resilient (per-row Zod failures logged + skipped).
 *   4. For each WC product: `normalizeProduct` → INSERT a `master_products`
 *      row when no existing mapping is found, then idempotent UPSERT into
 *      `product_mappings(canal='wordpress', external_id=String(wc.id))` so
 *      cascade levels 1-2 have data to match against. Embedding regeneration
 *      is deferred to `reembed-products` (Plan 2.3.4) which relies on
 *      `source_hash` (Pitfall 5) — DO NOT inline an embeddings call here.
 *   5. `recordConnectorRun({ kind:'channel', canal:'wordpress',
 *      metadata_json:{ tipo:'products', source:'rest_pull' } })`.
 *
 * Invariant W2: kind='channel' + canal='wordpress'. Differentiator
 * (`tipo:'products'`) goes in `metadata_json`, NOT in the channel enum.
 *
 * Invariant CC-11: orchestrator-only file. No dashboard imports.
 *
 * ── Reuse target ─────────────────────────────────────────────────────────
 * Plan 2.1.3.4 (F2.1 ML products sync) is a 1:1 clone with ML-specific
 * endpoints + auth substituted. Keep this file linear.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  idempotentUpsert,
  recordConnectorRun,
} from "@faka/connectors";
import {
  loadWordPressConfig,
  fetchProducts,
  normalizeProduct,
  type LoadedWordPressConfig,
} from "@faka/connectors/wordpress";
import { log as orchestratorLog } from "../lib/log.js";
import { getSupabase } from "../lib/supabase.js";

const SINCE_FALLBACK_MS = 25 * 60 * 60 * 1000;

export interface JobLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface SyncWpProductsDeps {
  getSupabase?: () => SupabaseClient;
  loadConfig?: () => LoadedWordPressConfig;
  logger?: JobLogger;
  now?: () => Date;
}

export interface SyncWpProductsResult {
  status: "succeeded" | "partial" | "failed" | "not_configured";
  products_fetched: number;
  records_processed: number;
  records_failed: number;
  duration_ms: number;
  connector_run_id: string | null;
}

interface PerProductError {
  external_id: string;
  stage: "upsert_master" | "upsert_mapping";
  message: string;
}

export async function runSyncWpProducts(
  deps: SyncWpProductsDeps = {},
): Promise<SyncWpProductsResult> {
  const log = deps.logger ?? defaultLogger();
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const cfg = (deps.loadConfig ?? (() => loadWordPressConfig()))();
  const supabase = (deps.getSupabase ?? getSupabase)();

  if (!cfg.ok) {
    log.warn(
      { job: "sync-wp-products", reason: "not_configured" },
      "sync.wp.products.degraded",
    );
    const completed = now();
    const run = await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "wordpress",
      started_at: startedAt.toISOString(),
      completed_at: completed.toISOString(),
      status: "succeeded",
      records_processed: 0,
      records_failed: 0,
      errors_json: { reason: "not_configured" },
      duration_ms: completed.getTime() - startedAt.getTime(),
      metadata_json: { tipo: "products", source: "rest_pull" },
    });
    return {
      status: "not_configured",
      products_fetched: 0,
      records_processed: 0,
      records_failed: 0,
      duration_ms: completed.getTime() - startedAt.getTime(),
      connector_run_id: run.id,
    };
  }

  const since = await computeSinceForProducts(supabase, now);
  log.info(
    { job: "sync-wp-products", since: since.toISOString() },
    "sync.wp.products.start",
  );

  const products = await fetchProducts(since, cfg, {
    logger: {
      warn: (msg, meta) => log.warn({ ...meta }, msg),
    },
  });

  const errors: PerProductError[] = [];
  let processed = 0;

  for (const wc of products) {
    const product = normalizeProduct(wc);
    const externalId = product.external_id;

    // [4a] Look up existing mapping. If absent, create a master_products row
    // so the cascade's barcode/supplier_code levels have a target. If
    // present, leave master_products alone — the master is the source of
    // truth for canonical fields; WC edits don't reach back.
    const existingMapping = await supabase
      .from("product_mappings")
      .select("master_sku")
      .eq("canal", "wordpress")
      .eq("external_id", externalId)
      .maybeSingle();

    let masterSku: string | null =
      (existingMapping.data as { master_sku?: string } | null)?.master_sku ??
      null;

    if (!masterSku) {
      const insertMaster = await supabase
        .from("master_products")
        .insert({
          nombre_canonico: product.name,
          brand: product.brand ?? null,
          category: product.category ?? null,
          barcode: product.barcode ?? null,
          supplier_code: product.supplier_code ?? null,
          imagen_principal: product.image_url ?? null,
          precio_sugerido: product.price ?? null,
          estado: "activo",
        })
        .select("master_sku")
        .single();
      if (insertMaster.error || !insertMaster.data) {
        errors.push({
          external_id: externalId,
          stage: "upsert_master",
          message: insertMaster.error?.message ?? "master insert failed",
        });
        continue;
      }
      masterSku = (insertMaster.data as { master_sku: string }).master_sku;
    }

    // [4b] Idempotent UPSERT into product_mappings on (canal, external_id).
    // match_method='sku_exact' because we wrote a deterministic 1:1 mapping
    // from the channel's product_id to the master row. score=1.0 keeps the
    // partial-index queue from picking it up (validado_humano=false but
    // score ≥ queueCutoff).
    const mappingUpsert = await idempotentUpsert(
      supabase,
      "product_mappings",
      {
        master_sku: masterSku,
        canal: "wordpress",
        external_id: externalId,
        external_name: product.name,
        external_sku: product.sku ?? null,
        match_method: "sku_exact",
        score: 1.0,
        validado_humano: false,
        last_arbitrated_at: new Date().toISOString(),
      },
      { onConflict: "canal,external_id" },
    );
    if (mappingUpsert.error) {
      errors.push({
        external_id: externalId,
        stage: "upsert_mapping",
        message: mappingUpsert.error,
      });
      continue;
    }

    processed += 1;
  }

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
    canal: "wordpress",
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
      since: since.toISOString(),
      products_fetched: products.length,
    },
  });

  log.info(
    {
      job: "sync-wp-products",
      processed,
      errors: errors.length,
      duration_ms: durationMs,
    },
    "sync.wp.products.done",
  );

  return {
    status,
    products_fetched: products.length,
    records_processed: processed,
    records_failed: errors.length,
    duration_ms: durationMs,
    connector_run_id: run.id,
  };
}

async function computeSinceForProducts(
  supabase: SupabaseClient,
  now: () => Date,
): Promise<Date> {
  const { data, error } = await supabase
    .from("connector_runs")
    .select("completed_at, metadata_json")
    .eq("kind", "channel")
    .eq("canal", "wordpress")
    .in("status", ["succeeded", "partial"])
    .order("completed_at", { ascending: false })
    .limit(50);
  if (error || !data) {
    return new Date(now().getTime() - SINCE_FALLBACK_MS);
  }
  for (const row of data as Array<{
    completed_at: string | null;
    metadata_json: { tipo?: string } | null;
  }>) {
    if (row.metadata_json?.tipo === "products" && row.completed_at) {
      return new Date(row.completed_at);
    }
  }
  return new Date(now().getTime() - SINCE_FALLBACK_MS);
}

function defaultLogger(): JobLogger {
  return {
    debug: (obj, msg) => orchestratorLog.debug(obj, msg),
    info: (obj, msg) => orchestratorLog.info(obj, msg),
    warn: (obj, msg) => orchestratorLog.warn(obj, msg),
    error: (obj, msg) => orchestratorLog.error(obj, msg),
  };
}
