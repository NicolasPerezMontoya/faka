/**
 * Async event processor cron (Plan 2.3.2) — drains the durable queue.
 *
 * Cron entry: `node dist/cron.js process-wp-events` (railway.toml registers
 * a second cron service that invokes this path).
 *
 * Body — RESEARCH §Pattern 1 + §Architectural Map (orchestrator owns
 * idempotent UPSERTs + cascade post-ingest):
 *
 *   1. Load Supabase + WP config. Config degraded → log + clean exit (F1
 *      Pitfall 7 — Railway cron MUST `process.exit(0)` cleanly).
 *   2. Fetch up to 100 unprocessed events:
 *        `select * from raw_orders
 *           where canal='wordpress' and processed=false
 *           order by fetched_at asc
 *           limit 100`
 *      The partial index `raw_orders_unprocessed_idx` (migration 0007)
 *      keeps this O(unprocessed_tail).
 *   3. For each event:
 *        - Parse `payload_json`, extract `_topic` + `_delivery_id`.
 *        - `order.*`  → normalizeOrder(wc) → UPSERT sales on
 *                       (canal, external_order_id), UPSERT sale_items on
 *                       (sale_id, external_product_id) (migration 0008),
 *                       then run runMatchCascade + persistMatch for each
 *                       sale_item with master_sku IS NULL.
 *        - `product.*` → soft skip. master_products has no (canal, external_id)
 *                        composite key, and the cascade already creates
 *                        product_mappings rows when sale_items reference a
 *                        product. Logged + processed=true so the row drains.
 *                        (Deviation from plan spec — plan named a non-existent
 *                        `match_method='external_creation'` enum value.)
 *        - On per-row error: log, leave processed=false (next tick retries),
 *          increment records_failed.
 *        - On success: mark processed=true, processed_at=now().
 *   4. **Invariant W2** — write ONE `connector_runs` row in a `finally` so
 *      even crashes produce an audit row. `kind: "channel"`, `canal:
 *      "wordpress"`. Status:
 *        - 0 failures               → "succeeded"
 *        - mixed                    → "partial"
 *        - 0 processed + ≥1 fail    → "failed"
 *        - 0 events                 → "succeeded" with records_processed=0
 *          (a clean drain — empty-queue passes count as healthy ticks)
 *   5. `process.exit(0)` on success; `process.exit(1)` on a fatal that
 *      escaped the loop (e.g. supabase auth error before any work).
 *
 * **Idempotency** — re-running on the same `raw_orders` row is a no-op:
 *   - sales UPSERT on (canal, external_order_id) collapses retries
 *     (RESEARCH §Pitfall 4).
 *   - sale_items UPSERT on (sale_id, external_product_id) (migration 0008)
 *     collapses item re-writes.
 *   - product_mappings UPSERT on (canal, external_id) (migration 0004) is
 *     handled by the cascade's `persistMatch` (Plan 2.2.5).
 *   - The cascade itself short-circuits on validated mappings, so re-runs
 *     don't re-arbitrate human-approved matches.
 *
 * **Reuse for F2.1 ML** — this same job is generic over `canal`. The F2.1
 * ML walking-skeleton can add a sibling job (`process-ml-events`) that
 * filters `canal='mercadolibre'` and swaps `normalizeOrder` for the ML
 * normalizer; the cascade + persistMatch + connector_runs writes are
 * identical. Keep this file's shape flat so the ML clone is mechanical.
 *
 * Anti-duplication / W2: NEVER write `kind='cron-heartbeat'` here — the
 * heartbeat cron in `cron.ts` already owns that surface. This job MUST
 * write `kind='channel', canal='wordpress'`. The recordConnectorRun helper
 * throws if either invariant is violated (observability.ts:31-75).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordConnectorRun } from "@faka/connectors";
import {
  loadThresholds,
  persistMatch,
  runMatchCascade,
} from "@faka/connectors/matching";
import {
  loadWordPressConfig,
  normalizeOrder,
  WCOrderSchema,
  type LoadedWordPressConfig,
  type WCOrder,
} from "@faka/connectors/wordpress";
import { resolveLLMConfig } from "@faka/llm";
import { getSupabase } from "../lib/supabase.js";
import { log as orchestratorLog } from "../lib/log.js";

// Batch size — bounds latency per cron tick. RESEARCH §Pattern 1: drain in
// chunks rather than all-at-once so a Railway timeout truncates the tail
// cleanly. 100 is large enough that a healthy queue empties within a single
// 5-minute window, small enough that a stuck row doesn't blow the budget.
const BATCH_LIMIT = 100;

export interface JobLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface ProcessWpEventsDeps {
  /** Override the Supabase service-role client (tests inject a mock). */
  getSupabase?: () => SupabaseClient;
  /** Override the env loader (tests inject a fixed config). */
  loadConfig?: () => LoadedWordPressConfig;
  /** Override the logger (tests inject a quiet shim). */
  logger?: JobLogger;
  /** Override `Date.now()` / `new Date()` for deterministic timestamps. */
  now?: () => Date;
}

