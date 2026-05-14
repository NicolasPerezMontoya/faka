/**
 * Tests for loadWordPressConfig (Plan 2.2.1) + the degraded-mode contract
 * on the public connector surface.
 *
 * Coverage:
 *   1. All four env vars present → ok:true config.
 *   2. Any missing/empty env var → { ok: false, reason: 'not_configured' }.
 *   3. createWordPressConnector({}).healthCheck() returns ok:false on
 *      degraded config — no throw, no crash.
 *   4. createWordPressConnector({}).fetchOrders(since, ctx) returns [] on
 *      degraded config — no throw, no crash.
 */

import { describe, it, expect, vi } from "vitest";
import { loadWordPressConfig } from "../../src/wordpress/config.js";
import { createWordPressConnector } from "../../src/wordpress/index.js";

function makeCtx() {
  return {
    supabase: {} as never,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe("loadWordPressConfig", () => {
  it("returns ok:true when all four env vars are present", () => {
    const cfg = loadWordPressConfig({
      WORDPRESS_API_URL: "https://shop.example.co",
      WORDPRESS_API_KEY: "ck_x",
      WORDPRESS_API_SECRET: "cs_x",
      WORDPRESS_WEBHOOK_SECRET: "wh_x",
    } as NodeJS.ProcessEnv);
    expect(cfg.ok).toBe(true);
    if (cfg.ok) {
      expect(cfg.apiUrl).toBe("https://shop.example.co");
      expect(cfg.apiKey).toBe("ck_x");
    }
  });

  it("returns ok:false / not_configured when any env var is missing", () => {
    const cfg = loadWordPressConfig({
      WORDPRESS_API_URL: "https://shop.example.co",
      WORDPRESS_API_KEY: "ck_x",
      WORDPRESS_API_SECRET: "cs_x",
      // WORDPRESS_WEBHOOK_SECRET missing
    } as NodeJS.ProcessEnv);
    expect(cfg.ok).toBe(false);
    if (!cfg.ok) {
      expect(cfg.reason).toBe("not_configured");
    }
  });

  it("treats whitespace-only values as missing", () => {
    const cfg = loadWordPressConfig({
      WORDPRESS_API_URL: "   ",
      WORDPRESS_API_KEY: "ck_x",
      WORDPRESS_API_SECRET: "cs_x",
      WORDPRESS_WEBHOOK_SECRET: "wh_x",
    } as NodeJS.ProcessEnv);
    expect(cfg.ok).toBe(false);
  });
});

describe("createWordPressConnector — degraded mode surface", () => {
  it("healthCheck returns ok:false with last_error='not configured' on degraded config", async () => {
    const c = createWordPressConnector({
      loadConfig: () => ({ ok: false, reason: "not_configured" }),
    });
    const h = await c.healthCheck(makeCtx());
    expect(h.ok).toBe(false);
    expect(h.last_error).toBe("not configured");
  });

  it("fetchOrders returns [] (no throw) on degraded config", async () => {
    const c = createWordPressConnector({
      loadConfig: () => ({ ok: false, reason: "not_configured" }),
    });
    const orders = await c.fetchOrders(new Date(0), makeCtx());
    expect(orders).toEqual([]);
  });

  it("fetchProducts returns [] (no throw) on degraded config", async () => {
    const c = createWordPressConnector({
      loadConfig: () => ({ ok: false, reason: "not_configured" }),
    });
    const products = await c.fetchProducts(new Date(0), makeCtx());
    expect(products).toEqual([]);
  });

  it("normalizeOrder still works on degraded config (normalization is pure)", async () => {
    const c = createWordPressConnector({
      loadConfig: () => ({ ok: false, reason: "not_configured" }),
    });
    const raw = {
      canal: "wordpress" as const,
      payload_json: {
        id: 7,
        status: "completed",
        currency: "COP",
        date_modified_gmt: "2026-05-13T18:00:00",
        discount_total: "0",
        shipping_total: "0",
        total: "10000",
        line_items: [],
      },
    };
    const n = await c.normalizeOrder(raw, makeCtx());
    expect(n.channel).toBe("wordpress");
    expect(n.external_order_id).toBe("7");
    expect(n.total).toBe(10000);
  });
});
