/**
 * Tests for the daily re-embed cron (Plan 2.3.4).
 *
 * Coverage:
 *   (a) degraded — no OPENAI_API_KEY → connector_runs row with
 *       errors_json.reason='no_embedding_provider', exit summary
 *       status='skipped'.
 *   (b) happy path — 3 master_products rows, fake EmbeddingsClient returns
 *       a vector each call → upserts into product_embeddings,
 *       connector_runs row status='succeeded', records_processed=3,
 *       embed_count=3 in metadata_json.
 *   (c) idempotency — when product_embeddings already has matching
 *       source_hash rows, the service short-circuits and the cron's
 *       summary reports skipped > 0 with no extra API calls.
 *
 * Strategy: pass a Supabase mock + an EmbeddingsClient mock into
 * `runReembedJob`. Both the embedding service (Plan 2.2.3) and the
 * `recordConnectorRun` writer (Plan 1.2.4) are real; the supabase
 * + openai surface is faked at the IO boundary.
 *
 * Anti-duplication: this test file uses the same duck-typed mock shape as
 * `packages/connectors/__tests__/matching/level-4-embeddings.test.ts` — do
 * not introduce a `MockEmbeddingsClient` class.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runReembedJob } from "../src/jobs/reembed-products.js";

interface MasterProductFixture {
  master_sku: string;
  nombre_canonico: string;
  brand: string | null;
  category: string | null;
}

interface EmbeddingFixture {
  master_sku: string;
  source_hash: string;
}

interface MockState {
  masterProducts: MasterProductFixture[];
  productEmbeddings: EmbeddingFixture[];
  connectorRuns: Array<Record<string, unknown>>;
  upserts: Array<Record<string, unknown>>;
}

function freshState(): MockState {
  return {
    masterProducts: [],
    productEmbeddings: [],
    connectorRuns: [],
    upserts: [],
  };
}

/**
 * Tiny chain mock for `supabase.from(...)` that handles the three queries
 * issued by the re-embed flow:
 *   - master_products: select master_sku list (cron entry-point) + select
 *     details (service).
 *   - product_embeddings: select existing hashes + upsert new rows.
 *   - connector_runs: insert.
 *
 * NOTE: we keep the mock dumb (no FK enforcement, no row dedupe) — the
 * service's source_hash short-circuit relies on the supabase response
 * shape, not on real PG semantics.
 */
