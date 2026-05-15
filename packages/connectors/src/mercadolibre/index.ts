/**
 * Mercado Libre `ChannelConnector` — REAL implementation (Plan 2.1.2.4).
 *
 * REWRITE of the F1 skeleton. The prior version threw the "not implemented
 * for phase 4" sentinel on every method; this file replaces every throwing
 * body with a real implementation. Follows PATTERNS §1 (csv/index.ts model
 * + WP analog): factory + closure, helper functions hoisted out of the
 * returned object, `safeNormalize*` envelopes for partial-batch resilience.
 *
 * ── Degraded mode (RESEARCH §Environment Availability) ──────────────────────
 *
 *   - `loadMercadoLibreConfig` returns `{ ok: false, missing }` when any env
 *     var is missing/empty.
 *   - In that state every connector method that touches the network returns
 *     a safe empty fallback (NOT a throw). The connector surface always
 *     exists; behavior degrades, callers don't break.
 *   - `healthCheck` returns `{ ok: false, last_error: "not configured" }`.
 *   - Normalizers stay live (pure — degraded fetching doesn't prevent
 *     normalizing a raw payload that arrived by some other path).
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 *   - CC-11: ML_* env vars are orchestrator-only. The dashboard never imports
 *     `@faka/connectors/mercadolibre` directly.
 *   - W1: the CSV-only column-mapping helper is intentionally not imported.
 *   - F2-CASCADE-REUSE: no `@faka/connectors/(matching)` import. Cascade
 *     orchestration happens at the cron layer (Plan 2.1.3.2).
 *   - F1 idempotency: UPSERTs of sales/sale_items use
 *     `{ onConflict: "canal,external_order_id" }` — those UPSERTs live in
 *     the cron (Plan 2.1.3.2), NOT in this file. Here `fetchOrders` returns
 *     normalized rows; the cron does the persistence.
 *   - Single-seller invariant: `oauth_tokens` lookup uses `.limit(1)`.
 *   - `healthCheck` MUST NEVER throw (PATTERNS §1 W2 invariant).
 *   - No phase-4 placeholder throws remain — the rewrite replaces every
 *     prior throwing stub.
 */

import type {
  Channel,
  CustomerHint,
  NormalizedOrder,
  NormalizedProduct,
} from "@faka/schema";
import {
  type ChannelConnector,
  type ConnectorContext,
  type ConnectorFactory,
  type HealthStatus,
  type RawOrder,
  type RawProduct,
} from "../types.js";
import { createMLApiClient } from "./api-client.js";
import {
  loadMercadoLibreConfig,
  type LoadedMLConfig,
} from "./config.js";
import { normalizeOrder as normalizeOrderImpl } from "./normalize-order.js";
import { normalizeProduct as normalizeProductImpl } from "./normalize-product.js";
import type { MLItem, MLOrder } from "./types.js";
import { upsertProductWithVariants } from "./variant-mapper.js";

// -----------------------------------------------------------------------------
// Public config — the factory takes a minimal shape; the env loader runs
// inside the factory so tests can substitute it via `loadConfig`.
// -----------------------------------------------------------------------------

export interface MercadoLibreConnectorConfig {
  /** Override env loader — primarily for tests. */
  loadConfig?: () => LoadedMLConfig;
  /**
   * Override the api-client factory — primarily for tests that want to
   * stub the network surface without spinning up undici MockAgent.
   */
  createApiClient?: typeof createMLApiClient;
}

const canal: Channel = "mercadolibre";

// -----------------------------------------------------------------------------
// Helpers — hoisted out of the returned connector object per PATTERNS §1.
// -----------------------------------------------------------------------------

function isConfigured(
  cfg: LoadedMLConfig,
): cfg is Extract<LoadedMLConfig, { ok: true }> {
  return cfg.ok === true;
}

/**
 * Resolve the single ML seller's user_id from `oauth_tokens`. Single-account
 * invariant — multi-account is a future migration.
 */
async function resolveSellerUserId(
  ctx: ConnectorContext,
): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("oauth_tokens")
    .select("user_id")
    .eq("canal", "mercadolibre")
    .limit(1)
    .maybeSingle();
  if (error) {
    ctx.logger.warn("ml.oauth_tokens.lookup_failed", { err: error.message });
    return null;
  }
  if (!data) return null;
  return (data as { user_id: string }).user_id;
}

/**
 * Read the most recent `connector_runs.completed_at` for the ML channel —
 * surfaces as `healthCheck.last_success_at`.
 */
