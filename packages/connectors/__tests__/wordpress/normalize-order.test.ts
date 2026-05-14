/**
 * Tests for normalize-order.ts (Plan 2.2.1).
 *
 * Coverage:
 *   1. Golden WC order fixture maps to a Zod-valid NormalizedOrder.
 *   2. Status mapping translates WC statuses to internal estados.
 *   3. Bogotá-local order_date is YYYY-MM-DD (not UTC drift).
 *   4. Items map preserves quantity + computes unit_price from subtotal.
 *   5. Customer name + phone + email flow through to the normalized shape.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, it, expect } from "vitest";
import {
  NormalizedOrderSchema,
  NormalizedOrderItemSchema,
} from "@faka/schema";
import { WCOrderSchema } from "../../src/wordpress/client.js";
import {
  normalizeOrder,
  normalizeOrderItems,
} from "../../src/wordpress/normalize-order.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture<T = unknown>(name: string): T {
  const buf = readFileSync(
    join(__dirname, "__fixtures__", name),
    "utf-8",
  );
  return JSON.parse(buf) as T;
}

describe("normalizeOrder (WooCommerce → NormalizedOrder)", () => {
  it("produces a Zod-valid NormalizedOrder from the completed fixture", () => {
    const raw = loadFixture("wc-order-completed.json");
    const wc = WCOrderSchema.parse(raw);
    const normalized = normalizeOrder(wc);
    const parsed = NormalizedOrderSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });

  it("maps WC `completed` status to internal `pagado`", () => {
    const raw = loadFixture("wc-order-completed.json");
    const wc = WCOrderSchema.parse(raw);
    expect(normalizeOrder(wc).status).toBe("pagado");
  });

  it("uses Bogotá local calendar date for order_date (UTC-5, no DST)", () => {
    // 2026-05-13T18:14:32Z in UTC → 2026-05-13T13:14:32 in America/Bogota
    // The fixture's date_modified_gmt is 2026-05-13T18:21:05 → Bogotá date 2026-05-13.
    const raw = loadFixture("wc-order-completed.json");
    const wc = WCOrderSchema.parse(raw);
    const n = normalizeOrder(wc);
    expect(n.order_date).toBe("2026-05-13");
    expect(n.order_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("carries channel='wordpress' and external_order_id as the WC numeric id stringified", () => {
    const raw = loadFixture("wc-order-completed.json");
    const wc = WCOrderSchema.parse(raw);
    const n = normalizeOrder(wc);
    expect(n.channel).toBe("wordpress");
    expect(n.external_order_id).toBe("4321");
  });

  it("flows total/discount/shipping_cost as numbers (not strings)", () => {
    const raw = loadFixture("wc-order-completed.json");
    const wc = WCOrderSchema.parse(raw);
    const n = normalizeOrder(wc);
    expect(typeof n.total).toBe("number");
    expect(n.total).toBe(97000);
    expect(n.discount).toBe(5000);
    expect(n.shipping_cost).toBe(12000);
  });

  it("extracts billing into customer_* fields", () => {
    const raw = loadFixture("wc-order-completed.json");
    const wc = WCOrderSchema.parse(raw);
    const n = normalizeOrder(wc);
    expect(n.customer_name).toBe("María Pérez");
    expect(n.customer_phone).toBe("+57 300 1234567");
    expect(n.customer_email).toBe("maria.perez@example.com");
    expect(n.customer_city).toBe("Bogotá");
  });

  it("maps line_items into Zod-valid NormalizedOrderItem rows with unit_price", () => {
    const raw = loadFixture<{ id: number; line_items: unknown[] }>(
      "wc-order-completed.json",
    );
    const wc = WCOrderSchema.parse(raw);
    const items = normalizeOrderItems(String(wc.id), wc.line_items);
    expect(items).toHaveLength(2);
    for (const it of items) {
      const parsed = NormalizedOrderItemSchema.safeParse(it);
      expect(parsed.success).toBe(true);
    }
    // First item: subtotal=40000 / qty=2 → unit_price=20000
    expect(items[0]!.unit_price).toBe(20000);
    expect(items[0]!.quantity).toBe(2);
    expect(items[0]!.external_product_id).toBe("808");
    // Second item: subtotal=50000 / qty=1 → unit_price=50000
    expect(items[1]!.unit_price).toBe(50000);
    expect(items[1]!.line_total).toBe(50000);
  });

  it("maps known WC statuses to internal estados", () => {
    const cases: Array<[string, string]> = [
      ["completed", "pagado"],
      ["processing", "pendiente"],
      ["on-hold", "pendiente"],
      ["cancelled", "cancelado"],
      ["failed", "cancelado"],
      ["refunded", "devuelto"],
    ];
    for (const [wcStatus, expected] of cases) {
      const wc = WCOrderSchema.parse({
        id: 1,
        status: wcStatus,
        currency: "COP",
        date_modified_gmt: "2026-01-01T00:00:00",
        discount_total: "0",
        shipping_total: "0",
        total: "0",
        line_items: [],
      });
      expect(normalizeOrder(wc).status).toBe(expected);
    }
  });
});
