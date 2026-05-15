/**
 * Mercado Libre typed REST client (Plan 2.1.2.1 — PATTERNS §3 + RESEARCH §Code Examples).
 *
 * Transport layer: undici-based HTTP with auto-injected `Authorization: Bearer`,
 * `from_id` pagination for orders (RESEARCH §Pitfall 3 — `offset` caps at 10k),
 * `search_type=scan` + `scroll_id` for items (RESEARCH §Code Examples — bypasses
 * the 1000-record cap), and a 20-id batched `/items?ids=…` detail fetch.
 *
 * ── Invariants (PATTERNS §3 + RESEARCH §Anti-Patterns) ──────────────────────
 *
 *   • `site_id=MCO` is BAKED IN via the `ML_SITE_ID` constant from `types.ts`.
 *     There is no env override — multi-site is a future migration, not a flip.
 *   • 401s are distinct from 5xx: the wrapper does NOT retry on 401. Instead
 *     it triggers a single `loadAccessToken({ lazyRefreshOn401: true })` + one
 *     retry of the original request. A second 401 surfaces as
 *     `MLUnauthorizedError` to the caller (the cron logs + skips the page).
 *   • 429s honor the `Retry-After` header (RESEARCH §Standard Stack). Other
 *     5xx responses ride the generic `p-retry` exponential backoff (factor 2,
 *     3 retries, minTimeout 1000ms — matches `withRetryAndDLQ`).
 *   • Currency guard (RESEARCH §Pitfall 4): every yielded order is checked —
 *     `currency_id !== "COP"` routes to DLQ + skip. Don't poison `sales` with
 *     mixed currency. The check lives here (transport layer) so it's
 *     observable in `connector_runs.errors_json` from the cron without the
 *     normalizer having to know about currency policy.
 *   • Catalog-products mode (RESEARCH §Pitfall 9 + Assumption A2): items with
 *     `catalog_product_id != null` are out of scope for v1. We DLQ + skip in
 *     `getItemDetail` so the variant-mapper never sees them.
 *   • `include_attributes=all` on every item-detail fetch (RESEARCH §Pitfall 5).
 *     Without it, ML server-side-filters variations whose `available_quantity=0`
 *     and the historical-orders pull loses parent items the seller still
 *     references.
 *   • F2-CASCADE-REUSE — keep product-resolution code out of this file.
 *     That orchestration belongs at the cron layer (Plan 2.1.3.2), never in
 *     the transport layer.
 *   • DO NOT log `access_token` or `refresh_token` anywhere (RESEARCH §V8).
 */

import { request } from "undici";
import pRetry, { AbortError } from "p-retry";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRetryAndDLQ } from "../retry.js";
import { loadAccessToken } from "./oauth.js";
import {
  ML_CURRENCY,
  ML_SITE_ID,
  type MLConfig,
  type MLItem,
  type MLOrder,
} from "./types.js";

// -----------------------------------------------------------------------------
// Constants — site_id=MCO baked in.
// -----------------------------------------------------------------------------

const ML_API_BASE = "https://api.mercadolibre.com" as const;

/** ML's `/orders/search` limit per page. Documented max is 51 with `from_id`. */
const ORDERS_PAGE_LIMIT = 51;

/** Batch size for `/items?ids=…` — ML caps at 20 ids per request. */
const ITEMS_DETAIL_BATCH = 20;

/** p-retry envelope shared with `withRetryAndDLQ` for consistency. */
const RETRY_DEFAULTS = {
  retries: 3,
  factor: 2,
  minTimeout: 1000,
} as const;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * Thrown when ML responds 401 AFTER the one-shot refresh-retry attempt failed.
 * Callers (the orders/products crons) log + skip the page; the safety-net
 * cron picks the user up on its next tick. Distinct from generic 5xx (which
 * `pRetry` absorbs) so the caller can branch on the failure mode.
 */
export class MLUnauthorizedError extends Error {
  constructor(message = "ml_unauthorized_after_refresh_retry") {
    super(message);
    this.name = "MLUnauthorizedError";
  }
}

/**
 * Thrown when ML returns a non-2xx that's NOT 401/429 and survives retries.
 * `pRetry` exhausts then surfaces via the `withRetryAndDLQ` envelope (which
 * writes a DLQ row + returns null). Inner request callers receive the raw
 * error so the retry envelope can decide; outer callers see it as DLQ side
 * effects + null returns.
 */
export class MLRequestFailedError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "MLRequestFailedError";
  }
}

// -----------------------------------------------------------------------------
// Internal: signed GET with 401-aware retry + 429-aware Retry-After.
// -----------------------------------------------------------------------------