function buildSupabaseMock(state: MockState) {
  const idsSelect = (limitN: number) => {
    const rows = state.masterProducts.slice(0, limitN).map((m) => ({
      master_sku: m.master_sku,
    }));
    return Promise.resolve({ data: rows, error: null });
  };

  const masterDetailsSelect = (ids: string[]) => {
    const rows = state.masterProducts.filter((m) =>
      ids.includes(m.master_sku),
    );
    return Promise.resolve({ data: rows, error: null });
  };

  const embeddingsExistingSelect = (ids: string[]) => {
    const rows = state.productEmbeddings.filter((e) =>
      ids.includes(e.master_sku),
    );
    return Promise.resolve({ data: rows, error: null });
  };

  const from = vi.fn((table: string) => {
    if (table === "master_products") {
      return {
        // entry-point: select("master_sku").order().limit() chain
        select: vi.fn((cols: string) => {
          if (cols === "master_sku") {
            return {
              order: vi.fn(() => ({
                limit: vi.fn((n: number) => idsSelect(n)),
              })),
            };
          }
          // service: select("master_sku, ...").in(...)
          return {
            in: vi.fn((_col: string, ids: string[]) =>
              masterDetailsSelect(ids),
            ),
          };
        }),
      };
    }
    if (table === "product_embeddings") {
      return {
        select: vi.fn(() => ({
          in: vi.fn((_col: string, ids: string[]) =>
            embeddingsExistingSelect(ids),
          ),
        })),
        upsert: vi.fn((row: Record<string, unknown>) => {
          state.upserts.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }
    if (table === "connector_runs") {
      return {
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

  return { from };
}

function makeEmbeddingsClient() {
  const vec = new Array(1536).fill(0.01);
  return {
    embeddings: {
      create: vi.fn(async () => ({ data: [{ embedding: vec }] })),
    },
  };
}

const ORIG_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
});

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIG_KEY;
  vi.restoreAllMocks();
});

describe("runReembedJob (Plan 2.3.4 — daily reembed cron)", () => {
  // ── (a) degraded mode — no provider ────────────────────────────────────
  it("records connector_runs.errors_json.reason='no_embedding_provider' when OPENAI key absent", async () => {
    delete process.env.OPENAI_API_KEY;
    const state = freshState();
    const supabase = buildSupabaseMock(state);

    const summary = await runReembedJob({
      supabase: supabase as never,
      // no openai provided — runReembedJob will skip the import path.
    });

    expect(summary.status).toBe("skipped");
    expect(summary.reason).toBe("no_embedding_provider");
    expect(state.connectorRuns).toHaveLength(1);
    const run = state.connectorRuns[0]!;
    expect(run.kind).toBe("channel");
    expect(run.canal).toBe("wordpress");
    expect(run.status).toBe("succeeded");
    expect(run.records_processed).toBe(0);
    expect(run.errors_json).toEqual({ reason: "no_embedding_provider" });
    expect(state.upserts).toHaveLength(0);
  });

  // ── (b) happy path — 3 fresh products → 3 API calls + 3 upserts ────────
  it("generates embeddings for new master_products and writes a succeeded connector_runs row", async () => {
    const state = freshState();
    state.masterProducts = [
      {
        master_sku: "p1",
        nombre_canonico: "Aceite Oliva 1L",
        brand: "Brand A",
        category: "Aceites",
      },
      {
        master_sku: "p2",
        nombre_canonico: "Arroz Diana 500g",
        brand: "Diana",
        category: "Granos",
      },
      {
        master_sku: "p3",
        nombre_canonico: "Café Sello Rojo",
        brand: "Sello Rojo",
        category: "Bebidas",
      },
    ];
    const supabase = buildSupabaseMock(state);
    const openai = makeEmbeddingsClient();

    const summary = await runReembedJob({
      supabase: supabase as never,
      openai,
      batchSize: 10,
    });

    expect(summary.status).toBe("succeeded");
    expect(summary.generated).toBe(3);
    expect(summary.skipped).toBe(0);
    expect(summary.records_failed).toBe(0);
    expect(openai.embeddings.create).toHaveBeenCalledTimes(3);
    expect(state.upserts).toHaveLength(3);
    for (const upsert of state.upserts) {
      expect(upsert).toMatchObject({
        embedding: expect.any(Array),
        source_text: expect.any(String),
        source_hash: expect.any(String),
        model: expect.any(String),
      });
    }

    expect(state.connectorRuns).toHaveLength(1);
    const run = state.connectorRuns[0]!;
    expect(run.kind).toBe("channel");
    expect(run.canal).toBe("wordpress");
    expect(run.status).toBe("succeeded");
    expect(run.records_processed).toBe(3);
    const meta = run.metadata_json as Record<string, unknown>;
    expect(meta.job).toBe("reembed-products");
    expect(meta.embed_count).toBe(3);
    expect(meta.skipped).toBe(0);
  });

  // ── (c) idempotency — source_hash short-circuit skips unchanged rows ──
  it("skips master_products whose source_hash already matches (no API call)", async () => {
    // sha256 of "Aceite Oliva 1L Brand A Aceites" computed inline.
    const state = freshState();
    state.masterProducts = [
      {
        master_sku: "p1",
        nombre_canonico: "Aceite Oliva 1L",
        brand: "Brand A",
        category: "Aceites",
      },
      {
        master_sku: "p2",
        nombre_canonico: "New Product",
        brand: null,
        category: null,
      },
    ];

    // Precompute the source_hash for p1 the same way the service does.
    const { createHash } = await import("node:crypto");
    const sourceText = "Aceite Oliva 1L Brand A Aceites";
    const existingHash = createHash("sha256")
      .update(sourceText)
      .digest("hex");
    state.productEmbeddings.push({ master_sku: "p1", source_hash: existingHash });

    const supabase = buildSupabaseMock(state);
    const openai = makeEmbeddingsClient();

    const summary = await runReembedJob({
      supabase: supabase as never,
      openai,
      batchSize: 10,
    });

    expect(summary.status).toBe("succeeded");
    expect(summary.generated).toBe(1); // only p2 generated
    expect(summary.skipped).toBe(1); // p1 short-circuited via source_hash
    expect(openai.embeddings.create).toHaveBeenCalledTimes(1);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]!.master_sku).toBe("p2");

    const run = state.connectorRuns[0]!;
    const meta = run.metadata_json as Record<string, unknown>;
    expect(meta.embed_count).toBe(1);
    expect(meta.skipped).toBe(1);
  });
});
