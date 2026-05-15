/**
 * Tests for `packages/connectors/src/mercadolibre/normalize-order.ts` (Plan 2.1.2.4).
 *
 * Coverage:
 *   1. Golden ml-order-paid.json → Zod-valid NormalizedOrder with status="pagado".
 *   2. ml-order-cancelled-seller.json → status="cancelado" + notes contains
 *      cancel_detail=seller_cancelled.
 *   3. Bogotá-local date (en-CA, America/Bogota) — UTC-5 no-DST.
 *   4. shipping_cost read from canonical field, NEVER back-derived
 *      (RESEARCH §Pitfall 10).
 *   5. Items helper produces Zod-valid line items with line_total.
 *   6. customer fields (email/phone/doc) flow through.
 *   7. Empty cancel_detail → notes is undefined (or doesn't contain "cancel_detail").
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  NormalizedOrderSchema,
  NormalizedOrderItemSchema,
} from "@faka/schema";
import {
  normalizeOrder,
  normalizeOrderItems,
} from "../../src/mercadolibre/normalize-order.js";
import type { MLOrder } from "../../src/mercadolibre/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "__fixtures__", name), "utf-8"),
  ) as T;
}

describe("normalizeOrder (ML → NormalizedOrder)", () => {
  it("produces a Zod-valid NormalizedOrder from the paid fixture", () => {
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    const n = normalizeOrder(raw);
    const parsed = NormalizedOrderSchema.safeParse(n);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      console.error(parsed.error.issues);
    }
  });

  it("maps paid → pagado + currency COP", () => {
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    const n = normalizeOrder(raw);
    expect(n.status).toBe("pagado");
    expect(n.currency).toBe("COP");
    expect(n.channel).toBe("mercadolibre");
    expect(n.external_order_id).toBe("2000000001");
  });

  it("maps cancelled + cancel_detail into status + notes", () => {
    const raw = loadFixture<MLOrder>("ml-order-cancelled-seller.json");
    const n = normalizeOrder(raw);
    expect(n.status).toBe("cancelado");
    expect(n.notes).toBeDefined();
    expect(n.notes).toMatch(/cancel_detail=seller_cancelled/);
  });

  it("emits no cancel_detail in notes for non-cancelled orders", () => {
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    const n = normalizeOrder(raw);
    expect(n.notes).not.toMatch(/cancel_detail/);
  });

  it("uses Bogotá local calendar date for order_date (UTC-5 no DST)", () => {
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    const n = normalizeOrder(raw);
    expect(n.order_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Fixture last_updated is "2026-05-15T10:05:00.000-05:00" → 15:05 UTC →
    // Bogotá date stays 2026-05-15.
    expect(n.order_date).toBe("2026-05-15");
  });

  it("reads shipping_cost from the canonical order.shipping_cost field", () => {
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    // Fixture sets shipping_cost = 0. Inject a synthetic non-zero to verify
    // the mapping reads the right field.
    const synth: MLOrder = { ...raw, shipping_cost: 5000 };
    const n = normalizeOrder(synth);
    expect(n.shipping_cost).toBe(5000);
    expect(n.notes).toMatch(/shipping_cost=5000/);
  });

  it("never back-derives shipping_cost from total - sum(items)", () => {
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    // total = 75000, items unit_price*qty = 75000 — but shipping_cost stays 0
    // in the source fixture. A back-derived implementation would emit 0 here
    // anyway; the regression test forces a synthetic where total > items+ship
    // to confirm we don't paper over the gap with an inferred shipping.
    const synth: MLOrder = {
      ...raw,
      total_amount: 80000, // 5000 more than items
      shipping_cost: 0, // canonical: zero shipping
    };
    const n = normalizeOrder(synth);
    expect(n.shipping_cost).toBe(0);
    expect(n.total).toBe(80000);
    // Subtotal stays items-only.
    expect(n.subtotal).toBe(75000);
  });

  it("extracts customer fields (email, phone, doc, city, dept) from the order envelope", () => {
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    const n = normalizeOrder(raw);
    expect(n.customer_email).toBe("redacted@example.com");
    expect(n.customer_phone).toBe("3000000000");
    expect(n.customer_doc).toBe("0000000000");
    expect(n.customer_city).toBe("Bogotá");
    expect(n.customer_dept).toBe("Bogotá D.C.");
    expect(n.customer_external_id).toBe("999999999");
  });
});

describe("normalizeOrderItems", () => {
  it("maps line items into Zod-valid NormalizedOrderItem rows", () => {
    const raw = loadFixture<MLOrder>("ml-order-paid.json");
    const items = normalizeOrderItems(String(raw.id), raw.order_items);
    expect(items.length).toBe(raw.order_items.length);
    for (const it of items) {
      const parsed = NormalizedOrderItemSchema.safeParse(it);
      expect(parsed.success).toBe(true);
    }
    expect(items[0]!.external_product_id).toBe("MCO123456789");
    expect(items[0]!.external_sku).toBe("TEST-SKU-ROJO-M");
    expect(items[0]!.unit_price).toBe(75000);
    expect(items[0]!.line_total).toBe(75000);
  });
});
