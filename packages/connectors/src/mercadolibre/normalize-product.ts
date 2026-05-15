/**
 * Pure ML item → NormalizedProduct mapping (Plan 2.1.2.4).
 *
 * Mirrors `packages/connectors/src/wordpress/normalize-product.ts` shape for
 * cross-channel uniformity. Pure projection — no env, no fetch, no DB.
 *
 * ── Notes ───────────────────────────────────────────────────────────────────
 *
 *   • The `master_products` row that variant-mapper.ts inserts uses
 *     `item.title` as `nombre_canonico`. This NormalizedProduct shape is the
 *     parallel "schema-validated" view of the same data — used by the cron
 *     when it wants a Zod-checked structure for downstream consumers (e.g.
 *     the embeddings re-indexer in F2 Wave 2).
 *   • `barcode` is read from ML's `attributes` array via the conventional
 *     keys "GTIN" / "EAN" / "BARCODE" / "UPC" — first hit wins. ML lists are
 *     free-form so we use a small set of well-known IDs.
 *   • W1 invariant — keep CSV's column-mapping helper out of this file.
 */

import type { NormalizedProduct } from "@faka/schema";
import type { MLItem } from "./types.js";

function nz(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

function findAttribute(item: MLItem, ids: string[]): string | undefined {
  for (const id of ids) {
    const hit = item.attributes?.find(
      (a) => a.id === id || a.name?.toUpperCase() === id,
    );
    const v = nz(hit?.value_name ?? null);
    if (v) return v;
  }
  return undefined;
}

function brand(item: MLItem): string | undefined {
  return findAttribute(item, ["BRAND", "MARCA"]);
}

function barcode(item: MLItem): string | undefined {
  return findAttribute(item, ["GTIN", "EAN", "UPC", "BARCODE"]);
}

export function normalizeProduct(item: MLItem): NormalizedProduct {
  return {
    channel: "mercadolibre",
    external_id: item.id,
    sku: nz(item.seller_custom_field ?? null),
    name: item.title,
    description: undefined,
    category: nz(item.category_id ?? null),
    brand: brand(item),
    price:
      typeof item.price === "number" && item.price >= 0 ? item.price : undefined,
    sale_price: undefined,
    barcode: barcode(item),
    supplier_code: nz(item.seller_custom_field ?? null),
    image_url: nz(item.secure_thumbnail ?? item.thumbnail ?? null),
    stock:
      typeof item.available_quantity === "number" && item.available_quantity >= 0
        ? item.available_quantity
        : undefined,
    status: nz(item.status ?? null),
  };
}
