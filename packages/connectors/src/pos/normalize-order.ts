/**
 * POSSale → faka NormalizedOrder + NormalizedOrderItem[].
 * Pure projection; no env, no DB.
 *
 * Date format: PHP POS returns `sale_time` as `"MM/DD/YYYY hh:mm am/pm"` in
 * the location's local timezone (America/Bogota for fakastore.top). We parse
 * that and emit `order_date` as YYYY-MM-DD plus `order_time` as HH:MM:SS.
 *
 * Currency: COP (no currency field in v1; install is single-country).
 *
 * Status mapping: PHP POS's `mode` field is the canonical status —
 *   "sale" → pagado
 *   "return" → devuelto
 *   "estimate" / "work_order" → pendiente (not closed yet)
 */

import type {
  NormalizedOrder,
  NormalizedOrderItem,
} from "@faka/schema";
import type { POSSale, POSSaleItem } from "./types.js";

const COP = "COP" as const;

const SALE_TIME_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i;

/** Parse PHP POS's `"MM/DD/YYYY hh:mm am/pm"` (Bogotá local). */
function parsePosLocal(raw: string | undefined): {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
} | null {
  if (!raw) return null;
  const m = raw.trim().match(SALE_TIME_RE);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);
  let hh = Number(m[4]);
  const mi = Number(m[5]);
  const ampm = m[6]!.toLowerCase();
  if (ampm === "pm" && hh < 12) hh += 12;
  if (ampm === "am" && hh === 12) hh = 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${yyyy}-${pad(mm)}-${pad(dd)}`,
    time: `${pad(hh)}:${pad(mi)}:00`,
  };
}

function mapStatus(sale: POSSale): string {
  const mode = (sale.mode ?? "").toLowerCase();
  if (mode === "return") return "devuelto";
  if (mode === "estimate" || mode === "work_order") return "pendiente";
  return "pagado";
}

function nz(v: string | null | undefined): string | undefined {
  if (v == null) return undefined;
  const t = String(v).trim();
  return t.length > 0 ? t : undefined;
}

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fullName(first: string | undefined, last: string | undefined): string | undefined {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  const out = `${f} ${l}`.trim();
  return out.length > 0 ? out : undefined;
}

export function normalizeOrder(
  sale: POSSale,
  channel: "pos" | "pos1" | "pos2",
): NormalizedOrder {
  const parsed = parsePosLocal(sale.sale_time);
  const date = parsed?.date ?? new Date().toISOString().slice(0, 10);
  const time = parsed?.time;

  const subtotal = (sale.cart_items ?? []).reduce((acc, ci) => {
    const qty = Math.max(1, Math.round(num(ci.quantity)));
    const unit = Math.max(0, num(ci.unit_price));
    return acc + unit * qty;
  }, 0);

  return {
    channel,
    external_order_id: String(sale.sale_id),
    order_date: date,
    order_time: time,
    status: mapStatus(sale),
    currency: COP,
    subtotal,
    total: Math.max(0, num(sale.total)),
    pos_id: String(sale.location_id),
    payment_method: nz(sale.payment_type ?? undefined),
    customer_external_id:
      sale.customer_id != null && String(sale.customer_id) !== "0"
        ? String(sale.customer_id)
        : undefined,
    customer_name:
      fullName(sale.customer_first_name, sale.customer_last_name) ??
      nz(sale.customer_company_name),
    customer_phone: nz(sale.customer_phone_number),
    customer_email: nz(sale.customer_email),
    customer_city: nz(sale.customer_city),
    customer_dept: nz(sale.customer_state),
    notes: nz(sale.comment),
  };
}

export function normalizeOrderItems(
  sale: POSSale,
): NormalizedOrderItem[] {
  const external_order_id = String(sale.sale_id);
  return (sale.cart_items ?? []).map((ci: POSSaleItem) => {
    const qty = Math.max(1, Math.round(num(ci.quantity)));
    const unit = Math.max(0, num(ci.unit_price));
    const line_total = unit * qty;
    return {
      external_order_id,
      external_product_id:
        ci.item_id != null ? String(ci.item_id) : undefined,
      external_sku: nz(ci.item_number),
      product_name: ci.name ?? "(sin nombre)",
      quantity: qty,
      unit_price: unit,
      unit_cost:
        ci.cost_price != null ? Math.max(0, num(ci.cost_price)) : undefined,
      line_total,
      line_discount: Math.max(
        0,
        num(ci.discount) + num(ci.discount_flat_discount),
      ),
    };
  });
}
