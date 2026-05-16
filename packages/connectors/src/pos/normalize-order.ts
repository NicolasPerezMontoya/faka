/**
 * POSSale → faka NormalizedOrder + NormalizedOrderItem[].
 * Pure projection; no env, no DB. Same shape contract as
 * `mercadolibre/normalize-order.ts` and `wordpress/normalize-order.ts`.
 *
 * Currency: POS doesn't surface a currency code in its v1 API. We assume
 * COP across both stores (Colombia). If a future install ships USD, a
 * `POS_CURRENCY` env override would land here.
 *
 * Status mapping: PHP POS doesn't carry a payment-status field on Sale.
 * Mode is "sale" (completed) or "return" (refund). `is_cancelled` may
 * appear in some installs.
 */

import type {
  NormalizedOrder,
  NormalizedOrderItem,
} from "@faka/schema";
import type { POSSale, POSSaleItem } from "./types.js";

const COP = "COP" as const;

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

function bogotaDate(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  return BOGOTA_DATE_FMT.format(d);
}

function bogotaTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  return BOGOTA_TIME_FMT.format(new Date(iso));
}

function mapStatus(sale: POSSale): string {
  if (sale.is_cancelled === true) return "cancelado";
  if (sale.total < 0) return "devuelto";
  return "pagado";
}

function nz(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

export function normalizeOrder(
  sale: POSSale,
  channel: "pos" | "pos1" | "pos2",
): NormalizedOrder {
  const items = sale.cart_items ?? [];
  const subtotal = items.reduce((acc, ci) => {
    const qty = Number(ci.quantity ?? 1);
    const unit = Number(ci.unit_price ?? 0);
    const line =
      typeof ci.total === "number" ? ci.total : unit * (qty > 0 ? qty : 1);
    return acc + line;
  }, 0);

  return {
    channel,
    external_order_id: String(sale.sale_id),
    order_date: bogotaDate(sale.sale_time),
    order_time: bogotaTime(sale.sale_time),
    status: mapStatus(sale),
    currency: COP,
    subtotal,
    total: Math.max(0, Number(sale.total ?? 0)),
    pos_id: String(sale.location_id),
    customer_external_id:
      sale.customer_id != null ? String(sale.customer_id) : undefined,
    customer_name: nz(sale.customer_name) ?? undefined,
    customer_phone: nz(sale.customer_phone) ?? undefined,
    customer_email: nz(sale.customer_email) ?? undefined,
  };
}

export function normalizeOrderItems(
  sale: POSSale,
): NormalizedOrderItem[] {
  const external_order_id = String(sale.sale_id);
  return (sale.cart_items ?? []).map((ci: POSSaleItem) => {
    const qty = Math.max(1, Math.round(Number(ci.quantity ?? 1)));
    const unit = Math.max(0, Number(ci.unit_price ?? 0));
    const lineRaw =
      typeof ci.total === "number" ? ci.total : unit * qty;
    const line_total = Math.max(0, lineRaw);
    return {
      external_order_id,
      external_product_id:
        ci.item_id != null ? String(ci.item_id) : undefined,
      product_name: ci.name ?? "(sin nombre)",
      quantity: qty,
      unit_price: unit,
      line_total,
      line_discount: Math.max(0, Number(ci.discount ?? 0)),
    };
  });
}
