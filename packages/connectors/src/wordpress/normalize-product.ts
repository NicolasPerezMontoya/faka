/**
 * Pure WC product → NormalizedProduct mapping (Plan 2.2.1).
 *
 * Invariant W1: NO CSV column-mapping import. The WC product shape is typed
 * JSON; we project fields directly.
 *
 * EAN/barcode lookup uses the WC meta_data `_ean` key — matches the
 * WooCommerce → WC EAN/Barcode plugin convention used by the cliente.
 */

import type { NormalizedProduct } from "@faka/schema";
import type { WCProduct } from "./client.js";

function nz(v: string | undefined | null): string | undefined {
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

function metaString(
  product: WCProduct,
  key: string,
): string | undefined {
  const hit = product.meta_data?.find((m) => m.key === key);
  if (!hit) return undefined;
  const v = hit.value;
  if (typeof v === "string") return nz(v);
  if (typeof v === "number") return String(v);
  return undefined;
}

function brand(product: WCProduct): string | undefined {
  const attr = product.attributes?.find(
    (a) => a.name?.toLowerCase() === "brand" || a.name === "Marca",
  );
  return nz(attr?.options?.[0]);
}

function categoryPath(product: WCProduct): string | undefined {
  const names = (product.categories ?? []).map((c) => c.name).filter(Boolean);
  if (names.length === 0) return undefined;
  return names.join(" > ");
}

function toPrice(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function normalizeProduct(wc: WCProduct): NormalizedProduct {
  return {
    channel: "wordpress",
    external_id: String(wc.id),
    sku: nz(wc.sku ?? undefined),
    name: wc.name,
    description: nz(wc.description ?? wc.short_description ?? undefined),
    category: categoryPath(wc),
    brand: brand(wc),
    price: toPrice(wc.regular_price),
    sale_price: toPrice(wc.sale_price),
    barcode: metaString(wc, "_ean"),
    supplier_code: nz(wc.sku ?? undefined),
    image_url: nz(wc.images?.[0]?.src),
    stock:
      typeof wc.stock_quantity === "number" && wc.stock_quantity >= 0
        ? wc.stock_quantity
        : undefined,
    status: nz(wc.status),
  };
}
