/**
 * Tests for `packages/connectors/src/mercadolibre/api-client.ts` (Plan 2.1.2.1).
 *
 * Coverage (PLAN.md §2.1.2.1 verifies clause):
 *
 *   1. getOrders pagination via `from_id` — two pages stitch correctly.
 *   2. getItems uses `search_type=scan` + `scroll_id`.
 *   3. getItemDetail batches `/items?ids=…` (20 ids/batch) and
 *      drops `catalog_product_id != null` entries to DLQ.
 *   4. 401 → forced refresh → retry once → success.
 *   5. 429 honors `Retry-After` and retries.
 *   6. Currency-drift orders (`currency_id !== "COP"`) are DLQ'd + skipped.
 *   7. `site_id=MCO` is present on every search URL.
 *   8. `include_attributes=all` is present on every items multi-get URL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from "undici";
import {
  createMLApiClient,
  MLUnauthorizedError,
} from "../../src/mercadolibre/api-client.js";
import type { MLConfig } from "../../src/mercadolibre/types.js";

// -----------------------------------------------------------------------------
// undici MockAgent setup
// -----------------------------------------------------------------------------

let originalDispatcher: Dispatcher;
let mockAgent: MockAgent;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  await mockAgent.close();
  setGlobalDispatcher(originalDispatcher);
  vi.restoreAllMocks();
});

function pool() {
  return mockAgent.get("https://api.mercadolibre.com");
}

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

const CFG: MLConfig = {
  clientId: "TEST_CLIENT_ID",
  clientSecret: "TEST_CLIENT_SECRET",
  redirectUri: "https://orchestrator.test/oauth/mercadolibre/callback",
  webhookSecret: "TEST_WEBHOOK_SECRET",
};

function makeSupabaseMock(
  init: {
    initialAccessToken?: string;
    rotatedAccessToken?: string;
    refreshTokenValue?: string;
  } = {},
) {
  const state = {
    upsertCalls: [] as Array<Record<string, unknown>>,
    dlqInserts: [] as Array<Record<string, unknown>>,
    rpcCalls: [] as Array<{ fn: string; args: unknown }>,
    tokenRow: {
      canal: "mercadolibre" as const,
      user_id: "USR_TEST",
      access_token: init.initialAccessToken ?? "INITIAL_ACCESS",
      refresh_token: init.refreshTokenValue ?? "INITIAL_REFRESH",
      // Comfortable headroom — no proactive refresh triggers.
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      scope: null as string | null,
    } as null | {
      canal: "mercadolibre";
      user_id: string;
      access_token: string;
      refresh_token: string;
      expires_at: string;
      scope: string | null;
    },
  };

  const supabase = {
    from(table: string) {
      if (table === "oauth_tokens") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: state.tokenRow,
                  error: null,
                }),
              }),
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            state.upsertCalls.push(row);
            state.tokenRow = {
              canal: "mercadolibre",
              user_id: row.user_id as string,
              access_token: row.access_token as string,
              refresh_token: row.refresh_token as string,
              expires_at: row.expires_at as string,
              scope: (row.scope as string | null) ?? null,
            };
            return { error: null };
          },
        };
      }
      if (table === "dead_letter_queue") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.dlqInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      if (fn === "try_acquire_advisory_lock") {
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unexpected_rpc_${fn}` } };
    },
  };

  return { supabase, state };
}

function makeClient(overrides: Partial<Parameters<typeof createMLApiClient>[0]> = {}) {
  const { supabase, state } = makeSupabaseMock();
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
  };
  const client = createMLApiClient({
    config: CFG,
    supabase: (overrides.supabase ?? supabase) as never,
    userId: "USR_TEST",
    logger,
    ...overrides,
  });
  return { client, supabase, state, logger };
}

// -----------------------------------------------------------------------------
// (1) getOrders — from_id pagination
// -----------------------------------------------------------------------------

describe("getOrders — from_id pagination + site_id=MCO + currency guard", () => {
  it("stitches two pages of orders via from_id", async () => {
    // First page — 51 orders (page-full) with last_id=999.
    pool()
      .intercept({
        path: (p) =>
          p.startsWith("/orders/search?") &&
          p.includes("seller=USR_TEST") &&
          p.includes("site_id=MCO") &&
          !p.includes("from_id="),
        method: "GET",
      })
      .reply(200, {
        results: Array.from({ length: 51 }, (_, i) => ({
          id: 1000 + i,
          currency_id: "COP",
          total_amount: 50000,
          status: "paid",
          date_created: "2026-05-15T10:00:00.000-05:00",
          buyer: { id: 1 },
          order_items: [],
        })),
        paging: { total: 60, limit: 51, last_id: 999 },
      });
    // Second page — 9 orders (incomplete), terminates pagination.
    pool()
      .intercept({
        path: (p) =>
          p.startsWith("/orders/search?") && p.includes("from_id=999"),
        method: "GET",
      })
      .reply(200, {
        results: Array.from({ length: 9 }, (_, i) => ({
          id: 2000 + i,
          currency_id: "COP",
          total_amount: 60000,
          status: "paid",
          date_created: "2026-05-15T11:00:00.000-05:00",
          buyer: { id: 2 },
          order_items: [],
        })),
        paging: { total: 60, limit: 51, last_id: 0 },
      });

    const { client } = makeClient();
    const orders = await client.getOrders({
      sellerId: "USR_TEST",
      dateFrom: "2026-05-15T00:00:00.000-05:00",
    });
    expect(orders).toHaveLength(60);
    expect(orders[0]!.id).toBe(1000);
    expect(orders[51]!.id).toBe(2000);
  });

  it("DLQ's currency-drift orders (currency_id !== 'COP') and skips them", async () => {
    pool()
      .intercept({
        path: (p) => p.startsWith("/orders/search?"),
        method: "GET",
      })
      .reply(200, {
        results: [
          {
            id: 3001,
            currency_id: "USD", // drift — must DLQ.
            total_amount: 100,
            status: "paid",
            date_created: "2026-05-15T10:00:00.000-05:00",
            buyer: { id: 1 },
            order_items: [],
          },
          {
            id: 3002,
            currency_id: "COP",
            total_amount: 50000,
            status: "paid",
            date_created: "2026-05-15T10:00:00.000-05:00",
            buyer: { id: 2 },
            order_items: [],
          },
        ],
        paging: { total: 2, last_id: 0 },
      });

    const { client, state } = makeClient();
    const orders = await client.getOrders({
      sellerId: "USR_TEST",
      dateFrom: "2026-05-15T00:00:00.000-05:00",
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.id).toBe(3002);
    // DLQ row for the USD order.
    const driftDLQ = state.dlqInserts.find(
      (r) => r.source === "orders.fetch.currency_drift",
    );
    expect(driftDLQ).toBeTruthy();
    expect(
      (driftDLQ!.payload_json as Record<string, unknown>).order_id,
    ).toBe(3001);
  });

  it("pins site_id=MCO on every search URL (no env override)", async () => {
    let observed: string | undefined;
    pool()
      .intercept({
        path: (p) => p.startsWith("/orders/search?"),
        method: "GET",
      })
      .reply((opts) => {
        observed = String(opts.path);
        return {
          statusCode: 200,
          data: { results: [], paging: { last_id: 0 } },
        };
      });

    const { client } = makeClient();
    await client.getOrders({
      sellerId: "USR_TEST",
      dateFrom: "2026-05-15T00:00:00.000-05:00",
    });
    expect(observed).toBeDefined();
    expect(observed).toMatch(/site_id=MCO/);
  });
});

// -----------------------------------------------------------------------------
// (2) getItems — scroll_id pagination
// -----------------------------------------------------------------------------

describe("getItems — search_type=scan + scroll_id", () => {
  it("issues search_type=scan and returns scroll_id for the next page", async () => {
    let observedPath = "";
    pool()
      .intercept({
        path: (p) => p.startsWith("/users/USR_TEST/items/search"),
        method: "GET",
      })
      .reply((opts) => {
        observedPath = String(opts.path);
        return {
          statusCode: 200,
          data: {
            results: ["MCO111", "MCO222", "MCO333"],
            scroll_id: "SCROLL_NEXT",
            paging: { total: 1500, limit: 50 },
          },
        };
      });

    const { client } = makeClient();
    const page = await client.getItems({ sellerId: "USR_TEST" });
    expect(observedPath).toMatch(/search_type=scan/);
    expect(page.items).toEqual(["MCO111", "MCO222", "MCO333"]);
    expect(page.scroll_id).toBe("SCROLL_NEXT");
  });

  it("returns scroll_id=null when results are empty (end of scroll)", async () => {
    pool()
      .intercept({
        path: (p) => p.startsWith("/users/USR_TEST/items/search"),
        method: "GET",
      })
      .reply(200, {
        results: [],
        scroll_id: "TAIL",
        paging: { total: 1500, limit: 50 },
      });

    const { client } = makeClient();
    const page = await client.getItems({
      sellerId: "USR_TEST",
      scrollId: "PRIOR_SCROLL",
    });
    expect(page.items).toEqual([]);
    expect(page.scroll_id).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// (3) getItemDetail — batched + catalog_product_id DLQ + include_attributes=all
// -----------------------------------------------------------------------------

describe("getItemDetail — 20-id batches + catalog_product DLQ + include_attributes=all", () => {
  it("batches 25 ids into two requests (20 + 5) and merges results", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `MCO${i + 1}`);

    const observedPaths: string[] = [];
    // Two intercepts — one per batch.
    for (let batch = 0; batch < 2; batch++) {
      pool()
        .intercept({
          path: (p) => p.startsWith("/items?ids="),
          method: "GET",
        })
        .reply((opts) => {
          observedPaths.push(String(opts.path));
          const url = new URL(`http://x${opts.path}`);
          const batchIds = (url.searchParams.get("ids") ?? "").split(",");
          return {
            statusCode: 200,
            data: batchIds.map((id) => ({
              code: 200,
              body: {
                id,
                site_id: "MCO",
                title: `Title ${id}`,
                seller_id: 1,
                price: 1000,
                currency_id: "COP",
              },
            })),
          };
        });
    }

    const { client } = makeClient();
    const items = await client.getItemDetail(ids);
    expect(items).toHaveLength(25);
    expect(observedPaths).toHaveLength(2);
    // include_attributes=all on every request.
    for (const p of observedPaths) {
      expect(p).toMatch(/include_attributes=all/);
    }
    // First batch is exactly 20 ids.
    const firstBatchIds = new URL(`http://x${observedPaths[0]}`).searchParams
      .get("ids")!
      .split(",");
    expect(firstBatchIds).toHaveLength(20);
  });

  it("DLQ's catalog_product_id != null items and drops them from the result", async () => {
    pool()
      .intercept({
        path: (p) => p.startsWith("/items?ids="),
        method: "GET",
      })
      .reply(200, [
        {
          code: 200,
          body: {
            id: "MCO_CATALOG",
            site_id: "MCO",
            title: "Catalog-mode item",
            seller_id: 1,
            price: 1000,
            currency_id: "COP",
            catalog_product_id: "CAT_X_42",
          },
        },
        {
          code: 200,
          body: {
            id: "MCO_NORMAL",
            site_id: "MCO",
            title: "Normal item",
            seller_id: 1,
            price: 1000,
            currency_id: "COP",
          },
        },
      ]);

    const { client, state } = makeClient();
    const items = await client.getItemDetail(["MCO_CATALOG", "MCO_NORMAL"]);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("MCO_NORMAL");

    const catalogDLQ = state.dlqInserts.find(
      (r) => r.source === "items.catalog_product_not_supported",
    );
    expect(catalogDLQ).toBeTruthy();
    expect(
      (catalogDLQ!.payload_json as Record<string, unknown>).id,
    ).toBe("MCO_CATALOG");
  });
});

// -----------------------------------------------------------------------------
// (4) 401 → refresh → retry
// -----------------------------------------------------------------------------

describe("401 → refresh → retry", () => {
  it("first 401 triggers a refresh + retries once with the new token", async () => {
    // First request — return 401.
    pool()
      .intercept({
        path: (p) => p.startsWith("/orders/search?"),
        method: "GET",
        headers: { authorization: "Bearer INITIAL_ACCESS" },
      })
      .reply(401, { error: "invalid_token" });

    // OAuth refresh endpoint — returns rotated tokens.
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, {
        access_token: "REFRESHED_TOKEN",
        token_type: "bearer",
        expires_in: 21600,
        refresh_token: "NEW_REFRESH",
        user_id: 123,
        scope: "offline_access read write",
      });

    // Retry — returns 200 with the new bearer.
    pool()
      .intercept({
        path: (p) => p.startsWith("/orders/search?"),
        method: "GET",
        headers: { authorization: "Bearer REFRESHED_TOKEN" },
      })
      .reply(200, {
        results: [],
        paging: { total: 0, last_id: 0 },
      });

    const { client, state } = makeClient();
    const orders = await client.getOrders({
      sellerId: "USR_TEST",
      dateFrom: "2026-05-15T00:00:00.000-05:00",
    });
    expect(orders).toEqual([]);
    // The rotation UPSERTed the new refresh token.
    expect(state.upsertCalls).toHaveLength(1);
    expect(state.upsertCalls[0]!.access_token).toBe("REFRESHED_TOKEN");
  });

  it("MLUnauthorizedError is exported and is the throwable for 401 paths", () => {
    const err = new MLUnauthorizedError();
    expect(err.name).toBe("MLUnauthorizedError");
    expect(err.message).toMatch(/ml_unauthorized/);
  });
});

// -----------------------------------------------------------------------------
// (5) 429 → Retry-After
// -----------------------------------------------------------------------------

describe("429 honors Retry-After", () => {
  it("429 with Retry-After=1 retries after ~1s and succeeds", async () => {
    pool()
      .intercept({
        path: (p) => p.startsWith("/orders/search?"),
        method: "GET",
      })
      .reply(429, "rate_limited", {
        headers: { "retry-after": "1" },
      });
    pool()
      .intercept({
        path: (p) => p.startsWith("/orders/search?"),
        method: "GET",
      })
      .reply(200, { results: [], paging: { last_id: 0 } });

    const { client } = makeClient();
    const before = Date.now();
    const orders = await client.getOrders({
      sellerId: "USR_TEST",
      dateFrom: "2026-05-15T00:00:00.000-05:00",
    });
    const elapsed = Date.now() - before;
    expect(orders).toEqual([]);
    // We slept ≥1s for the Retry-After.
    expect(elapsed).toBeGreaterThanOrEqual(900);
  }, 15_000);
});
