/**
 * Sync POS sales — pulls every store in the POS_LOCATION_MAP since the last
 * successful run, persists into raw_orders + sales + sale_items, runs the
 * matching cascade on unmatched items.
 *
 * One run = one tick covers ALL configured locations. Each location lands
 * its own connector_runs row (kind=channel, canal=pos1/pos2, metadata.tipo
 * = 'orders') so the operator can see per-store health independently.
 *
 * Degraded mode: any missing env → succeeded no-op + reason=not_configured
 * (same pattern as the ML crons; pre-config silence).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordConnectorRun } from "@faka/connectors";
import {
  loadPOSConfig,
  type LoadedPOSConfig,
} from "@faka/connectors/pos/config.js";
import {
  createPOSApiClient,
  type POSApiClient,
  type POSApiClientCtx,
} from "@faka/connectors/pos/api-client.js";
import {
  normalizeOrder,
  normalizeOrderItems,
} from "@faka/connectors/pos/normalize-order.js";
import {
  loadThresholds,
  runMatchCascade,
  persistMatch,
} from "@faka/connectors/matching";
import { resolveLLMConfig } from "@faka/llm";
import { log as orchestratorLog } from "../lib/log.js";
import { getSupabase } from "../lib/supabase.js";
import type { Channel } from "@faka/schema";

// 25h fallback on cold start (mirrors WP/ML); 5-min overlap for in-flight edits.
const SINCE_FALLBACK_MS = 25 * 60 * 60 * 1000;
const SINCE_OVERLAP_MS = 5 * 60 * 1000;

export interface SyncPosOrdersDeps {
  getSupabase?: () => SupabaseClient;
  loadConfig?: () => LoadedPOSConfig;
  createApiClient?: (ctx: POSApiClientCtx) => POSApiClient;
  logger?: typeof orchestratorLog;
  now?: () => Date;
}

export interface LocationResult {
  canal: Channel;
  location_id: string;
  status: "succeeded" | "partial" | "failed" | "not_configured";
  records_processed: number;
  records_failed: number;
  errors: Array<{ external_order_id?: string; message: string }>;
}

export interface SyncPosOrdersResult {
  perLocation: LocationResult[];
  totalProcessed: number;
  totalFailed: number;
}

async function computeSinceForLocation(
  supabase: SupabaseClient,
  canal: Channel,
  now: () => Date,
): Promise<Date> {
  const { data, error } = await supabase
    .from("connector_runs")
    .select("completed_at, metadata_json")
    .eq("kind", "channel")
    .eq("canal", canal)
    .in("status", ["succeeded", "partial"])
    .order("completed_at", { ascending: false })
    .limit(20);
  if (error || !data) {
    return new Date(now().getTime() - SINCE_FALLBACK_MS);
  }
  for (const row of data as Array<{
    completed_at: string | null;
    metadata_json: { tipo?: string } | null;
  }>) {
    if (row.metadata_json?.tipo === "orders" && row.completed_at) {
      const baseMs = new Date(row.completed_at).getTime() - SINCE_OVERLAP_MS;
      const floorMs = now().getTime() - SINCE_FALLBACK_MS;
      return new Date(Math.max(baseMs, floorMs));
    }
  }
  return new Date(now().getTime() - SINCE_FALLBACK_MS);
}

export async function runSyncPosOrders(
  deps: SyncPosOrdersDeps = {},
): Promise<SyncPosOrdersResult> {
  const log = deps.logger ?? orchestratorLog;
  const now = deps.now ?? (() => new Date());
  const supabase = (deps.getSupabase ?? getSupabase)();
  const cfg = (deps.loadConfig ?? loadPOSConfig)();
  const startedAt = now();

  // ── Degraded — write one not_configured row under canal='pos' as marker.
  if (!cfg.ok) {
    const completedAt = new Date();
    await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "pos",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      status: "succeeded",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "not_configured", missing: cfg.missing },
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      metadata_json: { tipo: "orders", source: "pos-cron" },
    });
    log.warn(
      { missing: cfg.missing },
      "cron.sync-pos-orders.degraded:not_configured",
    );
    return {
      perLocation: [
        {
          canal: "pos",
          location_id: "—",
          status: "not_configured",
          records_processed: 0,
          records_failed: 0,
          errors: [],
        },
      ],
      totalProcessed: 0,
      totalFailed: 0,
    };
  }

  const client = (deps.createApiClient ?? createPOSApiClient)({
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    logger: log,
  });

  const thresholds = await loadThresholds(supabase);
  const llmConfig = resolveLLMConfig({});

  const perLocation: LocationResult[] = [];
  let totalProcessed = 0;
  let totalFailed = 0;

  for (const [locationId, canal] of cfg.locations.entries()) {
    const locStarted = new Date();
    const since = await computeSinceForLocation(supabase, canal, now);
    log.info(
      {
        job: "sync-pos-orders",
        canal,
        location_id: locationId,
        since: since.toISOString(),
      },
      "sync.pos.location.start",
    );

    let processed = 0;
    let failed = 0;
    const errors: LocationResult["errors"] = [];

    try {
      const sales = await client.searchSales({
        startDate: since.toISOString(),
        endDate: now().toISOString(),
        locationId: Number(locationId),
        verbosity: "full",
      });

      for (const sale of sales) {
        try {
          // [1] raw_orders insert (append-only audit trail).
          await supabase.from("raw_orders").insert({
            canal,
            payload_json: {
              source: "pos_pull",
              fetched_at: new Date().toISOString(),
              sale,
            },
          });

          // [2] Normalize + upsert sale.
          const norm = normalizeOrder(sale, canal as "pos1" | "pos2" | "pos");
          const fakaEstado: "pagado" | "cancelado" | "devuelto" =
            norm.status === "cancelado"
              ? "cancelado"
              : norm.status === "devuelto"
                ? "devuelto"
                : "pagado";

          const { data: upserted, error: upsertErr } = await supabase
            .from("sales")
            .upsert(
              {
                canal,
                external_order_id: norm.external_order_id,
                fecha: norm.order_date,
                hora: norm.order_time ?? null,
                total: norm.total,
                subtotal: norm.subtotal ?? 0,
                costo_envio: 0,
                moneda: norm.currency,
                estado: fakaEstado,
                punto_venta_id: norm.pos_id ?? null,
                payment_method: norm.payment_method ?? null,
                customer_external_id: norm.customer_external_id ?? null,
                customer_name: norm.customer_name ?? null,
                customer_phone: norm.customer_phone ?? null,
                customer_email: norm.customer_email ?? null,
                notes: norm.notes ?? null,
              },
              { onConflict: "canal,external_order_id" },
            )
            .select("sale_id")
            .single();
          if (upsertErr || !upserted) {
            throw new Error(
              `sale_upsert_failed: ${upsertErr?.message ?? "unknown"}`,
            );
          }
          const sale_id = (upserted as { sale_id: string }).sale_id;

          // [3] sale_items — replace pattern (delete + insert) so re-runs
          // don't accumulate ghost lines if the POS edits the cart later.
          await supabase
            .from("sale_items")
            .delete()
            .eq("sale_id", sale_id);
          const items = normalizeOrderItems(sale).map((it) => ({
            sale_id,
            external_sku: it.external_sku ?? null,
            external_product_id: it.external_product_id ?? null,
            product_name: it.product_name,
            quantity: it.quantity,
            unit_price: it.unit_price,
            line_total: it.line_total,
            line_discount: it.line_discount ?? 0,
          }));
          if (items.length > 0) {
            const { error: itemsErr } = await supabase
              .from("sale_items")
              .insert(items);
            if (itemsErr) {
              throw new Error(`insert_items: ${itemsErr.message}`);
            }
          }

          // [4] Cascade matching — same pattern as WP/ML.
          const { data: persisted } = await supabase
            .from("sale_items")
            .select("id, external_product_id, product_name")
            .eq("sale_id", sale_id)
            .is("master_sku", null);
          for (const it of persisted ?? []) {
            const itemRecord = it as {
              id: string;
              external_product_id: string | null;
              product_name: string;
            };
            if (!itemRecord.external_product_id) continue;
            const candidate = {
              canal,
              external_product_id: itemRecord.external_product_id,
              product_name: itemRecord.product_name,
            } as const;
            const result = await runMatchCascade(candidate, {
              supabase,
              thresholds,
              llmConfig,
            });
            await persistMatch(supabase, candidate, result, { thresholds });
          }

          processed++;
        } catch (err) {
          failed++;
          errors.push({
            external_order_id: String(sale.sale_id),
            message: (err as Error).message,
          });
          log.warn(
            { canal, sale_id: sale.sale_id, err: (err as Error).message },
            "sync.pos.sale.failed",
          );
        }
      }
    } catch (err) {
      failed++;
      errors.push({ message: (err as Error).message });
      log.error(
        { canal, err: (err as Error).message },
        "sync.pos.location.failed",
      );
    }

    const locCompleted = new Date();
    const locStatus: "succeeded" | "partial" | "failed" =
      failed === 0
        ? "succeeded"
        : processed === 0
          ? "failed"
          : "partial";

    await recordConnectorRun(supabase, {
      kind: "channel",
      canal,
      started_at: locStarted.toISOString(),
      completed_at: locCompleted.toISOString(),
      status: locStatus,
      records_processed: processed,
      records_failed: failed,
      retry_count: 0,
      errors_json: errors.length > 0 ? { errors } : null,
      duration_ms: locCompleted.getTime() - locStarted.getTime(),
      metadata_json: {
        tipo: "orders",
        source: "pos-cron",
        location_id: locationId,
      },
    });

    perLocation.push({
      canal,
      location_id: locationId,
      status: locStatus,
      records_processed: processed,
      records_failed: failed,
      errors,
    });
    totalProcessed += processed;
    totalFailed += failed;

    log.info(
      {
        job: "sync-pos-orders",
        canal,
        location_id: locationId,
        processed,
        failed,
        duration_ms: locCompleted.getTime() - locStarted.getTime(),
      },
      "sync.pos.location.done",
    );
  }

  return { perLocation, totalProcessed, totalFailed };
}
