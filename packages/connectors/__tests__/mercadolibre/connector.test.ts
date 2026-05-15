/**
 * Tests for `packages/connectors/src/mercadolibre/index.ts` (Plan 2.1.2.4).
 *
 * Coverage:
 *   1. Connector surface — name="mercadolibre", canal="mercadolibre",
 *      type="pull", capabilities includes orders/products.
 *   2. Degraded mode (config not loaded) — fetchOrders/fetchProducts return
 *      [] without touching the network; healthCheck returns ok:false.
 *   3. Configured + connected — fetchOrders delegates to api-client and
 *      returns RawOrder[] envelopes.
 *   4. extractCustomerHint pulls phone+email+doc from the order payload.
 *   5. normalizeOrder routes through the pure normalizer (golden fixture).
 *   6. healthCheck NEVER throws — wraps unexpected errors.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createMercadoLibreConnector } from "../../src/mercadolibre/index.js";
import type {
  ConnectorContext,
  RawOrder,
  RawProduct,
} from "../../src/types.js";
import type { MLOrder } from "../../src/mercadolibre/types.js";
import type { LoadedMLConfig } from "../../src/mercadolibre/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "__fixtures__", name), "utf-8"),
  ) as T;
}

function makeCtx(supabaseLike?: unknown): ConnectorContext {
  return {
    supabase: (supabaseLike ?? {
      from(_t: string) {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      },
    }) as never,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

const DEGRADED_LOAD = (): LoadedMLConfig => ({
  ok: false,
  reason: "not_configured",
  missing: ["ML_CLIENT_ID"],
});

const CONFIGURED_LOAD = (): LoadedMLConfig => ({
  ok: true,
  cfg: {
    clientId: "3933497047128728",
    clientSecret: "secret",
    redirectUri: "https://example.com/oauth/mercadolibre/callback",
    webhookSecret: "ws",
    siteId: "MCO",
  },
});

// -----------------------------------------------------------------------------
// (1) Surface
// -----------------------------------------------------------------------------

describe("createMercadoLibreConnector — surface", () => {
  it("exposes name/canal/type/capabilities matching the F2.1 contract", () => {
    const connector = createMercadoLibreConnector({});
    expect(connector.name).toBe("mercadolibre");
    expect(connector.canal).toBe("mercadolibre");
    expect(connector.type).toBe("pull");
    expect(connector.capabilities.has("orders")).toBe(true);
    expect(connector.capabilities.has("products")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// (2) Degraded mode
// -----------------------------------------------------------------------------

describe("degraded mode (config missing)", () => {
  it("fetchOrders returns [] without touching the network", async () => {
    const connector = createMercadoLibreConnector({ loadConfig: DEGRADED_LOAD });
    const ctx = makeCtx();
    const out = await connector.fetchOrders(new Date(), ctx);
    expect(out).toEqual([]);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "ml.fetchOrders.degraded",
      expect.objectContaining({ reason: "not_configured" }),
    );
  });

  it("fetchProducts returns [] without touching the network", async () => {
    const connector = createMercadoLibreConnector({ loadConfig: DEGRADED_LOAD });
    const ctx = makeCtx();
    const out = await connector.fetchProducts(new Date(), ctx);
    expect(out).toEqual([]);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "ml.fetchProducts.degraded",
      expect.objectContaining({ reason: "not_configured" }),
    );
  });

  it("healthCheck returns ok:false with 'not configured' when env missing", async () => {
    const connector = createMercadoLibreConnector({ loadConfig: DEGRADED_LOAD });
    const ctx = makeCtx();
    const health = await connector.healthCheck(ctx);
    expect(health.ok).toBe(false);
    expect(health.last_error).toBe("not configured");
  });
});

// -----------------------------------------------------------------------------
// (3) Configured but no oauth_tokens row
// -----------------------------------------------------------------------------

describe("configured but no oauth_tokens row", () => {
  it("fetchOrders returns [] when no token row exists", async () => {
    const connector = createMercadoLibreConnector({
      loadConfig: CONFIGURED_LOAD,
    });
    const ctx = makeCtx();
    const out = await connector.fetchOrders(new Date(), ctx);
    expect(out).toEqual([]);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      "ml.fetchOrders.degraded",
      expect.objectContaining({ reason: "no_oauth_token_row" }),
    );
  });

  it("healthCheck returns ok:false with 'no oauth_tokens row' when not connected", async () => {
    const connector = createMercadoLibreConnector({
      loadConfig: CONFIGURED_LOAD,
    });
    const ctx = makeCtx();
    const health = await connector.healthCheck(ctx);
    expect(health.ok).toBe(false);
    expect(health.last_error).toMatch(/no oauth_tokens/);
  });
});

// -----------------------------------------------------------------------------
// (4) Configured + connected — delegation to api-client
// -----------------------------------------------------------------------------

describe("configured + connected — delegation", () => {
  function makeSupabaseWithToken(userId = "USR_99") {
    return {
      from(table: string) {
        if (table === "oauth_tokens") {
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: { user_id: userId },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "connector_runs") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { completed_at: "2026-05-15T05:00:00.000Z" },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          }),
        };
      },
    };
  }

  it("fetchOrders delegates to api-client.getOrders and returns RawOrder envelopes", async () => {
    const mockOrders: MLOrder[] = [
      loadFixture<MLOrder>("ml-order-paid.json"),
    ];
    const fakeApi = vi.fn().mockImplementation(() => ({
      getOrders: async () => mockOrders,
      getOrderById: async () => null,
      getItems: async () => ({ items: [], scroll_id: null }),
      getItemDetail: async () => [],
      getMe: async () => ({ id: "USR_99", nickname: "test" }),
    }));
    const connector = createMercadoLibreConnector({
      loadConfig: CONFIGURED_LOAD,
      createApiClient: fakeApi as never,
    });
    const ctx = makeCtx(makeSupabaseWithToken());
    const out = await connector.fetchOrders(new Date("2026-05-15T00:00:00Z"), ctx);
    expect(out).toHaveLength(1);
    expect((out as RawOrder[])[0]!.canal).toBe("mercadolibre");
    expect((out as RawOrder[])[0]!.payload_json).toBeDefined();
    // api-client factory was called with the resolved seller user_id.
    expect(fakeApi).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "USR_99" }),
    );
  });

  it("healthCheck returns ok:true + last_success_at when fully configured + connected", async () => {
    const fakeApi = vi.fn().mockImplementation(() => ({
      getOrders: async () => [],
      getOrderById: async () => null,
      getItems: async () => ({ items: [], scroll_id: null }),
      getItemDetail: async () => [],
      getMe: async () => ({ id: "USR_99", nickname: "test_seller" }),
    }));
    const connector = createMercadoLibreConnector({
      loadConfig: CONFIGURED_LOAD,
      createApiClient: fakeApi as never,
    });
    const ctx = makeCtx(makeSupabaseWithToken());
    const health = await connector.healthCheck(ctx);
    expect(health.ok).toBe(true);
    expect(health.last_success_at).toBe("2026-05-15T05:00:00.000Z");
  });

  it("healthCheck NEVER throws — wraps unexpected errors", async () => {
    const fakeApi = vi.fn().mockImplementation(() => ({
      getMe: async () => {
        throw new Error("network exploded");
      },
    }));
    const connector = createMercadoLibreConnector({
      loadConfig: CONFIGURED_LOAD,
      createApiClient: fakeApi as never,
    });
    const ctx = makeCtx(makeSupabaseWithToken());
    const health = await connector.healthCheck(ctx);
    expect(health.ok).toBe(false);
    expect(health.last_error).toMatch(/network exploded/);
  });
});

// -----------------------------------------------------------------------------
// (5) normalizeOrder
// -----------------------------------------------------------------------------

describe("normalizeOrder via connector surface", () => {
  it("delegates to the pure normalizer and routes the fixture cleanly", async () => {
    const connector = createMercadoLibreConnector({});
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    const out = await connector.normalizeOrder(
      {
        canal: "mercadolibre",
        payload_json: raw as unknown as Record<string, unknown>,
      } as RawOrder,
      makeCtx(),
    );
    expect(out.channel).toBe("mercadolibre");
    expect(out.status).toBe("pagado");
    expect(out.external_order_id).toBe("2000000001");
  });
});

// -----------------------------------------------------------------------------
// (6) extractCustomerHint
// -----------------------------------------------------------------------------

describe("extractCustomerHint", () => {
  it("returns a CustomerHint with phone+email+doc from the order envelope", () => {
    const connector = createMercadoLibreConnector({});
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    const hint = connector.extractCustomerHint!({
      canal: "mercadolibre",
      payload_json: raw as unknown as Record<string, unknown>,
    } as RawOrder);
    expect(hint).not.toBeNull();
    expect(hint!.phone).toBe("3000000000");
    expect(hint!.email).toBe("redacted@example.com");
    expect(hint!.document_id).toBe("0000000000");
    expect(hint!.external_identifier_type).toBe("phone");
    expect(hint!.source).toBe("order_payload");
  });

  it("returns null when no identifier is present", () => {
    const connector = createMercadoLibreConnector({});
    const empty: Partial<MLOrder> = {
      id: 1,
      buyer: { id: 1 },
      shipping: undefined,
    };
    const hint = connector.extractCustomerHint!({
      canal: "mercadolibre",
      payload_json: empty as unknown as Record<string, unknown>,
    } as RawOrder);
    expect(hint).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// (7) normalizeProduct envelope (smoke — pure normalizer tested separately)
// -----------------------------------------------------------------------------

describe("normalizeProduct via connector surface", () => {
  it("routes an item fixture through the pure normalizer", async () => {
    const connector = createMercadoLibreConnector({});
    const item = loadFixture("ml-item-with-variations.json");
    const out = await connector.normalizeProduct(
      {
        canal: "mercadolibre",
        payload_json: item as Record<string, unknown>,
      } as RawProduct,
      makeCtx(),
    );
    expect(out.channel).toBe("mercadolibre");
    expect(out.name).toBeTruthy();
  });
});
