/**
 * Mercado Libre orders sync — every 15 min (Plan 2.1.3.2).
 *
 * Pulls ML orders since the last successful run, persists into `raw_orders` +
 * `sales` + `sale_items`, and runs the F2 5-level matching cascade on every
 * unmatched line item. This is the file where F2-CASCADE-REUSE goes live for
 * ML — `runMatchCascade` + `persistMatch` are imported from
 * `@faka/connectors/matching` (F2 Wave 2 output) and called per item; we do
 * NOT re-implement levels 1-5 here.
 *
 * ── Flow ────────────────────────────────────────────────────────────────────
 *
 *   1. `loadMercadoLibreConfig` — degraded path: log + write a
 *      `connector_runs` row with `status='succeeded', records_processed=0,
 *      errors_json:{reason:'not_configured'}` and return `not_configured`.
 *      Cron driver exits 0 (pre-OAuth silence per RESEARCH §Environment
 *      Availability).
 *   2. Compute `since` from the last successful run of THIS job's tipo
 *      (`metadata_json.tipo='orders'`). Default to 25h ago on cold start,
 *      apply the 5-min overlap window per RESEARCH §Pattern 3 (idempotent
 *      UPSERTs absorb the overlap).
 *   3. Resolve the single ML seller's `user_id` from `oauth_tokens` (single-
 *      account invariant — `limit(1)`).
 *   4. Build the api-client + ML connector closure; `getOrders({sellerId,
 *      dateFrom: since})` paginates `from_id`-style.
 *   5. Per order: raw_orders shadow insert with `_source:'rest_pull'`,
 *      idempotent UPSERT into `sales` on (canal,external_order_id) — the
 *      F1 LOCKED idempotency key — then look up `sale_id`, UPSERT each
 *      sale_item on (sale_id,external_product_id), and finally call
 *      `runMatchCascade(item) + persistMatch(supabase, item, result)` for
 *      every sale_item still missing `master_sku`.
 *   6. `recordConnectorRun({kind:'channel', canal:'mercadolibre',
 *      metadata_json:{tipo:'orders', source:'rest_pull'}})`.
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 *   - F2-CASCADE-REUSE: cascade orchestration imports from
 *     `@faka/connectors/matching`. NEVER call individual level functions
 *     here (`matchByBarcode`, `matchByEmbedding`, …). Grep gate enforces.
 *   - W2 kind/canal coherence: `kind:'channel', canal:'mercadolibre'`. The
 *     cron-tipo lives in `metadata_json.tipo`, NOT the channel enum.
 *   - CC-13: `raw_orders.payload_json` write is INSERT-only.
 *   - RESEARCH §Pitfall 4 — onConflict MUST be set on the `sales` UPSERT;
 *     do NOT drop it "because cron is source of truth" (the webhook is the
 *     other path and they must remain commutative).
 *   - RESEARCH §Anti-Patterns — DO NOT trust webhook body for state; this
 *     cron re-fetches fresh from `/orders/search`.
 *   - Currency guard + 401 lazy-refresh live in `api-client.ts` (Plan
 *     2.1.2.1); this cron consumes the guarded stream.
 *
 * ── Structural mirror ───────────────────────────────────────────────────────
 *
 * `sync-wp-orders.ts` is this file's direct WP twin (PATTERNS §9 + the WP
 * file's "Reuse target" comment block). Both files implement the same
 * envelope: degraded → since → fetch → for-each(persist + cascade) →
 * connector_runs. The ML-specific deltas are (i) the api-client setup
 * (oauth_tokens lookup + createMLApiClient instead of WP's REST call) and
 * (ii) the normalize layer (`normalizeOrder` from `@faka/connectors/
 * mercadolibre` instead of WP's).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  idempotentUpsert,
  recordConnectorRun,
} from "@faka/connectors";
import {
  createMLApiClient,
  loadMercadoLibreConfig,
  normalizeOrder,
  normalizeOrderItems,
  type LoadedMLConfig,
  type MLOrder,
} from "@faka/connectors/mercadolibre";
import {
  loadThresholds,
  runMatchCascade,
  persistMatch,
} from "@faka/connectors/matching";
import { resolveLLMConfig } from "@faka/llm";
import { log as orchestratorLog } from "../lib/log.js";
import { getSupabase } from "../lib/supabase.js";

// 25h fallback — slight overlap with the 15-min cadence (cron + UPSERTs make
// the overlap free).
const SINCE_FALLBACK_MS = 25 * 60 * 60 * 1000;
// 5-min overlap window per RESEARCH §Pattern 3 — ML eventual consistency
// surfaces edits 1-2 min after they happen; we widen the window so the cron
// re-fetches them on the next tick.
const SINCE_OVERLAP_MS = 5 * 60 * 1000;

export interface JobLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface SyncMlOrdersDeps {
  getSupabase?: () => SupabaseClient;
  loadConfig?: () => LoadedMLConfig;
  createApiClient?: typeof createMLApiClient;
  logger?: JobLogger;
  now?: () => Date;
}

export interface SyncMlOrdersResult {
  status: "succeeded" | "partial" | "failed" | "not_configured";
  orders_fetched: number;
  records_processed: number;
  records_failed: number;
  cascade_attempts: number;
  duration_ms: number;
  connector_run_id: string | null;
}

interface PerOrderError {
  external_order_id: string;
  stage: "upsert_sale" | "insert_items" | "cascade";
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
      "sync.ml.orders.oauth_tokens.lookup_failed",
    );
    return null;
  }
  if (!data) return null;
  return (data as { user_id: string }).user_id;
}

async function computeSinceForOrders(
  supabase: SupabaseClient,
  now: () => Date,
): Promise<Date> {
  const { data, error } = await supabase
    .from("connector_runs")
    .select("completed_at, metadata_json")
    .eq("kind", "channel")
    .eq("canal", "mercadolibre")
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
    if (row.metadata_json?.tipo === "orders" && row.completed_at) {
      // Apply the 5-min overlap window — UPSERTs make this free.
      const baseMs = new Date(row.completed_at).getTime() - SINCE_OVERLAP_MS;
      const floorMs = now().getTime() - SINCE_FALLBACK_MS;
      return new Date(Math.max(baseMs, floorMs));
    }
  }
  return new Date(now().getTime() - SINCE_FALLBACK_MS);
}

export async function runSyncMlOrders(
  deps: SyncMlOrdersDeps = {},
): Promise<SyncMlOrdersResult> {
  const log = deps.logger ?? defaultLogger();
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const cfg = (deps.loadConfig ?? (() => loadMercadoLibreConfig()))();
  const apiClientFactory = deps.createApiClient ?? createMLApiClient;
  const supabase = (deps.getSupabase ?? getSupabase)();

  // [1] Degraded mode → succeeded no-op + exit clean.
  if (!cfg.ok) {
    log.warn(
      { job: "sync-ml-orders", reason: "not_configured", missing: cfg.missing },
      "sync.ml.orders.degraded",
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
      metadata_json: { tipo: "orders", source: "rest_pull" },
    });
    return {
      status: "not_configured",
      orders_fetched: 0,
      records_processed: 0,
      records_failed: 0,
      cascade_attempts: 0,
      duration_ms: completed.getTime() - startedAt.getTime(),
      connector_run_id: run.id,
    };
  }

  // [1b] No oauth_tokens row → degraded path (cliente has not authorized yet).
  const sellerUserId = await resolveSellerUserId(supabase, log);
  if (!sellerUserId) {
    log.warn(
      { job: "sync-ml-orders", reason: "no_oauth_token_row" },
      "sync.ml.orders.degraded",
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
      metadata_json: { tipo: "orders", source: "rest_pull" },
    });
    return {
      status: "not_configured",
      orders_fetched: 0,
      records_processed: 0,
      records_failed: 0,
      cascade_attempts: 0,
      duration_ms: completed.getTime() - startedAt.getTime(),
      connector_run_id: run.id,
    };
  }

  // [2] Compute `since` from last successful tipo='orders' run + overlap.
  const since = await computeSinceForOrders(supabase, now);
  log.info(
    { job: "sync-ml-orders", since: since.toISOString() },
    "sync.ml.orders.start",
  );

  // [3-4] Build api-client + fetch.
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
  let orders: MLOrder[];
  try {
    orders = await client.getOrders({
      sellerId: sellerUserId,
      dateFrom: since.toISOString(),
    });
  } catch (err) {
    log.error(
      { job: "sync-ml-orders", err: (err as Error).message },
      "sync.ml.orders.fetch_failed",
    );
    const completed = now();
    const run = await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "mercadolibre",
      started_at: startedAt.toISOString(),
      completed_at: completed.toISOString(),
      status: "failed",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "fetch_failed", message: (err as Error).message },
      duration_ms: completed.getTime() - startedAt.getTime(),
      metadata_json: { tipo: "orders", source: "rest_pull" },
    });
    return {
      status: "failed",
      orders_fetched: 0,
      records_processed: 0,
      records_failed: 0,
      cascade_attempts: 0,
      duration_ms: completed.getTime() - startedAt.getTime(),
      connector_run_id: run.id,
    };
  }

  const thresholds = loadThresholds();
  const llmConfig = resolveLLMConfig({});
  const errors: PerOrderError[] = [];
  let processed = 0;
  let cascadeAttempts = 0;

  // [5] Per-order persist + cascade.
  for (const ml of orders) {
    const order = normalizeOrder(ml);
    const externalOrderId = order.external_order_id;

    // Shadow row in raw_orders for observability — non-fatal on failure.
    const rawInsert = await supabase.from("raw_orders").insert({
      canal: "mercadolibre",
      payload_json: {
        ...(ml as unknown as Record<string, unknown>),
        _source: "rest_pull",
      },
      processed: true,
    });
    if (rawInsert.error) {
      log.warn(
        {
          job: "sync-ml-orders",
          external_order_id: externalOrderId,
          err: rawInsert.error.message,
        },
        "sync.ml.orders.raw_orders_insert_failed",
      );
      // Non-fatal — sales remains canonical.
    }

    // Idempotent UPSERT into sales — Pitfall 4 LOCKED key.
    const saleRow = {
      canal: "mercadolibre" as const,
      external_order_id: externalOrderId,
      fecha: order.order_date,
      hora: order.order_time ?? null,
      subtotal: order.subtotal ?? 0,
      descuento: order.discount ?? 0,
      costo_envio: order.shipping_cost ?? 0,
      total: order.total,
      moneda: order.currency,
      estado: order.status ?? "pagado",
      payment_method: order.payment_method ?? null,
      customer_external_id: order.customer_external_id ?? null,
      customer_phone: order.customer_phone ?? null,
      customer_email: order.customer_email ?? null,
      customer_name: order.customer_name ?? null,
      customer_city: order.customer_city ?? null,
    };
    const upsertResult = await idempotentUpsert(supabase, "sales", saleRow, {
      onConflict: "canal,external_order_id",
    });
    if (upsertResult.error) {
      errors.push({
        external_order_id: externalOrderId,
        stage: "upsert_sale",
        message: upsertResult.error,
      });
      continue;
    }

    // Look up sale_id for sale_items + cascade reads.
    const saleLookup = await supabase
      .from("sales")
      .select("sale_id")
      .eq("canal", "mercadolibre")
      .eq("external_order_id", externalOrderId)
      .single();
    if (saleLookup.error || !saleLookup.data) {
      errors.push({
        external_order_id: externalOrderId,
        stage: "upsert_sale",
        message: saleLookup.error?.message ?? "sale_id lookup failed",
      });
      continue;
    }
    const saleId = (saleLookup.data as { sale_id: string }).sale_id;

    // Idempotent UPSERT of sale_items on (sale_id, external_product_id) —
    // matches the WP path's partial unique index from migration 0008.
    const itemRows = normalizeOrderItems(externalOrderId, ml.order_items).map(
      (it) => ({
        sale_id: saleId,
        external_sku: it.external_sku ?? null,
        external_product_id: it.external_product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        line_total: it.line_total,
      }),
    );
    if (itemRows.length > 0) {
      const itemUpsert = await idempotentUpsert(
        supabase,
        "sale_items",
        itemRows,
        { onConflict: "sale_id,external_product_id" },
      );
      if (itemUpsert.error) {
        errors.push({
          external_order_id: externalOrderId,
          stage: "insert_items",
          message: itemUpsert.error,
        });
        // continue — still attempt cascade on whatever landed.
      }
    }

    // Cascade per unmatched item — F2-CASCADE-REUSE.
    const itemsForCascade = await supabase
      .from("sale_items")
      .select("id, external_product_id, product_name")
      .eq("sale_id", saleId)
      .is("master_sku", null);
    const rows =
      (itemsForCascade.data as
        | Array<{
            id: string;
            external_product_id: string | null;
            product_name: string;
          }>
        | null) ?? [];
    for (const row of rows) {
      if (!row.external_product_id) continue;
      cascadeAttempts += 1;
      try {
        const result = await runMatchCascade(
          {
            canal: "mercadolibre",
            external_product_id: row.external_product_id,
            product_name: row.product_name,
          },
          { supabase, thresholds, llmConfig },
        );
        await persistMatch(
          supabase,
          {
            canal: "mercadolibre",
            external_product_id: row.external_product_id,
            product_name: row.product_name,
          },
          result,
          { thresholds },
        );
      } catch (err) {
        errors.push({
          external_order_id: externalOrderId,
          stage: "cascade",
          message: (err as Error).message,
        });
      }
    }

    processed += 1;
  }

  // [6] connector_runs row — single per tick (W2 invariant).
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
      tipo: "orders",
      source: "rest_pull",
      since: since.toISOString(),
      orders_fetched: orders.length,
      cascade_attempts: cascadeAttempts,
    },
  });

  log.info(
    {
      job: "sync-ml-orders",
      processed,
      errors: errors.length,
      cascade_attempts: cascadeAttempts,
      duration_ms: durationMs,
    },
    "sync.ml.orders.done",
  );

  return {
    status,
    orders_fetched: orders.length,
    records_processed: processed,
    records_failed: errors.length,
    cascade_attempts: cascadeAttempts,
    duration_ms: durationMs,
    connector_run_id: run.id,
  };
}
