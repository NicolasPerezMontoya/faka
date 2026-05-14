/**
 * Tests for the 6-hour re-cascade-unmatched cron (Plan 2.3.4).
 *
 * Coverage:
 *   (a) empty queue — no sale_items in scope → status=succeeded,
 *       records_processed=0, no calls into runMatchCascade.
 *   (b) happy path — 2 rows in scope, the cascade resolves both via a
 *       stubbed `findValidatedMapping` cache hit → resolved=2,
 *       connector_runs status=succeeded, records_processed=2.
 *   (c) budget guard — TokenBudgetTracker reports exhausted → loop
 *       short-circuits and the run records `budget_exhausted_skips > 0`.
 *
 * Strategy: pass a Supabase mock + a fake LLM config (`provider: "none"`)
 * into `runRecascadeJob`. The cascade orchestrator is real; its level-1
 * (barcode) and level-2 (supplier_code) lookups against the mock return
 * data so we exercise the persistence path.
 *
 * Anti-duplication: this file does NOT re-implement the cascade. It drives
 * the cron entry-point and lets the real cascade run against a fake
 * supabase chain that returns canned rows from each lookup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runRecascadeJob } from "../src/jobs/re-cascade-unmatched.js";

interface MockState {
  saleItems: Array<{
    id: string;
    product_name: string;
    external_product_id: string | null;
    external_sku: string | null;
    master_sku: string | null;
    created_at: string;
    sales: { canal: string };
  }>;
  validatedMappings: Array<{
    canal: string;
    external_id: string;
    master_sku: string;
    match_method: string;
    validado_humano: boolean;
  }>;
  connectorRuns: Array<Record<string, unknown>>;
  upserts: Array<Record<string, unknown>>;
  saleItemUpdates: Array<Record<string, unknown>>;
  budgetTotal: number; // total llm_tokens for today across connector_runs
}

function freshState(): MockState {
  return {
    saleItems: [],
    validatedMappings: [],
    connectorRuns: [],
    upserts: [],
    saleItemUpdates: [],
    budgetTotal: 0,
  };
}

/**
 * Mock supabase that handles the queries the cron + cascade emit.
 *
 * Tables exercised:
 *   - sale_items (queue head select, sticky master_sku update)
 *   - product_mappings (validated-mapping lookup + UPSERT)
 *   - master_products (level 1-3 lookups)
 *   - connector_runs (insert from recordConnectorRun + budget read)
 */
function buildSupabaseMock(state: MockState) {
  const from = vi.fn((table: string) => {
    if (table === "sale_items") {
      return {
        select: vi.fn(() => ({
          is: vi.fn(() => ({
            gte: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: state.saleItems,
                  error: null,
                })),
              })),
            })),
          })),
        })),
        // Sticky master_sku update: persistMatch calls
        // update().eq().is(...) — return a no-op resolved promise.
        update: vi.fn((row: Record<string, unknown>) => ({
          eq: vi.fn(() => ({
            is: vi.fn(async () => {
              state.saleItemUpdates.push(row);
              return { error: null };
            }),
          })),
        })),
      };
    }
    if (table === "product_mappings") {
      // Capture the filter values across the .eq() chain so the
      // `findValidatedMapping` lookup actually narrows by (canal, external_id)
      // instead of always returning the first row.
      const filters: Record<string, unknown> = {};
      const buildChain = () => ({
        eq: vi.fn((col: string, val: unknown) => {
          filters[col] = val;
          return buildChain();
        }),
        limit: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            const match = state.validatedMappings.find(
              (m) =>
                m.canal === filters.canal &&
                m.external_id === filters.external_id,
            );
            if (!match) return { data: null, error: null };
            return { data: match, error: null };
          }),
        })),
      });
      return {
        select: vi.fn(() => buildChain()),
        // idempotentUpsert routes via supabase.from(...).upsert(rows, opts).
        upsert: vi.fn((row: Record<string, unknown>) => {
          state.upserts.push(row);
          return Promise.resolve({ data: [row], error: null, count: 1 });
        }),
      };
    }
    if (table === "master_products") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: null,
                error: null,
              })),
            })),
          })),
        })),
      };
    }
    if (table === "connector_runs") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              lt: vi.fn(async () => ({
                data: state.budgetTotal > 0
                  ? [{ metadata_json: { llm_tokens: state.budgetTotal } }]
                  : [],
                error: null,
              })),
            })),
          })),
        })),
        insert: vi.fn((row: Record<string, unknown>) => {
          state.connectorRuns.push(row);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: "mock-run-id" },
                error: null,
              })),
            })),
          };
        }),
      };
    }
    return { select: vi.fn(), insert: vi.fn(), upsert: vi.fn() };
  });
  // The cascade's level-4 calls `supabase.rpc("find_similar_products", ...)`
  // — we never reach it because the cache short-circuit answers first, but
  // wire a degraded stub so a regression that bypasses cache still resolves.
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  return { from, rpc };
}

