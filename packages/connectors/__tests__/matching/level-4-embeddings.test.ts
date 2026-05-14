/**
 * Unit tests for cascade level 4 (Plan 2.2.3).
 *
 * Coverage:
 *   1. With a mocked embeddings client returning a deterministic vector
 *      and a stubbed Supabase that simulates `find_similar_products` +
 *      `master_products` lookup, `matchByEmbedding` returns
 *      `{ master_sku, score, candidate }`. Score is the cosine-similarity
 *      conversion of the stubbed distance.
 *   2. With `openai === undefined`, returns null without throwing.
 *   3. With distance > 1.5 (low confidence floor), returns null.
 *   4. With OPENAI_API_KEY empty, returns null without throwing.
 *
 * We do not stand up MSW for this file — the embeddings client is a
 * narrow duck-typed interface, so a plain vi.fn() is the lower-friction
 * way to drive the contract. (`service.test.ts` exercises the wider
 * batch path with the same shim.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { matchByEmbedding } from "../../src/matching/level-4-embeddings.js";

type StubSupabase = {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function makeSupabaseStub(opts: {
  rpcRows: Array<{ master_sku: string; distance: number }> | null;
  rpcError?: unknown;
  canonRow: { master_sku: string; nombre_canonico: string } | null;
}): StubSupabase {
  const maybeSingle = vi.fn(async () => ({
    data: opts.canonRow,
    error: null,
  }));
  const limit = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({
    data: opts.rpcRows,
    error: opts.rpcError ?? null,
  }));
  return { rpc, from } as StubSupabase;
}

function makeEmbeddingsClient(vec: number[]) {
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

describe("matchByEmbedding — happy path", () => {
  it("returns master_sku + similarity score from the top RPC hit", async () => {
    const supabase = makeSupabaseStub({
      rpcRows: [
        { master_sku: "11111111-1111-1111-1111-111111111111", distance: 0.1 },
        { master_sku: "22222222-2222-2222-2222-222222222222", distance: 0.5 },
      ],
      canonRow: {
        master_sku: "11111111-1111-1111-1111-111111111111",
        nombre_canonico: "Aceite Oliva 1L",
      },
    });
    const openai = makeEmbeddingsClient(new Array(1536).fill(0.01));

    const result = await matchByEmbedding(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase as any,
      openai,
      "aceite oliva",
    );

    expect(result).not.toBeNull();
    expect(result!.master_sku).toBe("11111111-1111-1111-1111-111111111111");
    // distance 0.1 → similarity 1 - 0.1/2 = 0.95
    expect(result!.score).toBeCloseTo(0.95, 4);
    expect(result!.candidate.nombre_canonico).toBe("Aceite Oliva 1L");
    expect(openai.embeddings.create).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith(
      "find_similar_products",
      expect.objectContaining({ k: 5 }),
    );
  });

  it("truncates inputs longer than 512 chars before calling the SDK", async () => {
    const supabase = makeSupabaseStub({
      rpcRows: [
        { master_sku: "11111111-1111-1111-1111-111111111111", distance: 0.2 },
      ],
      canonRow: {
        master_sku: "11111111-1111-1111-1111-111111111111",
        nombre_canonico: "Producto",
      },
    });
    const openai = makeEmbeddingsClient(new Array(1536).fill(0.01));

    const longName = "x".repeat(2000);
    await matchByEmbedding(supabase as unknown as never, openai, longName);

    const firstCall = openai.embeddings.create.mock.calls[0]![0] as {
      input: string;
    };
    expect(firstCall.input.length).toBeLessThanOrEqual(512);
  });
});

describe("matchByEmbedding — degraded modes (NEVER throws)", () => {
  it("returns null when openai is undefined", async () => {
    const supabase = makeSupabaseStub({
      rpcRows: [],
      canonRow: null,
    });
    const result = await matchByEmbedding(
      supabase as unknown as never,
      undefined,
      "anything",
    );
    expect(result).toBeNull();
  });

  it("returns null when OPENAI_API_KEY is empty", async () => {
    process.env.OPENAI_API_KEY = "";
    const supabase = makeSupabaseStub({
      rpcRows: [],
      canonRow: null,
    });
    const openai = makeEmbeddingsClient(new Array(1536).fill(0.01));
    const result = await matchByEmbedding(
      supabase as unknown as never,
      openai,
      "anything",
    );
    expect(result).toBeNull();
    expect(openai.embeddings.create).not.toHaveBeenCalled();
  });

  it("returns null when productName is empty / whitespace", async () => {
    const supabase = makeSupabaseStub({ rpcRows: [], canonRow: null });
    const openai = makeEmbeddingsClient(new Array(1536).fill(0.01));
    expect(
      await matchByEmbedding(supabase as unknown as never, openai, "   "),
    ).toBeNull();
    expect(openai.embeddings.create).not.toHaveBeenCalled();
  });

  it("returns null when top hit distance > 1.5 (low confidence floor)", async () => {
    const supabase = makeSupabaseStub({
      rpcRows: [
        { master_sku: "11111111-1111-1111-1111-111111111111", distance: 1.8 },
      ],
      canonRow: null,
    });
    const openai = makeEmbeddingsClient(new Array(1536).fill(0.01));
    const result = await matchByEmbedding(
      supabase as unknown as never,
      openai,
      "noise",
    );
    expect(result).toBeNull();
  });

  it("returns null (does not throw) when the embeddings SDK errors", async () => {
    const supabase = makeSupabaseStub({ rpcRows: [], canonRow: null });
    const openai = {
      embeddings: {
        create: vi.fn(async () => {
          throw new Error("network");
        }),
      },
    };
    // p-retry will exhaust 3 retries (factor: 2) then this MUST resolve null.
    const result = await matchByEmbedding(
      supabase as unknown as never,
      openai,
      "anything",
    );
    expect(result).toBeNull();
  }, 20000);

  it("returns null when the RPC returns no rows", async () => {
    const supabase = makeSupabaseStub({ rpcRows: [], canonRow: null });
    const openai = makeEmbeddingsClient(new Array(1536).fill(0.01));
    const result = await matchByEmbedding(
      supabase as unknown as never,
      openai,
      "no matches in db",
    );
    expect(result).toBeNull();
  });
});
