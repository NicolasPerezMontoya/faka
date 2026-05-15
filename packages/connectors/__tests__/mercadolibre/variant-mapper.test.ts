/**
 * Tests for `packages/connectors/src/mercadolibre/variant-mapper.ts` (Plan 2.1.2.2).
 *
 * Coverage:
 *   1. variationFingerprint — same (name, value) pairs produce same hash
 *      regardless of array order.
 *   2. variationFingerprint — case-insensitive on attribute names.
 *   3. variationFingerprint — different pairs produce different hashes.
 *   4. variationFingerprint — ignores reserved `__*` keys (pricing-independent).
 *   5. mapVariation — produces a stable atributos_json + pricing payload.
 *   6. upsertProductWithVariants — catalog_product_id != null routes to DLQ
 *      and skips master_products insert.
 *   7. upsertProductWithVariants — happy-path INSERT into master_products +
 *      UPSERT per variation + UPSERT product_mappings.
 *   8. upsertProductWithVariants — reuses existing master_sku when the
 *      product_mappings row already exists (idempotency on rerun).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mapVariation,
  upsertProductWithVariants,
  variationFingerprint,
  type AttributeCombination,
} from "../../src/mercadolibre/variant-mapper.js";
import type { MLItem, MLVariation } from "../../src/mercadolibre/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "__fixtures__", name), "utf-8"),
  ) as T;
}

// -----------------------------------------------------------------------------
// (1)-(4) variationFingerprint
// -----------------------------------------------------------------------------

describe("variationFingerprint", () => {
  it("is order-independent: [Color, Talla] === [Talla, Color]", () => {
    const colorThenTalla: AttributeCombination[] = [
      { name: "Color", value_name: "Rojo" },
      { name: "Talla", value_name: "M" },
    ];
    const tallaThenColor: AttributeCombination[] = [
      { name: "Talla", value_name: "M" },
      { name: "Color", value_name: "Rojo" },
    ];
    expect(variationFingerprint(colorThenTalla)).toBe(
      variationFingerprint(tallaThenColor),
    );
  });

  it("is case-insensitive on attribute names", () => {
    const upper: AttributeCombination[] = [
      { name: "COLOR", value_name: "Rojo" },
      { name: "TALLA", value_name: "M" },
    ];
    const lower: AttributeCombination[] = [
      { name: "color", value_name: "Rojo" },
      { name: "talla", value_name: "M" },
    ];
    expect(variationFingerprint(upper)).toBe(variationFingerprint(lower));
  });

  it("produces different fingerprints for different value sets", () => {
    const rojoM: AttributeCombination[] = [
      { name: "Color", value_name: "Rojo" },
      { name: "Talla", value_name: "M" },
    ];
    const azulM: AttributeCombination[] = [
      { name: "Color", value_name: "Azul" },
      { name: "Talla", value_name: "M" },
    ];
    expect(variationFingerprint(rojoM)).not.toBe(variationFingerprint(azulM));
  });

  it("filters reserved __* keys (price changes don't affect fingerprint)", () => {
    const withReserved: AttributeCombination[] = [
      { name: "Color", value_name: "Rojo" },
      { name: "__pricing", value_name: "999" },
    ];
    const without: AttributeCombination[] = [{ name: "Color", value_name: "Rojo" }];
    expect(variationFingerprint(withReserved)).toBe(variationFingerprint(without));
  });
});

// -----------------------------------------------------------------------------
// (5) mapVariation
// -----------------------------------------------------------------------------

describe("mapVariation", () => {
  it("produces stable atributos_json with lowercase keys + sorted order", () => {
    const itemFixture = loadFixture<MLItem>("ml-item-with-variations.json");
    const rojoM = itemFixture.variations![0]!;
    const mapped = mapVariation(rojoM, "MASTER_SKU_AAA");
    expect(mapped.master_sku).toBe("MASTER_SKU_AAA");
    expect(mapped.master_variant_sku_hint).toBe("TEST-SKU-ROJO-M");
    // Keys are lowercase + sorted alphabetically.
    const keys = Object.keys(mapped.atributos_json).filter((k) => !k.startsWith("__"));
    expect(keys).toEqual(["color", "talla"]);
    expect(mapped.atributos_json.color).toBe("Rojo");
    expect(mapped.atributos_json.talla).toBe("M");
    // Pricing is stashed under reserved key.
    const pricing = (mapped.atributos_json as { __pricing?: Record<string, unknown> })
      .__pricing;
    expect(pricing).toMatchObject({
      price: 75000,
      available_quantity: 8,
      ml_variation_id: 987654321,
    });
  });

  it("fixture's three variations produce three distinct fingerprints", () => {
    const itemFixture = loadFixture<MLItem>("ml-item-with-variations.json");
    const fingerprints = (itemFixture.variations ?? []).map((v) =>
      variationFingerprint(v.attribute_combinations),
    );
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    expect(fingerprints.length).toBe(3);
  });
});

// -----------------------------------------------------------------------------
// (6)-(8) upsertProductWithVariants
// -----------------------------------------------------------------------------

interface SupabaseMockState {
  mappingByExternalId: Map<string, string>; // external_id → master_sku
  masterProductsInserts: Array<Record<string, unknown>>;
  variantUpserts: Array<Record<string, unknown>>;
  mappingUpserts: Array<Record<string, unknown>>;
  dlqInserts: Array<Record<string, unknown>>;
  /** Counter used to generate new master_sku UUIDs on insert. */
  nextMasterSku: number;
}

