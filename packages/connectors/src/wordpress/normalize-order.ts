/**
 * Pure WC order → NormalizedOrder mapping (Plan 2.2.1).
 *
 * Invariant W1: this module MUST NOT import the CSV column-mapping helper.
 * That helper is CSV-only — it operates on flat string maps shaped by a
 * user-chosen column_map_json. WC payloads are typed JSON with known field
 * locations, so the mapping is a direct field projection.
 *
 * Bogotá timezone for `order_date` is computed via `Intl.DateTimeFormat`
 * (`en-CA` locale yields ISO `YYYY-MM-DD`). No dayjs dependency required.
 */

import type { NormalizedOrder } from "@faka/schema";
import type { NormalizedOrderItem } from "@faka/schema";
import type { WCOrder, WCOrderLineItem } from "./client.js";

const STATUS_MAP: Record<string, string> = {
  completed: "pagado",
  processing: "pendiente",
  "on-hold": "pendiente",
  pending: "pendiente",
  cancelled: "cancelado",
  failed: "cancelado",
  refunded: "devuelto",
};

const BOGOTA_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const BOGOTA_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function bogotaDate(gmtIso: string | undefined): string {
  // Fallback to "now" if WC omitted the timestamp (rare; defensive).
  const d = gmtIso ? new Date(`${gmtIso}Z`.replace(/ZZ$/, "Z")) : new Date();
  // Intl yields YYYY-MM-DD for en-CA.
  return BOGOTA_DATE_FMT.format(d);
}

function bogotaTime(gmtIso: string | undefined): string | undefined {
  if (!gmtIso) return undefined;
  const d = new Date(`${gmtIso}Z`.replace(/ZZ$/, "Z"));
  return BOGOTA_TIME_FMT.format(d);
}

function toNumber(s: string | number | undefined | null, fallback = 0): number {
  if (s == null) return fallback;
  const n = typeof s === "number" ? s : Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function fullName(
  first: string | undefined | null,
  last: string | undefined | null,
): string | undefined {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  const out = `${f} ${l}`.trim();
  return out.length > 0 ? out : undefined;
}

function nz(v: string | undefined | null): string | undefined {
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

export function normalizeOrderItems(
  externalOrderId: string,
  items: WCOrderLineItem[],
): NormalizedOrderItem[] {
  return items.map((it) => {
    const subtotal = toNumber(it.subtotal);
    const total = toNumber(it.total);
    const unit_price = it.quantity > 0 ? subtotal / it.quantity : subtotal;
    return {
      external_order_id: externalOrderId,
      external_sku: nz(it.sku ?? undefined),
      external_product_id: String(it.product_id),
      product_name: it.name,
      quantity: it.quantity,
      unit_price,
      line_total: total,
    };
  });
}

export function normalizeOrder(wc: WCOrder): NormalizedOrder {
  const external_order_id = String(wc.id);
  const subtotal = wc.line_items.reduce(
    (acc, it) => acc + toNumber(it.subtotal),
    0,
  );
  const discount = toNumber(wc.discount_total);
  const shipping_cost = toNumber(wc.shipping_total);
  const total = toNumber(wc.total);

  return {
    channel: "wordpress",
    external_order_id,
    order_date: bogotaDate(wc.date_modified_gmt),
    order_time: bogotaTime(wc.date_modified_gmt),
    status: STATUS_MAP[wc.status] ?? "pendiente",
    currency: wc.currency || "COP",
    subtotal,
    discount,
    shipping_cost,
    total,
    payment_method:
      nz(wc.payment_method_title ?? undefined) ??
      nz(wc.payment_method ?? undefined),
    customer_external_id:
      wc.customer_id && wc.customer_id > 0 ? String(wc.customer_id) : undefined,
    customer_name: fullName(
      wc.billing?.first_name,
      wc.billing?.last_name,
    ),
    customer_phone: nz(wc.billing?.phone ?? undefined),
    customer_email: nz(wc.billing?.email ?? undefined),
    customer_city: nz(wc.billing?.city ?? undefined),
    customer_dept: nz(wc.billing?.state ?? undefined),
  };
}
