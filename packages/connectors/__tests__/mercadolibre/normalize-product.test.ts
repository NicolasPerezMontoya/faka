/**
 * Tests for `packages/connectors/src/mercadolibre/normalize-product.ts` (Plan 2.1.2.4).
 *
 * Coverage:
 *   1. ml-item-with-variations.json → Zod-valid NormalizedProduct.
 *   2. channel="mercadolibre" + external_id stable.
 *   3. brand extracted from attributes (Marca / BRAND).
 *   4. sku/supplier_code from seller_custom_field.
 *   5. price + stock flow through.
 *   6. image_url prefers secure_thumbnail.
 *   7. barcode extracted when GTIN/EAN attribute present (synthetic).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { NormalizedProductSchema } from "@faka/schema";
import { normalizeProduct } from "../../src/mercadolibre/normalize-product.js";
import type { MLItem } from "../../src/mercadolibre/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "__fixtures__", name), "utf-8"),
  ) as T;
}

describe("normalizeProduct (ML → NormalizedProduct)", () => {
  it("produces a Zod-valid NormalizedProduct from the variations fixture", () => {
    const raw = loadFixture<MLItem>("ml-item-with-variations.json");
    const n = normalizeProduct(raw);
    const parsed = NormalizedProductSchema.safeParse(n);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      console.error(parsed.error.issues);
    }
  });

  it("carries channel='mercadolibre' and external_id from item.id", () => {
    const raw = loadFixture<MLItem>("ml-item-with-variations.json");
    const n = normalizeProduct(raw);
    expect(n.channel).toBe("mercadolibre");
    expect(n.external_id).toBe(raw.id);
  });

  it("extracts brand from attributes (Marca/BRAND keys)", () => {
    const raw = loadFixture<MLItem>("ml-item-with-variations.json");
    const n = normalizeProduct(raw);
    expect(n.brand).toBe("Faka Test Brand");
  });

  it("sets sku + supplier_code from seller_custom_field", () => {
    const raw = loadFixture<MLItem>("ml-item-with-variations.json");
    const n = normalizeProduct(raw);
    expect(n.sku).toBe("TEST-SKU-PARENT");
    expect(n.supplier_code).toBe("TEST-SKU-PARENT");
  });

  it("flows price + stock", () => {
    const raw = loadFixture<MLItem>("ml-item-with-variations.json");
    const n = normalizeProduct(raw);
    expect(n.price).toBe(75000);
    expect(n.stock).toBe(22);
  });

  it("prefers secure_thumbnail for image_url", () => {
    const raw = loadFixture<MLItem>("ml-item-with-variations.json");
    const n = normalizeProduct(raw);
    expect(n.image_url).toBe(raw.secure_thumbnail ?? raw.thumbnail);
  });

  it("extracts barcode from GTIN attribute when present", () => {
    const raw = loadFixture<MLItem>("ml-item-with-variations.json");
    const withGtin: MLItem = {
      ...raw,
      attributes: [
        ...(raw.attributes ?? []),
        { id: "GTIN", name: "GTIN", value_name: "7700000000123" },
      ],
    };
    const n = normalizeProduct(withGtin);
    expect(n.barcode).toBe("7700000000123");
  });

  it("returns undefined barcode when no GTIN/EAN attribute exists", () => {
    const raw = loadFixture<MLItem>("ml-item-with-variations.json");
    const n = normalizeProduct(raw);
    expect(n.barcode).toBeUndefined();
  });
});
