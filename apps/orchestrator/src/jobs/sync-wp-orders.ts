/**
 * Hourly REST pull — WordPress orders (Plan 2.3.3).
 *
 * Insurance against missed webhooks (RESEARCH §Pattern 2). The receive path
 * (Plan 2.3.1 webhook) is the < 15-min latency path; this cron is the
 * eventually-consistent floor: every order WC ever produced lands here
 * within an hour, even if every webhook in between was dropped.
 *
 *   1. `loadWordPressConfig` — degraded path: log + write a `connector_runs`
 *      row with `status='succeeded', records_processed=0,
 *      errors_json:{ reason:'not_configured' }` and `process.exit(0)`.
 *   2. Compute `since = max(connector_runs.completed_at WHERE kind='channel'
 *      AND canal='wordpress' AND metadata_json->>tipo='orders' AND status IN
 *      ('succeeded','partial'))` OR fallback to 25h ago (slight overlap with
 *      the hourly cadence — cheap given the UPSERT idempotency below).
 *   3. `fetchOrders(since, cfg)` — paginated, p-retry wrapped, partial-batch
 *      resilient (per-row Zod failures logged + skipped, page transport
 *      errors propagate after retries).
 *   4. For each WC order: `normalizeOrder` → idempotent UPSERT into `sales`
 *      on `(canal, external_order_id)` AND insert into `raw_orders` with
 *      `_source:"rest_pull"` so we can tell webhook-derived rows from pull-
 *      derived rows in incident reviews. Pitfall 4 — the UPSERT-on-conflict
 *      makes this safe even if the webhook landed first (commutative).
 *   5. For each line item: idempotent INSERT into `sale_items` (linked by
 *      sale_id from the UPSERT response) + run the cascade per item (calls
 *      `runMatchCascade` + `persistMatch`). The cascade is best-effort: per-
 *      item errors are aggregated into `errors_json` but never throw.
 *   6. `recordConnectorRun({ kind:'channel', canal:'wordpress',
 *      records_processed: orders.length, ... metadata_json:{ tipo:'orders',
 *      source:'rest_pull' } })`.
 *   7. `process.exit(0)`.
 *
 * Invariant W2: kind='channel' + canal='wordpress' (real channel). The cron
 * differentiator (`tipo:'orders'`) lives in `metadata_json`, NOT in the
 * channel enum.
 *
 * Invariant CC-11: this file lives in the orchestrator; the dashboard
 * never imports it. The service-role Supabase client is loaded from
 * `./lib/supabase.js` (env-validated).
 *
 * ── Reuse target ─────────────────────────────────────────────────────────
 * Plan 2.1.3.3 (F2.1 ML orders sync) clones this skeleton verbatim with the
 * ML-specific fetch + normalize + auth-refresh wiring substituted for WC's.
 * Keep this file linear so the ML version can mirror it 1:1.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  idempotentUpsert,
  recordConnectorRun,
} from "@faka/connectors";
import {
  loadWordPressConfig,
  fetchOrders,
  normalizeOrder,
  type LoadedWordPressConfig,
} from "@faka/connectors/wordpress";
import {
  loadThresholds,
  runMatchCascade,
  persistMatch,
} from "@faka/connectors/matching";
import { resolveLLMConfig } from "@faka/llm";
import { log as orchestratorLog } from "../lib/log.js";
import { getSupabase } from "../lib/supabase.js";

// 25h fallback — slight overlap with hourly cadence; UPSERT makes overlap safe.
const SINCE_FALLBACK_MS = 25 * 60 * 60 * 1000;

export interface JobLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface SyncWpOrdersDeps {
  getSupabase?: () => SupabaseClient;
  loadConfig?: () => LoadedWordPressConfig;
  logger?: JobLogger;
  now?: () => Date;
}

export interface SyncWpOrdersResult {
  status: "succeeded" | "partial" | "failed" | "not_configured";
  orders_fetched: number;
  records_processed: number;
  records_failed: number;
  duration_ms: number;
  connector_run_id: string | null;
}

interface PerOrderError {
  external_order_id: string;
  stage: "upsert_sale" | "insert_items" | "cascade";
  message: string;
}

/**
 * Local mirror of `normalizeOrderItems` from
 * `@faka/connectors/wordpress/normalize-order` — the connectors package
 * doesn't expose that subpath in its `exports` field, and we don't widen
 * the public surface from inside an orchestrator change. Shape stays in
 * lockstep with `normalize-order.ts` (PATTERNS §1).
 */
function toItemRows(
  wcLineItems: Array<{
    sku?: string | null;
    product_id: number;
    name: string;
    quantity: number;
    subtotal: string;
    total: string;
  }>,
): Array<{
  external_sku: string | null;
  external_product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}> {
  return wcLineItems.map((it) => {
    const subtotal = Number(it.subtotal);
    const total = Number(it.total);
    const sub = Number.isFinite(subtotal) ? subtotal : 0;
    const tot = Number.isFinite(total) ? total : 0;
    const unit_price = it.quantity > 0 ? sub / it.quantity : sub;
    return {
      external_sku: it.sku && it.sku.trim() !== "" ? it.sku : null,
      external_product_id: String(it.product_id),
      product_name: it.name,
      quantity: it.quantity,
      unit_price,
      line_total: tot,
    };
  });
}

