/**
 * Pure ML order → NormalizedOrder mapping (Plan 2.1.2.4).
 *
 * Mirrors `packages/connectors/src/wordpress/normalize-order.ts` shape for
 * cross-channel uniformity. No env, no fetch, no DB — pure projection from
 * `MLOrder` to the schema-shaped `NormalizedOrder`.
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 *   • Currency is COP (RESEARCH §Pitfall 4 — currency drift is caught in
 *     api-client BEFORE this function runs; defensive default here is "COP"
 *     for free-fixture tests).
 *   • Bogotá timezone via `Intl.DateTimeFormat("en-CA", { timeZone:
 *     "America/Bogota" })` — yields ISO `YYYY-MM-DD`. No dayjs dependency.
 *     Colombia does not observe DST (RESEARCH §Pitfall 11) so the offset is
 *     a stable -05:00.
 *   • `status` ← `mapMLStatus(order.status)`. When the order was cancelled,
 *     `cancel_detail` is preserved in `notes` (RESEARCH §Pitfall 6 —
 *     buyer-vs-seller cancellation signal must not be erased).
 *   • `shipping_cost` is read from `order.shipping_cost` directly (RESEARCH
 *     §Pitfall 10 — DO NOT back-derive from `total - sum(items)`).
 *   • `notes` carries cancel_detail + shipping carrier hint when applicable.
 *
 * ── W1 invariant ────────────────────────────────────────────────────────────
 *
 * This file MUST NOT import the CSV column-mapping helper. CSV-only.
 */

import type { NormalizedOrder, NormalizedOrderItem } from "@faka/schema";
import {
  mapMLStatus,
  preserveCancellationDetail,
} from "./state-mapper.js";
import { ML_CURRENCY, type MLOrder, type MLOrderItem } from "./types.js";

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
  const d = new Date(iso);
  return BOGOTA_TIME_FMT.format(d);
}

function nz(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
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

function buildPhone(ml: MLOrder["buyer"]): string | undefined {
  const fromBuyer = ml.phone;
  if (fromBuyer && typeof fromBuyer.number === "string" && fromBuyer.number.length > 0) {
    const area = (fromBuyer.area_code ?? "").trim();
    return area.length > 0 ? `${area}${fromBuyer.number}` : fromBuyer.number;
  }
  return undefined;
}

function buildNotes(order: MLOrder): string | undefined {
  const parts: string[] = [];
  // Cancellation detail (PATTERNS §"State mapper" + RESEARCH §Pitfall 6).
  const cancelDetail = preserveCancellationDetail(order);
  if (cancelDetail) {
    parts.push(`cancel_detail=${cancelDetail}`);
  }
  // Shipping hint (RESEARCH §Pitfall 10 — preserve carrier/cost source-of-truth).
  if (typeof order.shipping_cost === "number" && order.shipping_cost > 0) {
    parts.push(`shipping_cost=${order.shipping_cost}`);
  }
  if (order.shipping?.shipment_type) {
    parts.push(`shipment_type=${order.shipping.shipment_type}`);
  }
  return parts.length > 0 ? parts.join("; ") : undefined;
}

export function normalizeOrderItems(
  externalOrderId: string,
  items: MLOrderItem[],
): NormalizedOrderItem[] {
  return items.map((it) => {
    const quantity = it.quantity;
    const unit_price = it.unit_price;
    const line_total = unit_price * quantity;
    return {
      external_order_id: externalOrderId,
      external_sku: nz(it.item.seller_sku ?? null),
      external_product_id: it.item.id,
      product_name: it.item.title,
      quantity,
      unit_price,
      line_total,
    };
  });
}

export function normalizeOrder(order: MLOrder): NormalizedOrder {
  const external_order_id = String(order.id);
  const subtotal = order.order_items.reduce(
    (acc, it) => acc + it.unit_price * it.quantity,
    0,
  );
  // RESEARCH §Pitfall 10 — pull shipping_cost from the canonical field, never derive.
  const shipping_cost =
    typeof order.shipping_cost === "number" && order.shipping_cost >= 0
      ? order.shipping_cost
      : 0;
  const total =
    typeof order.total_amount === "number" && order.total_amount >= 0
      ? order.total_amount
      : subtotal + shipping_cost;

  return {
    channel: "mercadolibre",
    external_order_id,
    order_date: bogotaDate(order.last_updated ?? order.date_created),
    order_time: bogotaTime(order.last_updated ?? order.date_created),
    status: mapMLStatus(order.status),
    currency: order.currency_id || ML_CURRENCY,
    subtotal,
    shipping_cost,
    total,
    customer_external_id: order.buyer?.id ? String(order.buyer.id) : undefined,
    customer_name:
      fullName(order.buyer?.first_name, order.buyer?.last_name) ??
      nz(order.buyer?.nickname),
    customer_phone:
      nz(order.shipping?.receiver_address?.receiver_phone ?? null) ??
      buildPhone(order.buyer),
    customer_email: nz(order.buyer?.email ?? null),
    customer_doc: nz(order.buyer?.billing_info?.doc_number ?? null),
    customer_city: nz(order.shipping?.receiver_address?.city?.name ?? null),
    customer_dept: nz(order.shipping?.receiver_address?.state?.name ?? null),
    payment_method: nz(order.payments?.[0]?.payment_method_id ?? null),
    notes: buildNotes(order),
  };
}