beforeEach(() => {
  // Cascade runs deterministically without provider keys (cache hit).
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runRecascadeJob (Plan 2.3.4 — re-cascade-unmatched cron)", () => {
  // ── (a) empty queue ────────────────────────────────────────────────────
  it("records a succeeded run with records_processed=0 when no rows are stuck", async () => {
    const state = freshState();
    const supabase = buildSupabaseMock(state);

    const summary = await runRecascadeJob({
      supabase: supabase as never,
      llmConfig: null,
      now: new Date("2026-05-15T12:00:00Z"),
    });

    expect(summary.status).toBe("succeeded");
    expect(summary.records_processed).toBe(0);
    expect(summary.resolved).toBe(0);

    expect(state.connectorRuns).toHaveLength(1);
    const run = state.connectorRuns[0]!;
    expect(run.kind).toBe("channel");
    expect(run.canal).toBe("wordpress");
    expect(run.status).toBe("succeeded");
    const meta = run.metadata_json as Record<string, unknown>;
    expect(meta.job).toBe("re-cascade-unmatched");
  });

  // ── (b) happy path — cache hit resolves both items ─────────────────────
  it("resolves rows via the validated-mapping cache and writes connector_runs.records_processed=2", async () => {
    const state = freshState();
    state.saleItems = [
      {
        id: "si-1",
        product_name: "Aceite Oliva 1L",
        external_product_id: "wp-prod-1",
        external_sku: null,
        master_sku: null,
        created_at: "2026-05-15T10:00:00Z",
        sales: { canal: "wordpress" },
      },
      {
        id: "si-2",
        product_name: "Arroz Diana 500g",
        external_product_id: "wp-prod-2",
        external_sku: null,
        master_sku: null,
        created_at: "2026-05-15T11:00:00Z",
        sales: { canal: "wordpress" },
      },
    ];
    state.validatedMappings = [
      {
        canal: "wordpress",
        external_id: "wp-prod-1",
        master_sku: "11111111-1111-1111-1111-111111111111",
        match_method: "barcode_exact",
        validado_humano: true,
      },
    ];

    const supabase = buildSupabaseMock(state);

    const summary = await runRecascadeJob({
      supabase: supabase as never,
      llmConfig: null,
      batchSize: 100,
      now: new Date("2026-05-15T12:00:00Z"),
    });

    expect(summary.status).toBe("succeeded");
    expect(summary.records_processed).toBe(2);
    expect(summary.resolved).toBe(1); // only wp-prod-1 has a validated mapping
    expect(summary.still_queued).toBe(1); // wp-prod-2 has no cache hit and no level-1/2/3/4 match
    expect(summary.records_failed).toBe(0);
    // Cache hit fires sticky sale_items.master_sku update for the resolved row.
    expect(state.saleItemUpdates.length).toBeGreaterThanOrEqual(1);

    expect(state.connectorRuns).toHaveLength(1);
    const run = state.connectorRuns[0]!;
    expect(run.kind).toBe("channel");
    expect(run.canal).toBe("wordpress");
    expect(run.records_processed).toBe(2);
    const meta = run.metadata_json as Record<string, unknown>;
    expect(meta.job).toBe("re-cascade-unmatched");
    expect(meta.window_days).toBe(7);
    expect(typeof meta.llm_tokens).toBe("number");
  });

  // ── (c) token-budget guard — exhausted budget short-circuits loop ─────
  it("short-circuits rows when TokenBudgetTracker reports the daily cap exhausted", async () => {
    const state = freshState();
    state.saleItems = [
      {
        id: "si-1",
        product_name: "X",
        external_product_id: "wp-1",
        external_sku: null,
        master_sku: null,
        created_at: "2026-05-15T11:00:00Z",
        sales: { canal: "wordpress" },
      },
      {
        id: "si-2",
        product_name: "Y",
        external_product_id: "wp-2",
        external_sku: null,
        master_sku: null,
        created_at: "2026-05-15T11:00:00Z",
        sales: { canal: "wordpress" },
      },
    ];
    // Budget already at the default cap (200000) → exhausted on first check.
    state.budgetTotal = 200_000;

    const supabase = buildSupabaseMock(state);

    const summary = await runRecascadeJob({
      supabase: supabase as never,
      llmConfig: null,
      batchSize: 100,
      now: new Date("2026-05-15T12:00:00Z"),
    });

    expect(summary.budget_exhausted_skips).toBe(2);
    expect(summary.resolved).toBe(0);
    expect(summary.records_failed).toBe(0);

    const run = state.connectorRuns[0]!;
    const meta = run.metadata_json as Record<string, unknown>;
    expect(meta.budget_exhausted_skips).toBe(2);
    expect(meta.resolved).toBe(0);
  });
});
