/**
 * Unit tests for `runMatchCascade` — the Plan 2.2.5 orchestrator.
 *
 * Strategy: mock the individual level modules (level-1 … level-5) plus the
 * `findValidatedMapping` cache lookup so each test can drive the control
 * flow deterministically. The cascade is pure-orchestrator logic — the
 * level files have their own dedicated test suites — so mocking the levels
 * is the lower-friction way to assert the routing decisions.
 *
 * Coverage (table-driven by intent — one `it` per branch):
 *   1. Cache short-circuit (`findValidatedMapping` returns a row).
 *   2. Level 1 (barcode) hit.
 *   3. Level 2 (supplier_code) hit.
 *   4. Level 3 (normalized name) hit.
 *   5. Level 4 high-confidence (score >= embeddingsHigh).
 *   6. Level 4 mid-confidence + L5 accept → llm_arbiter_match.
 *   7. Level 4 mid-confidence + L5 reject → llm_arbiter_reject (master_sku null).
 *   8. All-fail → unresolved with score 0.
 *   9. Error envelope — any uncaught throw becomes unresolved.
 *
 * The `findValidatedMapping` cache-lookup test asserts the SHORT-CIRCUIT
 * happens BEFORE level 1, by verifying that the level-1 mock is never
 * called when the cache returns a hit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks — declared BEFORE importing the unit under test so vi.mock hoists
// them correctly. The cascade imports these level modules; we replace the
// implementations with vi.fn()s we can drive per-test.
const matchByBarcodeMock = vi.fn();
const matchBySupplierCodeMock = vi.fn();
const matchByNormalizedNameMock = vi.fn();
const matchByEmbeddingMock = vi.fn();
const arbitrateCandidateMock = vi.fn();

vi.mock("../../src/matching/level-1-barcode.js", () => ({
  matchByBarcode: matchByBarcodeMock,
}));
vi.mock("../../src/matching/level-2-supplier-code.js", () => ({
  matchBySupplierCode: matchBySupplierCodeMock,
}));
vi.mock("../../src/matching/level-3-normalized-name.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/matching/level-3-normalized-name.js")
  >("../../src/matching/level-3-normalized-name.js");
  return {
    ...actual, // keep `normalize` real — the cascade calls it inline
    matchByNormalizedName: matchByNormalizedNameMock,
  };
});
vi.mock("../../src/matching/level-4-embeddings.js", () => ({
  matchByEmbedding: matchByEmbeddingMock,
}));
vi.mock("../../src/matching/level-5-llm-arbiter.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/matching/level-5-llm-arbiter.js")
  >("../../src/matching/level-5-llm-arbiter.js");
  return {
    ...actual,
    arbitrateCandidate: arbitrateCandidateMock,
  };
});

// eslint-disable-next-line import/first
import { runMatchCascade } from "../../src/matching/cascade.js";
// eslint-disable-next-line import/first
import type {
  CascadeContext,
  SaleItemCandidate,
  Thresholds,
  MatchResult,
} from "../../src/matching/types.js";

// We DON'T mock `cascade.ts` itself, so `findValidatedMapping` is the real
// implementation. To drive the cache short-circuit deterministically we
// shape the Supabase stub's product_mappings query to return the value the
// test wants. (Mocking `findValidatedMapping` directly would mean mocking
// the module under test, which is awkward.)

interface SupabaseStubOptions {
  validatedMapping?: {
    master_sku: string;
    match_method: string;
    validado_humano: boolean;
  } | null;
}

function makeSupabaseStub(opts: SupabaseStubOptions = {}) {
  // `from("product_mappings").select(...).eq(...).eq(...).eq(...).limit(1).maybeSingle()`
  // is the only chain `findValidatedMapping` calls.
  const maybeSingle = vi.fn(async () => ({
    data: opts.validatedMapping ?? null,
    error: null,
  }));
  const limit = vi.fn(() => ({ maybeSingle }));
  const eqValidated = vi.fn(() => ({ limit }));
  const eqExternal = vi.fn(() => ({ eq: eqValidated }));
  const eqCanal = vi.fn(() => ({ eq: eqExternal }));
  const select = vi.fn(() => ({ eq: eqCanal }));
  const from = vi.fn((_table: string) => ({ select }));
  return { from } as unknown as CascadeContext["supabase"];
}

const thresholds: Thresholds = {
  embeddingsHigh: 0.92,
  embeddingsMid: 0.78,
  arbiterAccept: 0.8,
  queueCutoff: 0.78,
  llmDailyTokenCap: 200000,
};

function makeCtx(
  supabaseStubOpts: SupabaseStubOptions = {},
  overrides: Partial<CascadeContext> = {},
): CascadeContext {
  return {
    supabase: makeSupabaseStub(supabaseStubOpts),
    thresholds,
    openai: undefined,
    llmConfig: null,
    ...overrides,
  };
}

const baseItem: SaleItemCandidate = {
  canal: "wordpress",
  external_product_id: "wc-101",
  product_name: "Aceite Oliva 1L",
  barcode: "7701234567890",
  supplier_code: "OLI-001",
};

beforeEach(() => {
  matchByBarcodeMock.mockReset();
  matchBySupplierCodeMock.mockReset();
  matchByNormalizedNameMock.mockReset();
  matchByEmbeddingMock.mockReset();
  arbitrateCandidateMock.mockReset();
});

describe("runMatchCascade — Step 0: validated-mapping cache short-circuit", () => {
  it("returns cached mapping (source: 'cache') BEFORE consulting level 1", async () => {
    const ctx = makeCtx({
      validatedMapping: {
        master_sku: "abc-1",
        match_method: "barcode_exact",
        validado_humano: true,
      },
    });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "barcode_exact",
      score: 1.0,
      master_sku: "abc-1",
      source: "cache",
    });
    // Critical assertion: no level was consulted because the cache hit short-circuits.
    expect(matchByBarcodeMock).not.toHaveBeenCalled();
    expect(matchBySupplierCodeMock).not.toHaveBeenCalled();
    expect(matchByNormalizedNameMock).not.toHaveBeenCalled();
    expect(matchByEmbeddingMock).not.toHaveBeenCalled();
  });

  it("preserves the original match_method from the validated row (no synth enum)", async () => {
    const ctx = makeCtx({
      validatedMapping: {
        master_sku: "abc-2",
        match_method: "llm_arbiter_match",
        validado_humano: true,
      },
    });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result.method).toBe("llm_arbiter_match");
    expect(result.score).toBe(1.0);
    expect(result.source).toBe("cache");
  });
});

describe("runMatchCascade — Step 1: barcode (level 1)", () => {
  it("returns barcode_exact with score 1.0 on L1 hit", async () => {
    matchByBarcodeMock.mockResolvedValueOnce({ master_sku: "msku-l1" });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "barcode_exact",
      score: 1.0,
      master_sku: "msku-l1",
      source: "live",
    });
    // L2 / L3 / L4 / L5 never called once L1 succeeded.
    expect(matchBySupplierCodeMock).not.toHaveBeenCalled();
    expect(matchByNormalizedNameMock).not.toHaveBeenCalled();
    expect(matchByEmbeddingMock).not.toHaveBeenCalled();
  });

  it("skips level 1 entirely when barcode is absent", async () => {
    const itemNoBarcode = { ...baseItem, barcode: undefined };
    matchBySupplierCodeMock.mockResolvedValueOnce({ master_sku: "msku-l2" });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(itemNoBarcode, ctx);
    expect(matchByBarcodeMock).not.toHaveBeenCalled();
    expect(result.method).toBe("supplier_code_exact");
    expect(result.master_sku).toBe("msku-l2");
  });
});

describe("runMatchCascade — Step 2: supplier_code (level 2)", () => {
  it("falls through to level 2 when level 1 misses, returns supplier_code_exact", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce({ master_sku: "msku-l2" });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "supplier_code_exact",
      score: 1.0,
      master_sku: "msku-l2",
      source: "live",
    });
    expect(matchByNormalizedNameMock).not.toHaveBeenCalled();
    expect(matchByEmbeddingMock).not.toHaveBeenCalled();
  });
});

describe("runMatchCascade — Step 3: normalized name (level 3)", () => {
  it("returns normalized_name_exact with score 0.9 on L3 hit", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByNormalizedNameMock.mockResolvedValueOnce({ master_sku: "msku-l3" });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "normalized_name_exact",
      score: 0.9,
      master_sku: "msku-l3",
      source: "live",
    });
    expect(matchByEmbeddingMock).not.toHaveBeenCalled();
  });

  it("skips level 3 entirely when product_name normalizes to empty", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByEmbeddingMock.mockResolvedValueOnce(null);
    const item = { ...baseItem, product_name: "   ", barcode: undefined, supplier_code: undefined };
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(item, ctx);
    expect(matchByNormalizedNameMock).not.toHaveBeenCalled();
    expect(result.method).toBe("unresolved");
  });
});

describe("runMatchCascade — Step 4: embeddings (level 4)", () => {
  it("returns embeddings_high when score >= embeddingsHigh", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByNormalizedNameMock.mockResolvedValueOnce(null);
    matchByEmbeddingMock.mockResolvedValueOnce({
      master_sku: "msku-l4-high",
      score: 0.95,
      candidate: { master_sku: "msku-l4-high", nombre_canonico: "Aceite de oliva 1L" },
    });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "embeddings_high",
      score: 0.95,
      master_sku: "msku-l4-high",
      source: "live",
    });
    // L5 never called — high-confidence L4 short-circuits the arbiter.
    expect(arbitrateCandidateMock).not.toHaveBeenCalled();
  });

  it("falls through to unresolved when level 4 score < embeddingsMid", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByNormalizedNameMock.mockResolvedValueOnce(null);
    matchByEmbeddingMock.mockResolvedValueOnce({
      master_sku: "msku-x",
      score: 0.4,
      candidate: { master_sku: "msku-x", nombre_canonico: "Other" },
    });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "unresolved",
      score: 0.4,
      master_sku: null,
      source: "live",
    });
    expect(arbitrateCandidateMock).not.toHaveBeenCalled();
  });

  it("falls through to unresolved with score 0 when level 4 returns null (degraded)", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByNormalizedNameMock.mockResolvedValueOnce(null);
    matchByEmbeddingMock.mockResolvedValueOnce(null);
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result.method).toBe("unresolved");
    expect(result.score).toBe(0);
    expect(result.master_sku).toBeNull();
  });
});

describe("runMatchCascade — Step 5: LLM arbiter (level 5)", () => {
  it("level 4 mid + L5 accept (confidence >= arbiterAccept) → llm_arbiter_match", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByNormalizedNameMock.mockResolvedValueOnce(null);
    matchByEmbeddingMock.mockResolvedValueOnce({
      master_sku: "msku-l4-mid",
      score: 0.85,
      candidate: {
        master_sku: "msku-l4-mid",
        nombre_canonico: "Aceite de oliva 1L premium",
      },
    });
    arbitrateCandidateMock.mockResolvedValueOnce({
      isMatch: true,
      confidence: 0.92,
      rationale: "same product different formatting",
    });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "llm_arbiter_match",
      score: 0.92,
      master_sku: "msku-l4-mid",
      source: "live",
    });
    expect(arbitrateCandidateMock).toHaveBeenCalledOnce();
  });

  it("level 4 mid + L5 reject (isMatch=false) → llm_arbiter_reject, master_sku null", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByNormalizedNameMock.mockResolvedValueOnce(null);
    matchByEmbeddingMock.mockResolvedValueOnce({
      master_sku: "msku-l4-mid",
      score: 0.83,
      candidate: { master_sku: "msku-l4-mid", nombre_canonico: "Different product" },
    });
    arbitrateCandidateMock.mockResolvedValueOnce({
      isMatch: false,
      confidence: 0.1,
      rationale: "different brand and size",
    });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "llm_arbiter_reject",
      score: 0.83, // keeps L4 score for "closest miss first" queue sorting
      master_sku: null,
      source: "live",
    });
  });

  it("level 4 mid + L5 accept-but-low-confidence (< arbiterAccept) → llm_arbiter_reject", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByNormalizedNameMock.mockResolvedValueOnce(null);
    matchByEmbeddingMock.mockResolvedValueOnce({
      master_sku: "msku-l4-mid",
      score: 0.81,
      candidate: { master_sku: "msku-l4-mid", nombre_canonico: "Maybe match" },
    });
    arbitrateCandidateMock.mockResolvedValueOnce({
      isMatch: true,
      confidence: 0.6, // below arbiterAccept of 0.8
      rationale: "looks similar but not confident",
    });
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result.method).toBe("llm_arbiter_reject");
    expect(result.master_sku).toBeNull();
  });
});

describe("runMatchCascade — all-fail unresolved", () => {
  it("returns unresolved with score 0 when every level returns null", async () => {
    matchByBarcodeMock.mockResolvedValueOnce(null);
    matchBySupplierCodeMock.mockResolvedValueOnce(null);
    matchByNormalizedNameMock.mockResolvedValueOnce(null);
    matchByEmbeddingMock.mockResolvedValueOnce(null);
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "unresolved",
      score: 0,
      master_sku: null,
      source: "live",
    });
  });
});

describe("runMatchCascade — error envelope (PATTERNS section 3)", () => {
  it("uncaught exception in a level becomes { unresolved, 0, null } (never throws)", async () => {
    matchByBarcodeMock.mockRejectedValueOnce(new Error("DB down"));
    const ctx = makeCtx({ validatedMapping: null });
    const result = await runMatchCascade(baseItem, ctx);
    expect(result).toEqual<MatchResult>({
      method: "unresolved",
      score: 0,
      master_sku: null,
    });
    // No `source` field on error-envelope return — the result didn't come
    // from the cache and didn't complete a live path either.
    expect(result.source).toBeUndefined();
  });
});
