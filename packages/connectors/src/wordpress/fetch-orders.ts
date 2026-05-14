/**
 * WooCommerce orders pagination (Plan 2.2.1, RESEARCH §Pattern 2 verbatim).
 *
 * Pitfall 3 (WC GitHub #14539): MUST use `modified_after` instead of `after`.
 * `after` filters by `date_created` and silently drops orders whose status
 * was changed (e.g. cancellations, refunds) — those are exactly the events
 * an idempotent incremental pull needs to capture.
 *
 * Per-page calls are wrapped in p-retry (3 tries, factor 2, 1s minTimeout).
 * Per-row Zod failures are LOGGED + SKIPPED (partial-batch resilience per
 * PATTERNS §1 csv index.ts:148-182 envelope). Page-level transport errors
 * propagate after retries exhaust — the orchestrator records them on
 * `connector_runs`.
 */

import pRetry from "p-retry";
import type WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { WCOrderSchema, type WCOrder } from "./client.js";
import type { WordPressConfig } from "./config.js";
import { createWooClient } from "./client.js";

export interface FetchLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

interface FetchOrdersOptions {
  pageSize?: number;
  /** Override the SDK client (mostly for tests with MSW). */
  client?: WooCommerceRestApi;
  logger?: FetchLogger;
}

const DEFAULT_PAGE_SIZE = 100;

/**
 * WooCommerce expects `modified_after` in `YYYY-MM-DDTHH:mm:ss` (no ms, no Z)
 * paired with `dates_are_gmt=true`. We trim the trailing `.NNNZ`.
 */
function toWooDateGmt(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

export async function fetchOrders(
  since: Date,
  cfg: WordPressConfig,
  opts: FetchOrdersOptions = {},
): Promise<WCOrder[]> {
  const client = opts.client ?? createWooClient(cfg);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const logger = opts.logger;

  const collected: WCOrder[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const resp = await pRetry(
      () =>
        client.get("orders", {
          per_page: pageSize,
          page,
          // CRITICAL Pitfall 3 — modified_after, NOT after
          modified_after: toWooDateGmt(since),
          dates_are_gmt: true,
          orderby: "modified",
          order: "asc",
        }),
      { retries: 3, factor: 2, minTimeout: 1000 },
    );

    const headerPages = Number(
      (resp.headers as Record<string, string | string[]>)?.["x-wp-totalpages"],
    );
    if (Number.isFinite(headerPages) && headerPages > 0) {
      totalPages = headerPages;
    }

    const rows = Array.isArray(resp.data) ? resp.data : [];
    for (const row of rows) {
      const parsed = WCOrderSchema.safeParse(row);
      if (parsed.success) {
        collected.push(parsed.data);
      } else {
        logger?.warn("wordpress.fetchOrders.invalid_row", {
          page,
          issue: parsed.error.issues[0]?.message,
          path: parsed.error.issues[0]?.path?.join("."),
        });
      }
    }
    page += 1;
  } while (page <= totalPages);

  return collected;
}
