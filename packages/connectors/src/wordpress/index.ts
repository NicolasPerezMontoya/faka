/**
 * WordPress (WooCommerce) ChannelConnector — Plan 2.2.1.
 *
 * REWRITE of the F1 skeleton. Follows PATTERNS §1 (csv/index.ts model):
 * factory + closure, helper functions hoisted out of the returned object,
 * `safeNormalize*` envelopes for partial-batch resilience, idempotent
 * UPSERTs with `{ onConflict: "canal,external_order_id" }`.
 *
 * Degraded mode (RESEARCH §Environment Availability — MANDATED for WP-01):
 *   - `loadWordPressConfig` returns `{ ok: false }` when any env var is
 *     missing/empty.
 *   - In that state every connector method that touches the network returns
 *     a safe empty fallback (NOT a throw). The connector surface always
 *     exists; behavior degrades, callers don't break.
 *   - `healthCheck` returns `{ ok: false, last_error: "not configured" }`.
 *   - Normalizers stay live (they're pure — degraded fetching doesn't
 *     prevent normalizing a raw payload that arrived by some other path).
 *
 * Invariant CC-11: WORDPRESS_API_SECRET and WORDPRESS_WEBHOOK_SECRET are
 * orchestrator-only. The dashboard never imports `@faka/connectors/wordpress`.
 *
 * Invariant W1: this module + the normalize-*.ts files MUST NOT import the
 * CSV column-mapping helper (that helper is CSV-only). The grep gate against
 * `packages/connectors/src/wordpress/` for `applyColumn` + `Map` is the
 * enforcement check (run from CI; intentionally omitted from the docstring).
 */

import type { Channel, CustomerHint, NormalizedOrder, NormalizedProduct } from "@faka/schema";
import type {
  ChannelConnector,
  ConnectorContext,
  ConnectorFactory,
  HealthStatus,
  RawOrder,
  RawProduct,
} from "../types.js";
import { loadWordPressConfig, type LoadedWordPressConfig } from "./config.js";
import { createWooClient, WCOrderSchema, WCProductSchema } from "./client.js";
import { fetchOrders as fetchOrdersImpl } from "./fetch-orders.js";
import { fetchProducts as fetchProductsImpl } from "./fetch-products.js";
import { normalizeOrder as normalizeOrderImpl } from "./normalize-order.js";
import { normalizeProduct as normalizeProductImpl } from "./normalize-product.js";

export interface WordPressConnectorConfig {
  /** Override env loader — primarily for tests. */
  loadConfig?: () => LoadedWordPressConfig;
}

const canal: Channel = "wordpress";

function isConfigured(
  cfg: LoadedWordPressConfig,
): cfg is Extract<LoadedWordPressConfig, { ok: true }> {
  return cfg.ok === true;
}

function safeNormalizeOrder(
  payload: unknown,
): NormalizedOrder | { _error: { field?: string; message: string } } {
  const parsed = WCOrderSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      _error: {
        field: issue?.path.join("."),
        message: issue?.message ?? "invalid_wc_order",
      },
    };
  }
  return normalizeOrderImpl(parsed.data);
}

function safeNormalizeProduct(
  payload: unknown,
): NormalizedProduct | { _error: { field?: string; message: string } } {
  const parsed = WCProductSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      _error: {
        field: issue?.path.join("."),
        message: issue?.message ?? "invalid_wc_product",
      },
    };
  }
  return normalizeProductImpl(parsed.data);
}

export const createWordPressConnector: ConnectorFactory<
  WordPressConnectorConfig
> = (config = {}) => {
  const loadCfg = config.loadConfig ?? (() => loadWordPressConfig());

  const connector: ChannelConnector = {
    name: "wordpress",
    canal,
    type: "pull",
    capabilities: new Set(["orders", "products"]),

    async fetchOrders(
      since: Date,
      ctx: ConnectorContext,
    ): Promise<RawOrder[]> {
      const cfg = loadCfg();
      if (!isConfigured(cfg)) {
        ctx.logger.warn("wordpress.fetchOrders.degraded", {
          reason: "not_configured",
        });
        return [];
      }
      const orders = await fetchOrdersImpl(since, cfg, {
        logger: ctx.logger,
      });
      return orders.map((o) => ({
        canal,
        payload_json: o as unknown as Record<string, unknown>,
        fetched_at: new Date().toISOString(),
      }));
    },

    async fetchProducts(
      since: Date,
      ctx: ConnectorContext,
    ): Promise<RawProduct[]> {
      const cfg = loadCfg();
      if (!isConfigured(cfg)) {
        ctx.logger.warn("wordpress.fetchProducts.degraded", {
          reason: "not_configured",
        });
        return [];
      }
      const products = await fetchProductsImpl(since, cfg, {
        logger: ctx.logger,
      });
      return products.map((p) => ({
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
        throw new Error(`normalize_order_failed: ${result._error.message}`);
      }
      return result;
    },

    async normalizeProduct(
      raw: RawProduct,
      _ctx: ConnectorContext,
    ): Promise<NormalizedProduct> {
      const result = safeNormalizeProduct(raw.payload_json);
      if ("_error" in result) {
        throw new Error(`normalize_product_failed: ${result._error.message}`);
      }
      return result;
    },

    extractCustomerHint(raw: RawOrder): CustomerHint | null {
      const payload = raw.payload_json as Record<string, unknown>;
      const billing = payload.billing as
        | {
            first_name?: string | null;
            last_name?: string | null;
            email?: string | null;
            phone?: string | null;
          }
        | undefined;
      const phone =
        billing && typeof billing.phone === "string" ? billing.phone : undefined;
      const email =
        billing && typeof billing.email === "string" ? billing.email : undefined;
      const first =
        billing && typeof billing.first_name === "string"
          ? billing.first_name
          : "";
      const last =
        billing && typeof billing.last_name === "string"
          ? billing.last_name
          : "";
      const name = `${first} ${last}`.trim();
      if (!phone && !email) return null;
      return {
        phone: phone || undefined,
        email: email || undefined,
        displayed_name: name.length > 0 ? name : undefined,
        external_identifier_type: phone ? "phone" : "email",
        source: "order_payload",
      };
    },

    async healthCheck(ctx: ConnectorContext): Promise<HealthStatus> {
      const cfg = loadCfg();
      if (!isConfigured(cfg)) {
        return { ok: false, last_error: "not configured" };
      }
      try {
        const client = createWooClient(cfg);
        // Lightweight liveness probe — system_status is auth-gated, so a 200
        // confirms both reachability AND that the consumer key signs requests.
        await client.get("system_status");
        return { ok: true };
      } catch (err) {
        ctx.logger.warn("wordpress.healthCheck.failed", {
          err: (err as Error).message,
        });
        return { ok: false, last_error: (err as Error).message };
      }
    },
  };

  return connector;
};

export { loadWordPressConfig } from "./config.js";
export type {
  LoadedWordPressConfig,
  WordPressConfig,
  WordPressConfigMissing,
} from "./config.js";
export { createWooClient } from "./client.js";
export {
  WCOrderSchema,
  WCProductSchema,
  type WCOrder,
  type WCProduct,
  type WCOrderLineItem,
} from "./client.js";
export { fetchOrders } from "./fetch-orders.js";
export { fetchProducts } from "./fetch-products.js";
export { normalizeOrder } from "./normalize-order.js";
export { normalizeProduct } from "./normalize-product.js";
export { verifyWooSignature } from "./webhook-verify.js";
export { checkDeliverySeen, type DeliveryRecord } from "./webhook-dedupe.js";