export interface ProcessWpEventsResult {
  status: "succeeded" | "partial" | "failed" | "not_configured";
  records_processed: number;
  records_failed: number;
  duration_ms: number;
  connector_run_id: string | null;
}

interface RawOrderRow {
  id: string;
  canal: string;
  payload_json: Record<string, unknown> & {
    _topic?: string | null;
    _delivery_id?: string | null;
  };
}

/**
 * Run one drain pass. Exposed as a named export so tests + the cron entry
 * share a single code path (no parallel "tested vs deployed" surface).
 */
export async function runProcessWpEvents(
  deps: ProcessWpEventsDeps = {},
): Promise<ProcessWpEventsResult> {
  const log = deps.logger ?? defaultLogger();
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const startedAtIso = startedAt.toISOString();

  // [1] Config check — degraded path is a clean exit (no work to do but the
  // cron itself must succeed; F1 Pitfall 7 — Railway treats non-zero exit
  // as a failed run + retries).
  const cfg = (deps.loadConfig ?? (() => loadWordPressConfig()))();
  if (!cfg.ok) {
    log.info(
      { job: "process-wp-events", reason: "not_configured" },
      "job.skipped",
    );
    return {
      status: "not_configured",
      records_processed: 0,
      records_failed: 0,
      duration_ms: now().getTime() - startedAt.getTime(),
      connector_run_id: null,
    };
  }

  const supabase = (deps.getSupabase ?? getSupabase)();

  // Resolve LLM config + thresholds once per tick — passed verbatim to the
  // cascade for every row.
  const thresholds = loadThresholds();
  const llmConfig = resolveLLMConfig({ env: process.env });

  let processed = 0;
  let failed = 0;
  const errors: Array<{ raw_id: string; message: string }> = [];

  try {
    // [2] Fetch the unprocessed tail. processed=false filter routes through
    //     the partial index `raw_orders_unprocessed_idx`.
    const { data: rows, error: fetchErr } = await supabase
      .from("raw_orders")
      .select("id, canal, payload_json")
      .eq("canal", "wordpress")
      .eq("processed", false)
      .order("fetched_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (fetchErr) {
      throw new Error(`raw_orders_fetch_failed: ${fetchErr.message}`);
    }

    const batch: RawOrderRow[] = (rows ?? []) as RawOrderRow[];
    log.info(
      { job: "process-wp-events", batch_size: batch.length },
      "job.batch.start",
    );

    // [3] Per-row processing. Each iteration is wrapped so one bad row
    //     doesn't kill the whole batch — failed rows stay processed=false
    //     and retry next tick (durable-queue invariant).
    for (const row of batch) {
      try {
        const topic = row.payload_json._topic ?? null;
        const deliveryId = row.payload_json._delivery_id ?? null;

        if (typeof topic === "string" && topic.startsWith("order.")) {
          await processOrderEvent(supabase, row, log);
        } else if (typeof topic === "string" && topic.startsWith("product.")) {
          // Product enrichment is deferred — the cascade creates
          // product_mappings rows when sale_items reference a product, and
          // master_products has no (canal, external_id) composite key for
          // a direct UPSERT. Mark the row processed so it drains cleanly.
          log.info(
            {
              job: "process-wp-events",
              raw_id: row.id,
              topic,
              delivery_id: deliveryId,
            },
            "job.product_event.deferred",
          );
        } else {
          // Unknown topic shouldn't have landed in raw_orders (the webhook
          // drops unsupported topics before INSERT), but defend in depth.
          log.warn(
            {
              job: "process-wp-events",
              raw_id: row.id,
              topic,
            },
            "job.unknown_topic",
          );
        }

        // Mark processed=true on success. We use update-by-id rather than
        // UPSERT here because raw_orders rows are immutable except for
        // (processed, processed_at).
        const { error: markErr } = await supabase
          .from("raw_orders")
          .update({
            processed: true,
            processed_at: now().toISOString(),
          })
          .eq("id", row.id);

        if (markErr) {
          throw new Error(
            `raw_orders_mark_processed_failed: ${markErr.message}`,
          );
        }

        processed += 1;
      } catch (err) {
        failed += 1;
        const message = (err as Error).message;
        errors.push({ raw_id: row.id, message });
        log.error(
          {
            job: "process-wp-events",
            raw_id: row.id,
            err: message,
          },
          "job.row_failed",
        );
        // Intentionally do NOT mark processed=true — the next cron tick
        // retries. RESEARCH §Pattern 1: the durable queue absorbs transient
        // failures without operator intervention.
      }
    }
  } finally {
    // [4] Write the audit row ONCE, ALWAYS — `finally` so even a crash mid-
    //     loop produces a connector_runs entry. W2: kind='channel',
    //     canal='wordpress'. recordConnectorRun throws if either invariant
    //     is violated.
    const completedAt = now();
    const status: "succeeded" | "partial" | "failed" =
      failed === 0
        ? "succeeded"
        : processed === 0
          ? "failed"
          : "partial";

    try {
      const { id } = await recordConnectorRun(supabase, {
        kind: "channel",
        canal: "wordpress",
        started_at: startedAtIso,
        completed_at: completedAt.toISOString(),
        status,
        records_processed: processed,
        records_failed: failed,
        retry_count: 0,
        errors_json: errors.length > 0 ? { errors } : null,
        duration_ms: completedAt.getTime() - startedAt.getTime(),
        metadata_json: {
          source: "process-wp-events",
          batch_limit: BATCH_LIMIT,
          llm_provider: llmConfig.provider,
        },
      });
      log.info(
        {
          job: "process-wp-events",
          connector_run_id: id,
          status,
          records_processed: processed,
          records_failed: failed,
        },
        "job.done",
      );
      return {
        status,
        records_processed: processed,
        records_failed: failed,
        duration_ms: completedAt.getTime() - startedAt.getTime(),
        connector_run_id: id,
      };
    } catch (auditErr) {
      // If we can't even write the audit row, log loudly but don't throw
      // out of `finally` — that would mask the original error.
      log.error(
        {
          job: "process-wp-events",
          err: (auditErr as Error).message,
        },
        "job.connector_runs_write_failed",
      );
      return {
        status,
        records_processed: processed,
        records_failed: failed,
        duration_ms: completedAt.getTime() - startedAt.getTime(),
        connector_run_id: null,
      };
    }
  }

  // Inner helpers ----------------------------------------------------------

  /**
   * Process one `order.*` raw_orders row:
   *   1. Validate the WC payload shape via Zod (rejects malformed rows
   *      early — failed Zod parse becomes a failed row, retried next tick).
   *   2. normalize → UPSERT sales (returns sale_id).
   *   3. normalize line items → UPSERT sale_items.
   *   4. For each sale_item with master_sku IS NULL: run cascade + persist.
   */
  async function processOrderEvent(
    sb: SupabaseClient,
    row: RawOrderRow,
    rowLog: JobLogger,
  ): Promise<void> {
    // Strip the webhook envelope keys before validating — they're injected
    // by the webhook route, not part of the WC schema.
    const { _topic, _delivery_id, ...wcPayload } = row.payload_json;
    void _topic;
    void _delivery_id;

    const parsed = WCOrderSchema.safeParse(wcPayload);
    if (!parsed.success) {
      throw new Error(
        `wc_order_validation_failed: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    const wcOrder: WCOrder = parsed.data;

    const normalized = normalizeOrder(wcOrder);

    // -- sales UPSERT — (canal, external_order_id) is the idempotency key
    //                   (FND-08 / PATTERNS §5.9; migration 0005:43).
    const salesRow = {
      canal: "wordpress",
      external_order_id: normalized.external_order_id,
      fecha: normalized.order_date,
      hora: normalized.order_time ?? null,
      subtotal: normalized.subtotal ?? 0,
      descuento: normalized.discount ?? 0,
      total: normalized.total,
      costo_envio: normalized.shipping_cost ?? 0,
      moneda: normalized.currency,
      estado: normalized.status ?? "pendiente",
      payment_method: normalized.payment_method ?? null,
      customer_external_id: normalized.customer_external_id ?? null,
      customer_phone: normalized.customer_phone ?? null,
      customer_email: normalized.customer_email ?? null,
      customer_name: normalized.customer_name ?? null,
      customer_city: normalized.customer_city ?? null,
      raw_payload_ref: { raw_order_id: row.id },
    };

    const { data: upsertedSale, error: salesErr } = await sb
      .from("sales")
      .upsert(salesRow, { onConflict: "canal,external_order_id" })
      .select("sale_id")
      .single();

    if (salesErr || !upsertedSale) {
      throw new Error(`sales_upsert_failed: ${salesErr?.message ?? "no data"}`);
    }
    const saleId = (upsertedSale as { sale_id: string }).sale_id;

    // -- sale_items UPSERT — (sale_id, external_product_id) per migration 0008.
    //    We use a single .upsert(array) for batch efficiency; the partial
    //    unique index guards collisions.
    const itemRows = wcOrder.line_items.map((item) => {
      const quantity = item.quantity;
      const subtotal = Number(item.subtotal) || 0;
      const lineTotal = Number(item.total) || 0;
      const unitPrice = quantity > 0 ? subtotal / quantity : subtotal;
      return {
        sale_id: saleId,
        external_sku: item.sku ?? null,
        external_product_id: String(item.product_id),
        product_name: item.name,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        line_discount: 0,
      };
    });

    if (itemRows.length > 0) {
      const { error: itemsErr } = await sb
        .from("sale_items")
        .upsert(itemRows, { onConflict: "sale_id,external_product_id" });
      if (itemsErr) {
        throw new Error(`sale_items_upsert_failed: ${itemsErr.message}`);
      }
    }

    // -- Cascade: only items where master_sku IS NULL (post-UPSERT lookup).
    //    The IS NULL filter means re-runs on the same order skip already-
    //    resolved items — the cascade's own cache-hit path is the secondary
    //    safety net.
    const { data: unmatchedItems, error: unmatchedErr } = await sb
      .from("sale_items")
      .select("id, external_product_id, external_sku, product_name")
      .eq("sale_id", saleId)
      .is("master_sku", null);

    if (unmatchedErr) {
      throw new Error(
        `sale_items_unmatched_fetch_failed: ${unmatchedErr.message}`,
      );
    }

    for (const item of (unmatchedItems ?? []) as Array<{
      id: string;
      external_product_id: string | null;
      external_sku: string | null;
      product_name: string;
    }>) {
      if (!item.external_product_id || item.external_product_id.trim() === "") {
        // No channel-side id → cascade key missing → skip. The validation
        // queue picks this up via master_sku IS NULL.
        continue;
      }
      const candidate = {
        canal: "wordpress" as const,
        external_product_id: item.external_product_id,
        product_name: item.product_name,
        supplier_code: item.external_sku ?? undefined,
      };
      const result = await runMatchCascade(candidate, {
        supabase: sb,
        thresholds,
        llmConfig,
      });
      await persistMatch(sb, candidate, result, { thresholds });
      rowLog.debug(
        {
          job: "process-wp-events",
          raw_id: row.id,
          sale_id: saleId,
          item_id: item.id,
          method: result.method,
          score: result.score,
        },
        "job.cascade.applied",
      );
    }
  }
}

/**
 * CLI entry — invoked by `node dist/cron.js process-wp-events`. Wraps the
 * pure function with `process.exit` so Railway sees a clean exit code.
 */
export async function main(): Promise<void> {
  try {
    const result = await runProcessWpEvents();
    if (result.status === "failed") {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    orchestratorLog.fatal(
      { job: "process-wp-events", err: (err as Error).message },
      "job.fatal",
    );
    process.exit(1);
  }
}

function defaultLogger(): JobLogger {
  return {
    debug: (obj, msg) => orchestratorLog.debug(obj, msg),
    info: (obj, msg) => orchestratorLog.info(obj, msg),
    warn: (obj, msg) => orchestratorLog.warn(obj, msg),
    error: (obj, msg) => orchestratorLog.error(obj, msg),
  };
}
