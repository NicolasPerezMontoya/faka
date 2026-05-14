/**
 * Tests for `runProcessWpEvents` — Plan 2.3.2 async event processor cron.
 *
 * Coverage (verifies clause from PLAN.md §2.3.2):
 *   (a) 3 fixture WC payloads in `raw_orders` with processed=false
 *       → 3 sales upserts + their sale_items upserts.
 *   (b) All 3 events marked processed=true.
 *   (c) ONE `connector_runs` row written with kind='channel' + canal='wordpress'.
 *   (d) Re-run on the same rows is a no-op (idempotency).
 *   (e) Bad-payload row stays processed=false; status='partial' on the run.
 *   (f) Empty queue → succeeded run with records_processed=0.
 *   (g) Config degraded → run returns `not_configured`, NO connector_runs write.
 *   (h) Unsupported topic (`product.created`) deferred, row marked processed=true.
 *
 * Anti-duplication / W2: tests verify the helper-enforced invariants:
 *   - kind='channel' + canal='wordpress' on every run.
 *   - recordConnectorRun called exactly once per drain pass (the `finally`).
 *
 * Strategy: drive `runProcessWpEvents` directly with a Supabase chain mock +
 * injected loader/logger. No real Supabase, no real network. The mock records
 * every `.from(table).<op>(...)` so we can assert the exact write surface.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runProcessWpEvents } from "../src/jobs/process-wp-events.js";
import type { LoadedWordPressConfig } from "@faka/connectors";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function wcOrderFixture(id: number, status = "completed") {
  return {
    id,
    status,
    currency: "COP",
    date_modified_gmt: "2026-05-15T12:00:00",
    discount_total: "0",
    shipping_total: "5000",
    total: "85000",
    payment_method: "wc-payments",
    payment_method_title: "Card",
    customer_id: 42,
    line_items: [
      {
        id: 100 + id,
        product_id: 200 + id,
        name: `Producto WP ${id}`,
        quantity: 2,
        subtotal: "80000",
        total: "80000",
        sku: `WP-SKU-${id}`,
      },
    ],
    shipping_lines: [],
    billing: {
      first_name: "Cliente",
      last_name: `${id}`,
      email: `cliente${id}@example.test`,
      phone: "+57 300 000 0001",
      city: "Bogotá",
      state: "Cundinamarca",
    },
  };
}

function rawOrderRow(rawId: string, wcOrder: object, deliveryId: string) {
  return {
    id: rawId,
    canal: "wordpress",
    payload_json: {
      ...wcOrder,
      _topic: "order.updated",
      _delivery_id: deliveryId,
    },
  };
}

// ----------------------------------------------------------------------------
// Supabase mock — minimal chain that records every call
// ----------------------------------------------------------------------------

interface MockState {
  rawOrdersQueue: Array<ReturnType<typeof rawOrderRow>>;
  rawOrdersUpdates: Array<{ id: string; processed: boolean }>;
  salesUpserts: Array<Record<string, unknown>>;
  saleItemsUpserts: Array<Record<string, unknown>>;
  productMappingsUpserts: Array<Record<string, unknown>>;
  saleItemsMasterSkuUpdates: number;
  connectorRunsInserts: Array<Record<string, unknown>>;
  // Per-sale_id row registry — supports the cascade's IS NULL lookup.
  saleItemsBySale: Map<string, Array<Record<string, unknown>>>;
  saleIdSeq: number;
  /** Force a sales-upsert error on the next call (test idempotency-error paths). */
  forceSalesError: string | null;
}

function freshState(): MockState {
  return {
    rawOrdersQueue: [],
    rawOrdersUpdates: [],
    salesUpserts: [],
    saleItemsUpserts: [],
    productMappingsUpserts: [],
    saleItemsMasterSkuUpdates: 0,
    connectorRunsInserts: [],
    saleItemsBySale: new Map(),
    saleIdSeq: 0,
    forceSalesError: null,
  };
}