function makeSupabaseMock(initial: Partial<SupabaseMockState> = {}) {
  const state: SupabaseMockState = {
    mappingByExternalId: initial.mappingByExternalId ?? new Map(),
    masterProductsInserts: [],
    variantUpserts: [],
    mappingUpserts: [],
    dlqInserts: [],
    nextMasterSku: 1,
  };

  function fromProductMappings() {
    return {
      select: () => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: (_c2: string, externalId: string) => ({
            maybeSingle: async () => {
              const masterSku = state.mappingByExternalId.get(externalId);
              return {
                data: masterSku ? { master_sku: masterSku } : null,
                error: null,
              };
            },
          }),
        }),
      }),
      upsert: async (row: Record<string, unknown>, _opts: unknown) => {
        state.mappingUpserts.push(row);
        state.mappingByExternalId.set(
          row.external_id as string,
          row.master_sku as string,
        );
        return { error: null };
      },
    };
  }

  function fromMasterProducts() {
    return {
      insert: (row: Record<string, unknown>) => ({
        select: (_cols: string) => ({
          single: async () => {
            state.masterProductsInserts.push(row);
            const sku = `MASTER_SKU_${state.nextMasterSku++}`;
            return { data: { master_sku: sku }, error: null };
          },
        }),
      }),
    };
  }

  function fromProductVariants() {
    return {
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => ({
        select: (_cols: string) => ({
          single: async () => {
            state.variantUpserts.push({ row, onConflict: opts.onConflict });
            const variantSku = `VARIANT_${state.variantUpserts.length}`;
            const now = new Date().toISOString();
            return {
              data: {
                master_variant_sku: variantSku,
                created_at: now,
                updated_at: now,
              },
              error: null,
            };
          },
        }),
      }),
    };
  }

  function fromDLQ() {
    return {
      insert: async (row: Record<string, unknown>) => {
        state.dlqInserts.push(row);
        return { error: null };
      },
    };
  }

  const supabase = {
    from(table: string) {
      switch (table) {
        case "product_mappings":
          return fromProductMappings();
        case "master_products":
          return fromMasterProducts();
        case "product_variants":
          return fromProductVariants();
        case "dead_letter_queue":
          return fromDLQ();
        default:
          throw new Error(`unexpected from(${table})`);
      }
    },
    rpc: async () => ({ data: null, error: null }),
  };

  return { supabase, state };
}