interface MLApiClientCtx {
  config: MLConfig;
  supabase: SupabaseClient;
  /** ML `user_id` (string-coerced — DB column is text per migration 0001). */
  userId: string;
  /** Optional logger for ml.api.* events; defaults to console-noop. */
  logger?: {
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    info?: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

interface GetOptions {
  /** Force a `lazyRefreshOn401` refresh on this call (post-401-retry path). */
  forceRefresh?: boolean;
}

/**
 * Single auth-aware GET to `${ML_API_BASE}${path}`. Used by all public methods.
 *
 * Responsibilities:
 *   1. Resolve a fresh access token via `loadAccessToken`.
 *   2. Inject `Authorization: Bearer <token>` + `accept: application/json`.
 *   3. On 401 → re-resolve with `lazyRefreshOn401: true` then retry ONCE.
 *      Second 401 → throw `MLUnauthorizedError`.
 *   4. On 429 → sleep for `Retry-After` seconds (capped at 60), then throw a
 *      retriable error so `p-retry` can re-issue with backoff.
 *   5. On 5xx → throw retriable `MLRequestFailedError` so `p-retry` retries.
 *   6. On other non-2xx → throw `AbortError` so `p-retry` stops + the
 *      `withRetryAndDLQ` wrapper writes a DLQ row.
 */
async function rawGet(
  ctx: MLApiClientCtx,
  path: string,
  opts: GetOptions = {},
): Promise<unknown> {
  const token = await loadAccessToken(ctx.supabase, ctx.config, {
    userId: ctx.userId,
    lazyRefreshOn401: opts.forceRefresh === true,
  });
  if (!token) {
    // No token row → permanently failed; do NOT retry. The cron logs + skips.
    throw new AbortError(`ml_no_token_for_user_${ctx.userId}`);
  }

  const url = `${ML_API_BASE}${path}`;
  const { statusCode, headers, body } = await request(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });

  if (statusCode >= 200 && statusCode < 300) {
    return body.json();
  }

  // Drain the body for the error path so we don't leak the socket.
  const text = await body.text();

  if (statusCode === 401) {
    // 401 — propagate as an MLUnauthorizedError; the caller decides whether
    // this is the first 401 (refresh + retry once) or the second (give up).
    throw new MLUnauthorizedError(`ml_401: ${text.slice(0, 200)}`);
  }

  if (statusCode === 429) {
    const retryAfterRaw = (headers["retry-after"] as string | undefined) ?? "";
    const retryAfterSec = Math.min(Number(retryAfterRaw) || 1, 60);
    await sleep(retryAfterSec * 1000);
    // Throw retriable so `p-retry` re-issues. NOT an AbortError — we DO want
    // the wrapper to retry rate-limited responses.
    throw new MLRequestFailedError(
      `ml_429_retry_after_${retryAfterSec}s`,
      429,
      text.slice(0, 200),
    );
  }

  if (statusCode >= 500 && statusCode < 600) {
    // 5xx — retriable. p-retry's exponential backoff handles it.
    throw new MLRequestFailedError(
      `ml_${statusCode}: ${text.slice(0, 200)}`,
      statusCode,
      text,
    );
  }

  // 4xx (other than 401/429) — permanent failure. Don't retry; let the
  // wrapper DLQ this attempt.
  throw new AbortError(
    `ml_${statusCode}_permanent: ${text.slice(0, 200)}`,
  );
}

/**
 * 401-aware GET wrapper. Tries `rawGet`; on `MLUnauthorizedError` retries
 * ONCE with `forceRefresh: true`. After the second 401, surfaces the error
 * unchanged so the caller (cron) logs + skips.
 *
 * Wrapped in `pRetry` so 5xx / 429 paths get exponential backoff. 401 is
 * handled OUTSIDE the retry envelope because it needs its own state machine
 * (refresh + single retry, not exponential).
 */
async function authedGet(
  ctx: MLApiClientCtx,
  path: string,
): Promise<unknown> {
  let attemptedRefresh = false;

  return pRetry(
    async () => {
      try {
        return await rawGet(ctx, path, {
          forceRefresh: attemptedRefresh,
        });
      } catch (err) {
        if (err instanceof MLUnauthorizedError && !attemptedRefresh) {
          // First 401 — force a refresh, then let p-retry call us again.
          // p-retry will count this as one retry; we mark the refresh flag
          // so the next iteration uses the freshly rotated token.
          attemptedRefresh = true;
          throw err; // re-throw so p-retry retries
        }
        throw err;
      }
    },
    RETRY_DEFAULTS,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// -----------------------------------------------------------------------------
// Public API client surface
// -----------------------------------------------------------------------------

export interface MLApiClient {
  /**
   * Orders search with `from_id` pagination (RESEARCH §Pitfall 3 — never use
   * `offset`, it caps at 10k). Returns all orders changed in the inclusive
   * range; currency-drift rows are routed to DLQ + skipped.
   */
  getOrders(params: {
    sellerId: string;
    dateFrom: string;
    dateTo?: string;
    fromId?: string;
  }): Promise<MLOrder[]>;

  /** Single-order GET for webhook reconciliation. Returns null on 404. */
  getOrderById(id: string | number): Promise<MLOrder | null>;

  /**
   * Items search using `search_type=scan` + `scroll_id` to bypass the
   * 1000-record cap (RESEARCH §Code Examples). Returns the page of item IDs
   * + the next scroll_id (or null when exhausted).
   */
  getItems(params: {
    sellerId: string;
    scrollId?: string;
  }): Promise<{ items: string[]; scroll_id: string | null }>;

  /**
   * Batched item-detail fetch — `/items?ids=ID1,ID2,…` with 20 ids per
   * request. Always passes `include_attributes=all` (RESEARCH §Pitfall 5).
   * Catalog-products-mode items (`catalog_product_id != null`) are DLQ'd +
   * dropped from the returned array.
   */
  getItemDetail(ids: string[]): Promise<MLItem[]>;

  /** Lightweight `/users/me` for healthCheck. Returns null on any error. */
  getMe(): Promise<{ id: string; nickname: string } | null>;
}

/**
 * Factory — returns a closure over the supabase + config + userId. Callers
 * (the cron + healthCheck) hold the returned instance for the duration of a
 * run; do NOT cache across runs because the supabase client lifetime is
 * scoped to the orchestrator's request envelope.
 */
export function createMLApiClient(ctx: MLApiClientCtx): MLApiClient {
  const logger = ctx.logger;

  async function getOrders(params: {
    sellerId: string;
    dateFrom: string;
    dateTo?: string;
    fromId?: string;
  }): Promise<MLOrder[]> {
    const collected: MLOrder[] = [];
    let fromId = params.fromId;
    // Loop until ML returns fewer rows than the page limit OR the response
    // omits `paging.last_id` (the documented end-of-results signal).
    /* eslint-disable no-constant-condition */
    while (true) {
      const search = new URLSearchParams();
      search.set("seller", params.sellerId);
      search.set("order.date_last_updated.from", params.dateFrom);
      if (params.dateTo) {
        search.set("order.date_last_updated.to", params.dateTo);
      }
      search.set("sort", "date_asc");
      search.set("limit", String(ORDERS_PAGE_LIMIT));
      // site_id=MCO is BAKED IN — never env-configurable.
      search.set("site_id", ML_SITE_ID);
      if (fromId) {
        search.set("from_id", fromId);
      }
      const path = `/orders/search?${search.toString()}`;

      const page = (await withRetryAndDLQ(
        () => authedGet(ctx, path) as Promise<MLOrdersPage>,
        {
          canal: "mercadolibre",
          source: "orders.fetch",
          payload: {
            stage: "orders.search",
            from: params.dateFrom,
            to: params.dateTo ?? null,
            fromId: fromId ?? null,
          },
        },
        ctx.supabase,
      )) as MLOrdersPage | null;

      if (!page) {
        // DLQ wrote the failure; stop paginating to avoid spinning on the same
        // upstream error.
        break;
      }

      const rows = Array.isArray(page.results) ? page.results : [];
      for (const row of rows) {
        // Currency guard (RESEARCH §Pitfall 4): drop COP-only invariant.
        if (row && row.currency_id !== ML_CURRENCY) {
          await ctx.supabase.from("dead_letter_queue").insert({
            canal: "mercadolibre",
            source: "orders.fetch.currency_drift",
            payload_json: {
              order_id: row.id,
              currency_id: row.currency_id,
            },
            error: `currency_id !== "COP"`,
            attempts: 1,
            last_attempted_at: new Date().toISOString(),
          });
          logger?.warn("ml.orders.currency_drift", {
            order_id: row.id,
            currency_id: row.currency_id,
          });
          continue;
        }
        collected.push(row);
      }

      const lastId = page.paging?.last_id;
      if (!lastId || rows.length < ORDERS_PAGE_LIMIT) {
        break;
      }
      fromId = String(lastId);
    }
    return collected;
  }

  async function getOrderById(
    id: string | number,
  ): Promise<MLOrder | null> {
    const path = `/orders/${encodeURIComponent(String(id))}`;
    try {
      const result = (await withRetryAndDLQ(
        () => authedGet(ctx, path) as Promise<MLOrder>,
        {
          canal: "mercadolibre",
          source: "orders.get_by_id",
          payload: { order_id: id },
        },
        ctx.supabase,
      )) as MLOrder | null;
      return result;
    } catch (err) {
      // Most 4xx already become AbortError + DLQ; the rare other-failure
      // surfaces here. Treat as "skip" for the caller.
      logger?.warn("ml.orders.get_by_id_failed", {
        order_id: id,
        err: (err as Error).message,
      });
      return null;
    }
  }

  async function getItems(params: {
    sellerId: string;
    scrollId?: string;
  }): Promise<{ items: string[]; scroll_id: string | null }> {
    const search = new URLSearchParams();
    search.set("search_type", "scan");
    search.set("limit", "50");
    if (params.scrollId) {
      search.set("scroll_id", params.scrollId);
    }
    const path = `/users/${encodeURIComponent(params.sellerId)}/items/search?${search.toString()}`;

    const page = (await withRetryAndDLQ(
      () => authedGet(ctx, path) as Promise<MLItemsScanPage>,
      {
        canal: "mercadolibre",
        source: "items.scan",
        payload: { stage: "items.scan", scroll_id: params.scrollId ?? null },
      },
      ctx.supabase,
    )) as MLItemsScanPage | null;

    if (!page) {
      return { items: [], scroll_id: null };
    }

    const items = Array.isArray(page.results) ? page.results : [];
    // `paging.total - already-seen` could let us derive end-of-scroll, but
    // ML's contract is: scroll is exhausted when results.length === 0.
    const nextScroll = items.length > 0 ? page.scroll_id ?? null : null;
    return { items, scroll_id: nextScroll };
  }

  async function getItemDetail(ids: string[]): Promise<MLItem[]> {
    if (ids.length === 0) return [];
    const out: MLItem[] = [];
    // Batch in groups of 20 (ML hard cap).
    for (let i = 0; i < ids.length; i += ITEMS_DETAIL_BATCH) {
      const batch = ids.slice(i, i + ITEMS_DETAIL_BATCH);
      const search = new URLSearchParams();
      search.set("ids", batch.join(","));
      // Pitfall 5 — include_attributes=all so out-of-stock variations stay
      // visible.
      search.set("include_attributes", "all");
      const path = `/items?${search.toString()}`;

      const page = (await withRetryAndDLQ(
        () => authedGet(ctx, path) as Promise<MLItemsMultiGetEntry[]>,
        {
          canal: "mercadolibre",
          source: "items.multiget",
          payload: { stage: "items.multiget", ids: batch },
        },
        ctx.supabase,
      )) as MLItemsMultiGetEntry[] | null;

      if (!page) continue;

      for (const entry of page) {
        if (!entry || entry.code !== 200 || !entry.body) {
          // ML's multi-get echoes per-id status codes. Non-200 entries are
          // logged but don't poison the batch.
          logger?.warn("ml.items.multiget.entry_failed", {
            id: entry?.body?.id ?? null,
            code: entry?.code ?? null,
          });
          continue;
        }
        const body = entry.body;
        // Pitfall 9 — catalog_product_id != null is out of v1 scope. DLQ +
        // skip so the variant-mapper never sees these.
        if (body.catalog_product_id != null) {
          await ctx.supabase.from("dead_letter_queue").insert({
            canal: "mercadolibre",
            source: "items.catalog_product_not_supported",
            payload_json: {
              id: body.id,
              catalog_product_id: body.catalog_product_id,
            },
            error: "catalog_product_id_set",
            attempts: 1,
            last_attempted_at: new Date().toISOString(),
          });
          logger?.warn("ml.items.catalog_product_skipped", {
            id: body.id,
          });
          continue;
        }
        out.push(body);
      }
    }
    return out;
  }

  async function getMe(): Promise<{ id: string; nickname: string } | null> {
    try {
      const me = (await authedGet(ctx, "/users/me")) as
        | { id: number | string; nickname?: string }
        | null;
      if (!me) return null;
      return {
        id: String(me.id),
        nickname: typeof me.nickname === "string" ? me.nickname : "",
      };
    } catch (err) {
      logger?.warn("ml.getMe.failed", { err: (err as Error).message });
      return null;
    }
  }

  return {
    getOrders,
    getOrderById,
    getItems,
    getItemDetail,
    getMe,
  };
}

// -----------------------------------------------------------------------------
// Internal page shapes (narrow — only what the client reads).
// -----------------------------------------------------------------------------

interface MLOrdersPage {
  results: MLOrder[];
  paging?: {
    total?: number;
    limit?: number;
    last_id?: string | number | null;
  };
}

interface MLItemsScanPage {
  results: string[];
  scroll_id?: string | null;
  paging?: { total?: number; limit?: number };
}

interface MLItemsMultiGetEntry {
  code: number;
  body: MLItem;
}