export async function runSyncWpOrders(
  deps: SyncWpOrdersDeps = {},
): Promise<SyncWpOrdersResult> {
  const log = deps.logger ?? defaultLogger();
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const cfg = (deps.loadConfig ?? (() => loadWordPressConfig()))();

  const supabase = (deps.getSupabase ?? getSupabase)();

  // [1] Degraded mode — no creds → write skipped run + clean return.
  if (!cfg.ok) {
    log.warn(
      { job: "sync-wp-orders", reason: "not_configured" },
      "sync.wp.orders.degraded",
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
      metadata_json: { tipo: "orders", source: "rest_pull" },
    });
    return {
      status: "not_configured",
      orders_fetched: 0,
      records_processed: 0,
      records_failed: 0,
      duration_ms: completed.getTime() - startedAt.getTime(),
      connector_run_id: run.id,
    };
  }

  // [2] Compute `since` from the last successful run of THIS job (orders).
  const since = await computeSinceForOrders(supabase, now);
  log.info(
    { job: "sync-wp-orders", since: since.toISOString() },
    "sync.wp.orders.start",
  );

  // [3] Pull orders.
  const orders = await fetchOrders(since, cfg, {
    logger: {
      warn: (msg, meta) => log.warn({ ...meta }, msg),
    },
  });

  const thresholds = loadThresholds();
  const llmConfig = resolveLLMConfig({});
  const errors: PerOrderError[] = [];
  let processed = 0;

  // [4-5] Persist + cascade per order.
  for (const wc of orders) {
    const order = normalizeOrder(wc);
    const externalOrderId = order.external_order_id;

    // Best-effort raw_orders shadow row (for observability — _source flags
    // which path produced the canonical row). Pitfall 4: this is additive;
    // the canonical row lives in `sales`.
    const rawInsert = await supabase.from("raw_orders").insert({
      canal: "wordpress",
      payload_json: {
        ...(wc as unknown as Record<string, unknown>),
        _source: "rest_pull",
      },
      processed: true,
    });
    if (rawInsert.error) {
      log.warn(
        {
          job: "sync-wp-orders",
          external_order_id: externalOrderId,
          err: rawInsert.error.message,
        },
        "sync.wp.orders.raw_orders_insert_failed",
      );
      // Non-fatal — `sales` is the canonical record.
    }

    // Idempotent UPSERT into `sales`. Pitfall 4 — onConflict MUST be set; do
    // NOT drop it "because cron is source of truth" (the webhook is the
    // other path and they must remain commutative).
    const saleRow = {
      canal: "wordpress" as const,
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

    // Fetch the sale_id back — UPSERT doesn't return it directly via the
    // idempotentUpsert helper. The unique key gives us a deterministic lookup.
    const saleLookup = await supabase
      .from("sales")
      .select("sale_id")
      .eq("canal", "wordpress")
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

    // Insert sale_items. We use an UPSERT-style guard via a delete-by-sale_id
    // + insert pattern is intentionally NOT used here (would be racy with the
    // webhook). Instead: only insert if no items exist yet for this sale.
    // The `sales` UPSERT updated the row; items are append-only and the
    // existence check ensures we don't double-write on cron re-runs.
    const existingItems = await supabase
      .from("sale_items")
      .select("id", { count: "exact", head: true })
      .eq("sale_id", saleId);
    const itemRows = toItemRows(wc.line_items).map((it) => ({
      sale_id: saleId,
      external_sku: it.external_sku,
      external_product_id: it.external_product_id,
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      line_total: it.line_total,
    }));
    if ((existingItems.count ?? 0) === 0 && itemRows.length > 0) {
      const itemInsert = await supabase.from("sale_items").insert(itemRows);
      if (itemInsert.error) {
        errors.push({
          external_order_id: externalOrderId,
          stage: "insert_items",
          message: itemInsert.error.message,
        });
        // continue — still attempt cascade on whatever landed.
      }
    }

    // Cascade per item: only items currently lacking a master_sku.
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
      try {
        const result = await runMatchCascade(
          {
            canal: "wordpress",
            external_product_id: row.external_product_id,
            product_name: row.product_name,
          },
          { supabase, thresholds, llmConfig },
        );
        await persistMatch(
          supabase,
          {
            canal: "wordpress",
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

  // [6] One connector_runs row per job tick.
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
      tipo: "orders",
      source: "rest_pull",
      since: since.toISOString(),
      orders_fetched: orders.length,
    },
  });

  log.info(
    {
      job: "sync-wp-orders",
      processed,
      errors: errors.length,
      duration_ms: durationMs,
    },
    "sync.wp.orders.done",
  );

  return {
    status,
    orders_fetched: orders.length,
    records_processed: processed,
    records_failed: errors.length,
    duration_ms: durationMs,
    connector_run_id: run.id,
  };
}

function defaultLogger(): JobLogger {
  return {
    debug: (obj, msg) => orchestratorLog.debug(obj, msg),
    info: (obj, msg) => orchestratorLog.info(obj, msg),
    warn: (obj, msg) => orchestratorLog.warn(obj, msg),
    error: (obj, msg) => orchestratorLog.error(obj, msg),
  };
}

async function computeSinceForOrders(
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
  // Filter client-side for `metadata_json->>tipo = 'orders'` — keeps the
  // query a simple JSONB-agnostic select that works against the stubs the
  // test suite ships with.
  for (const row of data as Array<{
    completed_at: string | null;
    metadata_json: { tipo?: string } | null;
  }>) {
    if (row.metadata_json?.tipo === "orders" && row.completed_at) {
      return new Date(row.completed_at);
    }
  }
  return new Date(now().getTime() - SINCE_FALLBACK_MS);
}