async function readLastSyncTimestamp(
  ctx: ConnectorContext,
): Promise<string | undefined> {
  const { data, error } = await ctx.supabase
    .from("connector_runs")
    .select("completed_at")
    .eq("kind", "channel")
    .eq("canal", "mercadolibre")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return undefined;
  return (data as { completed_at?: string } | null)?.completed_at;
}

function safeNormalizeOrder(
  payload: unknown,
): NormalizedOrder | { _error: { field?: string; message: string } } {
  try {
    return normalizeOrderImpl(payload as MLOrder);
  } catch (err) {
    return {
      _error: {
        message: (err as Error).message ?? "ml_normalize_order_failed",
      },
    };
  }
}

function safeNormalizeProduct(
  payload: unknown,
): NormalizedProduct | { _error: { field?: string; message: string } } {
  try {
    return normalizeProductImpl(payload as MLItem);
  } catch (err) {
    return {
      _error: {
        message: (err as Error).message ?? "ml_normalize_product_failed",
      },
    };
  }
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export const createMercadoLibreConnector: ConnectorFactory<
  MercadoLibreConnectorConfig
> = (config = {}) => {
  const loadCfg = config.loadConfig ?? (() => loadMercadoLibreConfig());
  const apiClientFactory = config.createApiClient ?? createMLApiClient;

  const connector: ChannelConnector = {
    name: "mercadolibre",
    canal,
    type: "pull",
    capabilities: new Set(["orders", "products", "inventory"]),

    async fetchOrders(
      since: Date,
      ctx: ConnectorContext,
    ): Promise<RawOrder[]> {
      const cfg = loadCfg();
      if (!isConfigured(cfg)) {
        ctx.logger.warn("ml.fetchOrders.degraded", {
          reason: "not_configured",
          missing: cfg.missing,
        });
        return [];
      }
      const sellerUserId = await resolveSellerUserId(ctx);
      if (!sellerUserId) {
        ctx.logger.warn("ml.fetchOrders.degraded", {
          reason: "no_oauth_token_row",
        });
        return [];
      }
      const client = apiClientFactory({
        config: cfg.cfg,
        supabase: ctx.supabase,
        userId: sellerUserId,
        logger: ctx.logger,
      });
      const orders = await client.getOrders({
        sellerId: sellerUserId,
        dateFrom: since.toISOString(),
      });
      return orders.map((o) => ({
        canal,
        payload_json: o as unknown as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      }));
    },

    async fetchProducts(
      _since: Date,
      ctx: ConnectorContext,
    ): Promise<RawProduct[]> {
      const cfg = loadCfg();
      if (!isConfigured(cfg)) {
        ctx.logger.warn("ml.fetchProducts.degraded", {
          reason: "not_configured",
          missing: cfg.missing,
        });
        return [];
      }
      const sellerUserId = await resolveSellerUserId(ctx);
      if (!sellerUserId) {
        ctx.logger.warn("ml.fetchProducts.degraded", {
          reason: "no_oauth_token_row",
        });
        return [];
      }
      const client = apiClientFactory({
        config: cfg.cfg,
        supabase: ctx.supabase,
        userId: sellerUserId,
        logger: ctx.logger,
      });

      // Drain scroll cursor end-to-end; ML's items endpoint does not support
      // a `since` filter (RESEARCH §Code Examples) so we let the variant-mapper's
      // idempotent UPSERT chain absorb re-fetches. The cron decides when to
      // re-run (60-min cadence).
      const collected: MLItem[] = [];
      let scrollId: string | undefined;
      let safety = 0;
      const MAX_PAGES = 200; // ML caps practical scrolls; defensive.
      while (safety < MAX_PAGES) {
        const page = await client.getItems({
          sellerId: sellerUserId,
          scrollId,
        });
        if (page.items.length === 0) break;
        const details = await client.getItemDetail(page.items);
        // Side-effect: persist via variant-mapper's UPSERT chain (PATTERNS §5
        // — writes happen inside the connector for products, mirroring F1's
        // csv/index.ts:217-264 pattern).
        for (const item of details) {
          const out = await upsertProductWithVariants(ctx.supabase, item);
          if (!out.ok) {
            ctx.logger.warn("ml.fetchProducts.upsert_failed", {
              id: item.id,
              error: out.error,
            });
          }
          collected.push(item);
        }
        if (!page.scroll_id) break;
        scrollId = page.scroll_id;
        safety += 1;
      }

      return collected.map((p) => ({
        canal,
        payload_json: p as unknown as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      }));
    },

    async normalizeOrder(
      raw: RawOrder,
      _ctx: ConnectorContext,
    ): Promise<NormalizedOrder> {
      const result = safeNormalizeOrder(raw.payload_json);
      if ("_error" in result) {
        throw new Error(`ml_normalize_order_failed: ${result._error.message}`);
      }
      return result;
    },

    async normalizeProduct(
      raw: RawProduct,
      _ctx: ConnectorContext,
    ): Promise<NormalizedProduct> {
      const result = safeNormalizeProduct(raw.payload_json);
      if ("_error" in result) {
        throw new Error(`ml_normalize_product_failed: ${result._error.message}`);
      }
      return result;
    },

    extractCustomerHint(raw: RawOrder): CustomerHint | null {
      const order = raw.payload_json as unknown as MLOrder;
      const phone =
        order.shipping?.receiver_address?.receiver_phone ??
        (order.buyer?.phone?.number
          ? `${order.buyer.phone.area_code ?? ""}${order.buyer.phone.number}`
          : undefined);
      const email = order.buyer?.email ?? undefined;
      const displayed_name =
        [order.buyer?.first_name, order.buyer?.last_name]
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .join(" ")
          .trim() || order.buyer?.nickname || undefined;
      const document_id = order.buyer?.billing_info?.doc_number ?? undefined;
      if (!phone && !email && !document_id) return null;
      return {
        phone: phone ?? undefined,
        email: email ?? undefined,
        document_id: document_id ?? undefined,
        external_customer_id: order.buyer?.id ? String(order.buyer.id) : undefined,
        displayed_name: displayed_name ?? undefined,
        external_identifier_type: phone ? "phone" : email ? "email" : "document",
        source: "order_payload",
      };
    },

    async healthCheck(ctx: ConnectorContext): Promise<HealthStatus> {
      // NEVER throws — PATTERNS §1 W2 invariant.
      try {
        const cfg = loadCfg();
        if (!isConfigured(cfg)) {
          return {
            ok: false,
            last_error: "not configured",
          };
        }
        const sellerUserId = await resolveSellerUserId(ctx);
        if (!sellerUserId) {
          return {
            ok: false,
            last_error: "no oauth_tokens row for canal=mercadolibre",
          };
        }
        const client = apiClientFactory({
          config: cfg.cfg,
          supabase: ctx.supabase,
          userId: sellerUserId,
          logger: ctx.logger,
        });
        const me = await client.getMe();
        if (!me) {
          return { ok: false, last_error: "getMe_returned_null" };
        }
        const last = await readLastSyncTimestamp(ctx);
        return {
          ok: true,
          last_success_at: last,
        };
      } catch (err) {
        ctx.logger.warn("ml.healthCheck.unexpected_error", {
          err: (err as Error).message,
        });
        return { ok: false, last_error: (err as Error).message };
      }
    },
  };

  return connector;
};

// -----------------------------------------------------------------------------
// Re-exports — the cron + dashboard import from this barrel.
// -----------------------------------------------------------------------------

export { loadMercadoLibreConfig, getMLConnectionStatus } from "./config.js";
export type {
  LoadedMLConfig,
  MLConfigOk,
  MLConfigMissing,
  MLConfigStatus,
} from "./config.js";
export {
  createMLApiClient,
  MLUnauthorizedError,
  MLRequestFailedError,
  type MLApiClient,
} from "./api-client.js";
export {
  exchangeCodeForToken,
  refreshToken,
  loadAccessToken,
  revokeTokens,
  MLTokenNotFoundError,
  MLOAuthFailedError,
} from "./oauth.js";
export {
  mapMLStatus,
  preserveCancellationDetail,
  ML_STATUS_MAP,
  type SalesEstado,
} from "./state-mapper.js";
export { normalizeOrder, normalizeOrderItems } from "./normalize-order.js";
export { normalizeProduct } from "./normalize-product.js";
export {
  mapVariation,
  variationFingerprint,
  upsertVariation,
  upsertProductWithVariants,
  type AttributeCombination,
  type AtributosJson,
} from "./variant-mapper.js";
export {
  ML_SITE_ID,
  ML_CURRENCY,
  type MLConfig,
  type MLItem,
  type MLOrder,
  type MLOrderItem,
  type MLTokenResponse,
  type MLVariation,
  type MLWebhookNotification,
  type OAuthTokenRow,
} from "./types.js";