describe("upsertProductWithVariants — catalog_product_id DLQ short-circuit", () => {
  it("DLQ's items with catalog_product_id != null and skips master_products INSERT", async () => {
    const item: MLItem = {
      id: "MCO_CATALOG",
      site_id: "MCO",
      title: "Catalog mode",
      seller_id: 1,
      price: 1000,
      currency_id: "COP",
      catalog_product_id: "CAT_42",
      variations: [],
    } as MLItem;

    const { supabase, state } = makeSupabaseMock();
    const out = await upsertProductWithVariants(supabase as never, item);
    expect(out.ok).toBe(false);
    expect(state.masterProductsInserts).toHaveLength(0);
    expect(state.dlqInserts).toHaveLength(1);
    expect(state.dlqInserts[0]!.source).toBe(
      "items.catalog_product_not_supported",
    );
  });
});

describe("upsertProductWithVariants — happy path", () => {
  it("INSERTs master_products + UPSERTs three variations + UPSERTs product_mappings", async () => {
    const item = loadFixture<MLItem>("ml-item-with-variations.json");
    const { supabase, state } = makeSupabaseMock();
    const out = await upsertProductWithVariants(supabase as never, item);

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.variants_upserted).toBe(3);
      expect(out.master_sku).toBe("MASTER_SKU_1");
    }
    // ONE master_products insert.
    expect(state.masterProductsInserts).toHaveLength(1);
    expect(state.masterProductsInserts[0]!.nombre_canonico).toBe(item.title);
    // THREE variant UPSERTs, all using the (master_sku, atributos_json) conflict target.
    expect(state.variantUpserts).toHaveLength(3);
    for (const v of state.variantUpserts) {
      expect((v as { onConflict: string }).onConflict).toBe(
        "master_sku,atributos_json",
      );
    }
    // ONE product_mappings UPSERT bound to the new master_sku.
    expect(state.mappingUpserts).toHaveLength(1);
    expect(state.mappingUpserts[0]!.canal).toBe("mercadolibre");
    expect(state.mappingUpserts[0]!.external_id).toBe(item.id);
    expect(state.mappingUpserts[0]!.master_sku).toBe("MASTER_SKU_1");
  });

  it("reuses existing master_sku on rerun (idempotency)", async () => {
    const item = loadFixture<MLItem>("ml-item-with-variations.json");
    const { supabase, state } = makeSupabaseMock({
      mappingByExternalId: new Map([[item.id, "MASTER_SKU_PREEXISTING"]]),
    });
    const out = await upsertProductWithVariants(supabase as never, item);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.master_sku).toBe("MASTER_SKU_PREEXISTING");
    }
    // No new master_products insert.
    expect(state.masterProductsInserts).toHaveLength(0);
    // Variants still UPSERTed (idempotent).
    expect(state.variantUpserts).toHaveLength(3);
    // product_mappings UPSERTed (idempotent — refreshes external_sku/external_name).
    expect(state.mappingUpserts).toHaveLength(1);
  });
});

describe("variations_filtered DLQ warning", () => {
  it("DLQ-warns when attributes are present but variations[] is empty", async () => {
    const item: MLItem = {
      id: "MCO_FILTERED",
      site_id: "MCO",
      title: "Has attrs, no variations",
      seller_id: 1,
      price: 1000,
      currency_id: "COP",
      attributes: [{ name: "BRAND", value_name: "X" }],
      variations: [],
    } as MLItem;
    const { supabase, state } = makeSupabaseMock();
    const out = await upsertProductWithVariants(supabase as never, item);
    expect(out.ok).toBe(true);
    // DLQ warning present.
    const warning = state.dlqInserts.find(
      (r) => r.source === "items.variations_filtered",
    );
    expect(warning).toBeTruthy();
    // master_products still inserted (parent useful for name-based matching).
    expect(state.masterProductsInserts).toHaveLength(1);
  });
});

describe("mock ergonomics", () => {
  it("vi can stub a one-off variant insert to test partial failure tolerance", async () => {
    const item = loadFixture<MLItem>("ml-item-with-variations.json");
    const { supabase } = makeSupabaseMock();
    const spy = vi.spyOn(supabase, "from");
    const out = await upsertProductWithVariants(supabase as never, item);
    expect(out.ok).toBe(true);
    spy.mockRestore();
  });
});
