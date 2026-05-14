/**
 * Unit tests for `persistMatch` — the Plan 2.2.5 persistence layer.
 *
 * `persistMatch` has three side-effects:
 *   1. UPSERT into `product_mappings` (only when `master_sku !== null`,
 *      and skipped entirely on cache hits).
 *   2. Sticky `sale_items.master_sku` update — only on a real match,
 *      gated by `WHERE master_sku IS NULL`.
 *   3. The cascade ALWAYS writes `validado_humano = false`.
 *
 * We mock `idempotentUpsert` (the F1 helper) so we can assert the exact
 * payload the persist layer hands it, and we build a thin Supabase chain
 * stub so we can verify the sale_items update issues the right `WHERE`
 * clauses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const idempotentUpsertMock = vi.fn();
vi.mock("../../src/idempotency.js", () => ({
  idempotentUpsert: idempotentUpsertMock,
}));

// eslint-disable-next-line import/first
import { persistMatch } from "../../src/matching/persist.js";
// eslint-disable-next-line import/first
import type {
  MatchResult,
  SaleItemCandidate,
} from "../../src/matching/types.js";

function makeSaleItemsUpdateStub() {
  const isMock = vi.fn(async () => ({ data: null, error: null }));
  const eqMock = vi.fn(() => ({ is: isMock }));
  const updateMock = vi.fn(() => ({ eq: eqMock }));
  return { updateMock, eqMock, isMock };
}

function makeSupabaseStub() {
  const saleItems = makeSaleItemsUpdateStub();
  const from = vi.fn((table: string) => {
    if (table === "sale_items") {
      return { update: saleItems.updateMock };
    }
    // product_mappings path goes through idempotentUpsert which we've
    // mocked — but the helper takes the supabase client as an argument and
    // calls `.from(table).upsert(...)` itself. Since we mocked the helper
    // wholesale, the supabase stub never sees the product_mappings table
    // in this test surface.
    return { update: vi.fn() };
  });
  return { supabase: { from } as never, saleItems };
}

const baseItem: SaleItemCandidate = {
  canal: "wordpress",
  external_product_id: "wc-101",
  product_name: "Aceite Oliva 1L",
  barcode: "7701234567890",
  supplier_code: "OLI-001",
};

beforeEach(() => {
  idempotentUpsertMock.mockReset();
  idempotentUpsertMock.mockResolvedValue({ rowsAffected: 1, error: null });
});

describe("persistMatch — product_mappings UPSERT", () => {
  it("UPSERTs with onConflict 'canal,external_id' and validado_humano=false", async () => {
    const { supabase } = makeSupabaseStub();
    const result: MatchResult = {
      method: "barcode_exact",
      score: 1.0,
      master_sku: "msku-1",
      source: "live",
    };
    await persistMatch(supabase, baseItem, result);
    expect(idempotentUpsertMock).toHaveBeenCalledOnce();
    const [, table, row, options] = idempotentUpsertMock.mock.calls[0]!;
    expect(table).toBe("product_mappings");
    expect(options).toEqual({ onConflict: "canal,external_id" });
    expect(row).toMatchObject({
      canal: "wordpress",
      external_id: "wc-101",
      master_sku: "msku-1",
      match_method: "barcode_exact",
      score: 1.0,
      validado_humano: false,
    });
    expect(typeof row.last_arbitrated_at).toBe("string");
  });

  it("skips product_mappings UPSERT when result.master_sku is null", async () => {
    const { supabase } = makeSupabaseStub();
    const result: MatchResult = {
      method: "unresolved",
      score: 0,
      master_sku: null,
      source: "live",
    };
    await persistMatch(supabase, baseItem, result);
    expect(idempotentUpsertMock).not.toHaveBeenCalled();
  });

  it("skips product_mappings UPSERT on cache hit (row already exists & validated)", async () => {
    const { supabase } = makeSupabaseStub();
    const result: MatchResult = {
      method: "barcode_exact",
      score: 1.0,
      master_sku: "msku-cached",
      source: "cache",
    };
    await persistMatch(supabase, baseItem, result);
    expect(idempotentUpsertMock).not.toHaveBeenCalled();
  });
});

describe("persistMatch — sticky sale_items.master_sku update", () => {
  it("updates sale_items.master_sku WHERE master_sku IS NULL on a real match", async () => {
    const { supabase, saleItems } = makeSupabaseStub();
    const result: MatchResult = {
      method: "llm_arbiter_match",
      score: 0.91,
      master_sku: "msku-A",
      source: "live",
    };
    await persistMatch(supabase, baseItem, result);
    expect(saleItems.updateMock).toHaveBeenCalledWith({ master_sku: "msku-A" });
    expect(saleItems.eqMock).toHaveBeenCalledWith("external_product_id", "wc-101");
    expect(saleItems.isMock).toHaveBeenCalledWith("master_sku", null);
  });

  it("does NOT touch sale_items when method is 'unresolved'", async () => {
    const { supabase, saleItems } = makeSupabaseStub();
    const result: MatchResult = {
      method: "unresolved",
      score: 0,
      master_sku: null,
      source: "live",
    };
    await persistMatch(supabase, baseItem, result);
    expect(saleItems.updateMock).not.toHaveBeenCalled();
  });

  it("does NOT touch sale_items when method is 'llm_arbiter_reject' (master_sku null)", async () => {
    const { supabase, saleItems } = makeSupabaseStub();
    const result: MatchResult = {
      method: "llm_arbiter_reject",
      score: 0.81,
      master_sku: null,
      source: "live",
    };
    await persistMatch(supabase, baseItem, result);
    expect(saleItems.updateMock).not.toHaveBeenCalled();
  });

  it("DOES update sale_items on a cache hit (sticky reattach to previously-validated mapping)", async () => {
    const { supabase, saleItems } = makeSupabaseStub();
    const result: MatchResult = {
      method: "barcode_exact",
      score: 1.0,
      master_sku: "msku-cached",
      source: "cache",
    };
    await persistMatch(supabase, baseItem, result);
    // No new product_mappings write (it's already validated)…
    expect(idempotentUpsertMock).not.toHaveBeenCalled();
    // …but sale_items DOES get the sticky update so new orders attach.
    expect(saleItems.updateMock).toHaveBeenCalledWith({
      master_sku: "msku-cached",
    });
  });
});

describe("persistMatch — idempotency", () => {
  it("re-running with the same input produces the same UPSERT (helper is idempotent)", async () => {
    const { supabase } = makeSupabaseStub();
    const result: MatchResult = {
      method: "embeddings_high",
      score: 0.94,
      master_sku: "msku-Z",
      source: "live",
    };
    await persistMatch(supabase, baseItem, result);
    await persistMatch(supabase, baseItem, result);
    expect(idempotentUpsertMock).toHaveBeenCalledTimes(2);
    // Both calls used the same onConflict key — that's what idempotency
    // hinges on at the DB level. The helper itself doesn't dedupe in
    // memory; Postgres' unique constraint does.
    const onConflicts = idempotentUpsertMock.mock.calls.map(
      (c) => (c[3] as { onConflict: string }).onConflict,
    );
    expect(onConflicts).toEqual(["canal,external_id", "canal,external_id"]);
  });
});
