/**
 * Unit tests for the re-embedding service (Plan 2.2.3).
 *
 * Coverage:
 *   1. Idempotency: a product whose existing `source_hash` matches the
 *      newly computed hash is **skipped** (no embeddings.create call).
 *   2. Generation: a product without an existing hash row → exactly one
 *      embeddings.create call + one UPSERT.
 *   3. Partial-batch resilience: a single product failing does NOT throw
 *      and DOES NOT block the rest of the batch.
 *   4. Degraded mode (openai undefined): returns
 *      `{ generated: 0, skipped: 0, errors: [<missing-key>] }`.
 *   5. Degraded mode (OPENAI_API_KEY empty): same shape.
 *   6. Empty input list: returns zeros with no errors.
 *
 * Uses vi.fn() shims rather than MSW: the embeddings client and Supabase
 * client are both narrow duck-typed interfaces in our code.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { generateEmbeddingsForProducts } from "../../src/embeddings/service.js";

const ORIG_KEY = process.env.OPENAI_API_KEY;

function makeEmbeddingsClient() {
  return {
    embeddings: {
      create: vi.fn(async () => ({
        data: [{ embedding: new Array(1536).fill(0.001) }],
      })),
    },
  };
}

interface MasterRow {
  master_sku: string;
  nombre_canonico: string;
  brand: string | null;
  category: string | null;
}

interface EmbedRow {
  master_sku: string;
  source_hash: string;
}

/**
 * Stub Supabase that distinguishes table-targeted reads via the table
 * passed to `.from(name)`. We return canned rows for `master_products`
 * and `product_embeddings`, and record `.upsert()` calls.
 */
function makeSupabaseStub(opts: {
  masterRows: MasterRow[];
  embedRows: EmbedRow[];
  upsertImpl?: (row: unknown) => { error: Error | null };
}) {
  const upserts: unknown[] = [];
  const upsertImpl =
    opts.upsertImpl ?? (() => ({ error: null as Error | null }));

  const from = vi.fn((table: string) => {
    if (table === "master_products") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: opts.masterRows,
            error: null,
          })),
        })),
      };
    }
    if (table === "product_embeddings") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: opts.embedRows,
            error: null,
          })),
        })),
        upsert: vi.fn(async (row: unknown) => {
          upserts.push(row);
          return upsertImpl(row);
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { from, _upserts: upserts };
}

function expectedHash(row: MasterRow): string {
  const text = [row.nombre_canonico, row.brand ?? "", row.category ?? ""]
    .join(" ")
    .trim()
    .slice(0, 512);
  return createHash("sha256").update(text).digest("hex");
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
});

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIG_KEY;
  vi.restoreAllMocks();
});

describe("generateEmbeddingsForProducts — happy path", () => {
  it("generates an embedding when no existing row exists", async () => {
    const masterRows: MasterRow[] = [
      {
        master_sku: "11111111-1111-1111-1111-111111111111",
        nombre_canonico: "Aceite Oliva",
        brand: "Carbonell",
        category: "aceites",
      },
    ];
    const supabase = makeSupabaseStub({ masterRows, embedRows: [] });
    const openai = makeEmbeddingsClient();

    const result = await generateEmbeddingsForProducts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      openai,
      masterRows.map((r) => r.master_sku),
    );

    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(openai.embeddings.create).toHaveBeenCalledOnce();
    expect(supabase._upserts).toHaveLength(1);
  });

  it("skips a product when source_hash matches (idempotency)", async () => {
    const row: MasterRow = {
      master_sku: "11111111-1111-1111-1111-111111111111",
      nombre_canonico: "Aceite Oliva",
      brand: "Carbonell",
      category: "aceites",
    };
    const hash = expectedHash(row);
    const supabase = makeSupabaseStub({
      masterRows: [row],
      embedRows: [{ master_sku: row.master_sku, source_hash: hash }],
    });
    const openai = makeEmbeddingsClient();

    const result = await generateEmbeddingsForProducts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      openai,
      [row.master_sku],
    );

    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(0);
    expect(result.errors).toEqual([]);
    expect(openai.embeddings.create).not.toHaveBeenCalled();
    expect(supabase._upserts).toEqual([]);
  });

  it("running the same batch twice triggers only ONE embedding call total", async () => {
    const row: MasterRow = {
      master_sku: "11111111-1111-1111-1111-111111111111",
      nombre_canonico: "Aceite Oliva",
      brand: null,
      category: null,
    };

    // First run: empty embeddings table → generates.
    const stubRun1 = makeSupabaseStub({ masterRows: [row], embedRows: [] });
    const openai = makeEmbeddingsClient();
    const r1 = await generateEmbeddingsForProducts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stubRun1 as any,
      openai,
      [row.master_sku],
    );
    expect(r1.generated).toBe(1);

    // Second run: simulate the hash now exists.
    const hash = expectedHash(row);
    const stubRun2 = makeSupabaseStub({
      masterRows: [row],
      embedRows: [{ master_sku: row.master_sku, source_hash: hash }],
    });
    const r2 = await generateEmbeddingsForProducts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stubRun2 as any,
      openai,
      [row.master_sku],
    );
    expect(r2.skipped).toBe(1);
    expect(r2.generated).toBe(0);

    // Critical invariant: TOTAL embeddings.create calls across both runs = 1.
    expect(openai.embeddings.create).toHaveBeenCalledTimes(1);
  });

  it("accumulates per-product errors without throwing", async () => {
    const rows: MasterRow[] = [
      {
        master_sku: "11111111-1111-1111-1111-111111111111",
        nombre_canonico: "Producto 1",
        brand: null,
        category: null,
      },
      {
        master_sku: "22222222-2222-2222-2222-222222222222",
        nombre_canonico: "Producto 2",
        brand: null,
        category: null,
      },
    ];
    const supabase = makeSupabaseStub({
      masterRows: rows,
      embedRows: [],
      upsertImpl: (row) => {
        const r = row as { master_sku: string };
        if (r.master_sku === "22222222-2222-2222-2222-222222222222") {
          return { error: new Error("simulated upsert failure") };
        }
        return { error: null };
      },
    });
    const openai = makeEmbeddingsClient();

    const result = await generateEmbeddingsForProducts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      openai,
      rows.map((r) => r.master_sku),
      { concurrency: 2 },
    );

    expect(result.generated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/simulated upsert failure/);
  });
});

describe("generateEmbeddingsForProducts — degraded modes", () => {
  it("returns errors array when openai is undefined", async () => {
    const supabase = makeSupabaseStub({ masterRows: [], embedRows: [] });
    const result = await generateEmbeddingsForProducts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      undefined,
      ["11111111-1111-1111-1111-111111111111"],
    );
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/no_embedding_provider/);
  });

  it("returns errors array when OPENAI_API_KEY is empty", async () => {
    process.env.OPENAI_API_KEY = "";
    const supabase = makeSupabaseStub({ masterRows: [], embedRows: [] });
    const openai = makeEmbeddingsClient();
    const result = await generateEmbeddingsForProducts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      openai,
      ["11111111-1111-1111-1111-111111111111"],
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/no_embedding_provider/);
    expect(openai.embeddings.create).not.toHaveBeenCalled();
  });

  it("returns zeros on empty productIds list", async () => {
    const supabase = makeSupabaseStub({ masterRows: [], embedRows: [] });
    const openai = makeEmbeddingsClient();
    const result = await generateEmbeddingsForProducts(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      openai,
      [],
    );
    expect(result).toEqual({ generated: 0, skipped: 0, errors: [] });
    expect(openai.embeddings.create).not.toHaveBeenCalled();
  });
});
