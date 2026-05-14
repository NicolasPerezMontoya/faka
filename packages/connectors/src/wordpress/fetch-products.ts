/**
 * WooCommerce products pagination (Plan 2.2.1).
 *
 * Same shape as fetch-orders.ts but against `/products`. Uses
 * `modified_after` for the same reason (Pitfall 3) — products edited
 * after creation must show up on incremental pulls.
 */

import pRetry from "p-retry";
import type WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { WCProductSchema, type WCProduct } from "./client.js";
import type { WordPressConfig } from "./config.js";
import { createWooClient } from "./client.js";

export interface FetchLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

interface FetchProductsOptions {
  pageSize?: number;
  client?: WooCommerceRestApi;
  logger?: FetchLogger;
}

const DEFAULT_PAGE_SIZE = 100;

function toWooDateGmt(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

export async function fetchProducts(
  since: Date,
  cfg: WordPressConfig,
  opts: FetchProductsOptions = {},
): Promise<WCProduct[]> {
  const client = opts.client ?? createWooClient(cfg);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const logger = opts.logger;

  const collected: WCProduct[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const resp = await pRetry(
      () =>
        client.get("products", {
          per_page: pageSize,
          page,
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
      const parsed = WCProductSchema.safeParse(row);
      if (parsed.success) {
        collected.push(parsed.data);
      } else {
        logger?.warn("wordpress.fetchProducts.invalid_row", {
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