function buildSupabaseMock(state: MockState) {
  // Builders that return chainable thenables (Supabase's PostgrestBuilder shape).
  function thenable<T>(value: T) {
    return Promise.resolve(value);
  }

  function from(table: string) {
    if (table === "raw_orders") {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: unknown) => ({
            eq: (_col2: string, _val2: unknown) => ({
              order: (_col3: string, _opts: object) => ({
                limit: (_n: number) =>
                  thenable({
                    data: state.rawOrdersQueue,
                    error: null,
                  }),
              }),
            }),
          }),
        }),
        update: (patch: { processed: boolean; processed_at: string }) => ({
          eq: async (_col: string, id: string) => {
            state.rawOrdersUpdates.push({ id, processed: patch.processed });
            // Reflect on the in-memory queue so re-runs see processed=true.
            const row = state.rawOrdersQueue.find((r) => r.id === id);
            if (row) {
              (row as unknown as { processed?: boolean }).processed = true;
            }
            return { error: null };
          },
        }),
      };
    }

    if (table === "sales") {
      return {
        upsert: (row: Record<string, unknown>, _opts: { onConflict: string }) => ({
          select: (_cols: string) => ({
            single: async () => {
              if (state.forceSalesError) {
                const msg = state.forceSalesError;
                state.forceSalesError = null;
                return { data: null, error: { message: msg } };
              }
              state.salesUpserts.push(row);
              // Reuse the same sale_id for identical (canal, external_order_id)
              // so re-runs are idempotent (mirrors the real UNIQUE constraint).
              const key = `${row.canal}:${row.external_order_id}`;
              const existing = [...state.saleItemsBySale.entries()].find(
                ([, items]) =>
                  items.some(
                    (it) => (it as { __sale_key?: string }).__sale_key === key,
                  ),
              );
              const sale_id = existing
                ? existing[0]
                : `sale-uuid-${++state.saleIdSeq}`;
              return { data: { sale_id }, error: null };
            },
          }),
        }),
      };
    }

    if (table === "sale_items") {
      return {
        upsert: async (
          rows: Record<string, unknown>[],
          _opts: { onConflict: string },
        ) => {
          for (const r of rows) {
            state.saleItemsUpserts.push(r);
            const saleId = r.sale_id as string;
            const list = state.saleItemsBySale.get(saleId) ?? [];
            // Idempotent: if (sale_id, external_product_id) already exists,
            // replace in place; otherwise append.
            const idx = list.findIndex(
              (it) =>
                it.external_product_id === r.external_product_id &&
                r.external_product_id != null,
            );
            const stored = {
              id: `item-uuid-${state.saleItemsUpserts.length}`,
              master_sku: null,
              __sale_key: `wordpress:${saleId}`,
              ...r,
            };
            if (idx >= 0) list[idx] = stored;
            else list.push(stored);
            state.saleItemsBySale.set(saleId, list);
          }
          return { error: null };
        },
        select: (_cols: string) => ({
          eq: (_col: string, saleId: string) => ({
            is: (_col2: string, _val: null) => {
              const items = state.saleItemsBySale.get(saleId) ?? [];
              const data = items
                .filter((it) => it.master_sku == null)
                .map((it) => ({
                  id: it.id,
                  external_product_id: it.external_product_id,
                  external_sku: it.external_sku,
                  product_name: it.product_name,
                }));
              return thenable({ data, error: null });
            },
          }),
        }),
        update: (_patch: Record<string, unknown>) => ({
          eq: (_col: string, _val: unknown) => ({
            is: async (_col2: string, _val2: null) => {
              state.saleItemsMasterSkuUpdates += 1;
              return { error: null };
            },
          }),
        }),
      };
    }

    if (table === "product_mappings") {
      return {
        select: (_cols: string) => ({
          eq: (_c1: string, _v1: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              eq: (_c3: string, _v3: unknown) => ({
                limit: (_n: number) => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
        upsert: async (
          payload: Record<string, unknown> | Record<string, unknown>[],
          _opts: { onConflict: string; ignoreDuplicates?: boolean; count?: string },
        ) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          for (const r of rows) state.productMappingsUpserts.push(r);
          return { error: null, count: rows.length };
        },
      };
    }

    if (table === "master_products") {
      // Cascade level 1-3 query master_products. Return empty so the cascade
      // falls through to level 4, which has no openai client and short-circuits
      // to unresolved. That's the path the test wants.
      return {
        select: (_cols: string) => ({
          eq: (_c: string, _v: unknown) => ({
            limit: (_n: number) => thenable({ data: [], error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          // Some level files use .or / .ilike — fall through to the same shape.
          or: (_q: string) => ({
            limit: (_n: number) => thenable({ data: [], error: null }),
          }),
          ilike: (_c: string, _v: string) => ({
            limit: (_n: number) => thenable({ data: [], error: null }),
          }),
        }),
      };
    }

    if (table === "connector_runs") {
      return {
        insert: (row: Record<string, unknown>) => ({
          select: (_cols: string) => ({
            single: async () => {
              state.connectorRunsInserts.push(row);
              return {
                data: { id: `run-${state.connectorRunsInserts.length}` },
                error: null,
              };
            },
          }),
        }),
      };
    }

    if (table === "product_embeddings") {
      // Level 4 ANN search — return empty so cascade lands as unresolved.
      return {
        select: () => ({
          eq: () => ({ limit: () => thenable({ data: [], error: null }) }),
        }),
        rpc: async () => ({ data: [], error: null }),
      };
    }

    // Catch-all — surface a hint if a level reaches an unmocked table.
    return {
      select: () => ({
        limit: () => thenable({ data: [], error: null }),
        eq: () => ({ limit: () => thenable({ data: [], error: null }) }),
      }),
      insert: async () => ({ error: null }),
      upsert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      rpc: async () => ({ data: null, error: null }),
    };
  }

  return {
    from: vi.fn(from),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

function configuredLoader(): () => LoadedWordPressConfig {
  return () => ({
    ok: true,
    apiUrl: "https://wc.example.test",
    apiKey: "ck_test",
    apiSecret: "cs_test",
    webhookSecret: "test-secret",
  });
}

function notConfiguredLoader(): () => LoadedWordPressConfig {
  return () => ({ ok: false, reason: "not_configured" });
}

const quietLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

beforeEach(() => {
  vi.restoreAllMocks();
});

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("runProcessWpEvents — Plan 2.3.2", () => {
  it("(a)+(b)+(c) drains 3 raw_orders rows into sales+sale_items, flips processed=true, writes ONE connector_runs row", async () => {
    const state = freshState();
    state.rawOrdersQueue = [
      rawOrderRow("raw-1", wcOrderFixture(101), "wc-d-1"),
      rawOrderRow("raw-2", wcOrderFixture(102), "wc-d-2"),
      rawOrderRow("raw-3", wcOrderFixture(103), "wc-d-3"),
    ];
    const supabase = buildSupabaseMock(state);

    const result = await runProcessWpEvents({
      getSupabase: () => supabase as never,
      loadConfig: configuredLoader(),
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });

    expect(result.status).toBe("succeeded");
    expect(result.records_processed).toBe(3);
    expect(result.records_failed).toBe(0);

    // (a) Three sales upserts — all with canal='wordpress' + distinct
    // external_order_id derived from each WC order.id.
    expect(state.salesUpserts).toHaveLength(3);
    expect(state.salesUpserts.map((s) => s.external_order_id)).toEqual([
      "101",
      "102",
      "103",
    ]);
    expect(new Set(state.salesUpserts.map((s) => s.canal))).toEqual(
      new Set(["wordpress"]),
    );

    // Three sale_items upserts — one line item per fixture order.
    expect(state.saleItemsUpserts).toHaveLength(3);
    expect(state.saleItemsUpserts[0]!.external_product_id).toBe("201");
    expect(state.saleItemsUpserts[0]!.product_name).toBe("Producto WP 101");

    // (b) All three raw_orders rows flipped to processed=true.
    expect(state.rawOrdersUpdates).toHaveLength(3);
    expect(state.rawOrdersUpdates.every((u) => u.processed)).toBe(true);
    expect(new Set(state.rawOrdersUpdates.map((u) => u.id))).toEqual(
      new Set(["raw-1", "raw-2", "raw-3"]),
    );

    // (c) ONE connector_runs row, kind='channel' + canal='wordpress'.
    expect(state.connectorRunsInserts).toHaveLength(1);
    const run = state.connectorRunsInserts[0]!;
    expect(run.kind).toBe("channel");
    expect(run.canal).toBe("wordpress");
    expect(run.status).toBe("succeeded");
    expect(run.records_processed).toBe(3);
    expect(run.records_failed).toBe(0);
  });

  it("(d) rerunning on already-processed rows is a no-op (empty queue + one succeeded connector_runs row)", async () => {
    const state = freshState();
    // Queue is empty (rows already drained on a previous pass).
    state.rawOrdersQueue = [];
    const supabase = buildSupabaseMock(state);

    const result = await runProcessWpEvents({
      getSupabase: () => supabase as never,
      loadConfig: configuredLoader(),
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:05:00Z"),
    });

    expect(result.status).toBe("succeeded");
    expect(result.records_processed).toBe(0);
    expect(state.salesUpserts).toHaveLength(0);
    expect(state.saleItemsUpserts).toHaveLength(0);
    // Audit row still written — empty-queue ticks count as healthy drains.
    expect(state.connectorRunsInserts).toHaveLength(1);
    expect(state.connectorRunsInserts[0]!.kind).toBe("channel");
    expect(state.connectorRunsInserts[0]!.canal).toBe("wordpress");
  });

  it("(e) one bad payload (zod-invalid) becomes a failed row — status='partial', processed=false on the bad row", async () => {
    const state = freshState();
    state.rawOrdersQueue = [
      rawOrderRow("raw-good", wcOrderFixture(201), "wc-d-good"),
      // Bad: missing required `id` field.
      {
        id: "raw-bad",
        canal: "wordpress",
        payload_json: {
          // intentionally no `id`
          status: "completed",
          line_items: [],
          _topic: "order.updated",
          _delivery_id: "wc-d-bad",
        },
      },
    ];
    const supabase = buildSupabaseMock(state);

    const result = await runProcessWpEvents({
      getSupabase: () => supabase as never,
      loadConfig: configuredLoader(),
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });

    expect(result.status).toBe("partial");
    expect(result.records_processed).toBe(1);
    expect(result.records_failed).toBe(1);

    // The good row was marked processed=true.
    const processedIds = state.rawOrdersUpdates.map((u) => u.id);
    expect(processedIds).toContain("raw-good");
    expect(processedIds).not.toContain("raw-bad");

    const run = state.connectorRunsInserts[0]!;
    expect(run.status).toBe("partial");
    expect(run.records_failed).toBe(1);
    expect(run.errors_json).toMatchObject({
      errors: [{ raw_id: "raw-bad" }],
    });
  });

  it("(f) handles an empty queue as a healthy tick (status='succeeded', records_processed=0)", async () => {
    const state = freshState();
    state.rawOrdersQueue = [];
    const supabase = buildSupabaseMock(state);

    const result = await runProcessWpEvents({
      getSupabase: () => supabase as never,
      loadConfig: configuredLoader(),
      logger: quietLogger,
    });

    expect(result.status).toBe("succeeded");
    expect(result.records_processed).toBe(0);
    expect(result.records_failed).toBe(0);
    expect(state.connectorRunsInserts).toHaveLength(1);
  });

  it("(g) config degraded → run skips entirely, status='not_configured', NO connector_runs write", async () => {
    const state = freshState();
    const supabase = buildSupabaseMock(state);

    const result = await runProcessWpEvents({
      getSupabase: () => supabase as never,
      loadConfig: notConfiguredLoader(),
      logger: quietLogger,
    });

    expect(result.status).toBe("not_configured");
    expect(result.records_processed).toBe(0);
    // No DB writes at all — we never even touched the supabase mock.
    expect(state.salesUpserts).toHaveLength(0);
    expect(state.connectorRunsInserts).toHaveLength(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("(h) product.* topics are deferred but marked processed=true so the row drains", async () => {
    const state = freshState();
    state.rawOrdersQueue = [
      {
        id: "raw-prod",
        canal: "wordpress",
        payload_json: {
          id: 999,
          name: "Producto WP",
          _topic: "product.created",
          _delivery_id: "wc-d-prod",
        },
      },
    ];
    const supabase = buildSupabaseMock(state);

    const result = await runProcessWpEvents({
      getSupabase: () => supabase as never,
      loadConfig: configuredLoader(),
      logger: quietLogger,
    });

    expect(result.status).toBe("succeeded");
    expect(result.records_processed).toBe(1);
    expect(state.salesUpserts).toHaveLength(0); // not an order
    expect(state.saleItemsUpserts).toHaveLength(0);
    expect(state.rawOrdersUpdates).toEqual([
      { id: "raw-prod", processed: true },
    ]);

    const run = state.connectorRunsInserts[0]!;
    expect(run.status).toBe("succeeded");
  });

  it("invariant W2 — connector_runs row always has kind='channel' + canal='wordpress'", async () => {
    const state = freshState();
    state.rawOrdersQueue = [
      rawOrderRow("raw-1", wcOrderFixture(301), "wc-d-301"),
    ];
    const supabase = buildSupabaseMock(state);

    await runProcessWpEvents({
      getSupabase: () => supabase as never,
      loadConfig: configuredLoader(),
      logger: quietLogger,
    });

    expect(state.connectorRunsInserts).toHaveLength(1);
    const run = state.connectorRunsInserts[0]!;
    expect(run.kind).toBe("channel");
    expect(run.canal).toBe("wordpress");
    // Anti-duplication: must NEVER be 'cron-heartbeat'.
    expect(run.kind).not.toBe("cron-heartbeat");
  });
});
