/**
 * Tests for state-mapper.ts (Plan 2.1.1.3).
 *
 * Exhaustive table-driven coverage of the nine documented ML statuses plus
 * the defensive default. Also verifies the cancel_detail preservation
 * helper (RESEARCH §Pitfall 6).
 */

import { describe, it, expect } from "vitest";
import {
  ML_STATUS_MAP,
  mapMLStatus,
  preserveCancellationDetail,
  type SalesEstado,
} from "../../src/mercadolibre/state-mapper.js";
import type { MLOrder } from "../../src/mercadolibre/types.js";
import orderPaid from "../__fixtures__/ml-order-paid.json";
import orderCancelled from "../__fixtures__/ml-order-cancelled-seller.json";

// -----------------------------------------------------------------------------
// Table-driven cases (RESEARCH §State Mapping table)
// -----------------------------------------------------------------------------

const CASES: ReadonlyArray<readonly [string, SalesEstado]> = [
  ["paid", "pagado"],
  ["confirmed", "pendiente"],
  ["payment_required", "pendiente"],
  ["payment_in_process", "pendiente"],
  ["partially_paid", "parcial"],
  ["partially_refunded", "parcial"],
  ["cancelled", "cancelado"],
  ["invalid", "cancelado"],
  ["refunded", "devuelto"],
] as const;

describe("ML_STATUS_MAP / mapMLStatus", () => {
  for (const [mlStatus, internal] of CASES) {
    it(`maps "${mlStatus}" → "${internal}"`, () => {
      expect(mapMLStatus(mlStatus)).toBe(internal);
      expect(ML_STATUS_MAP[mlStatus]).toBe(internal);
    });
  }

  it('defaults to "pendiente" on unknown / unmapped status (never throws)', () => {
    expect(mapMLStatus("unknown_status_x")).toBe("pendiente");
    expect(mapMLStatus("")).toBe("pendiente");
    expect(mapMLStatus("PAID")).toBe("pendiente"); // case-sensitive (intentional)
  });

  it("all map values are members of the F1 sales.estado check-constraint set", () => {
    const allowed: ReadonlySet<SalesEstado> = new Set<SalesEstado>([
      "pagado",
      "pendiente",
      "cancelado",
      "devuelto",
      "parcial",
    ]);
    for (const value of Object.values(ML_STATUS_MAP)) {
      expect(allowed.has(value)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Cancel-detail preservation (RESEARCH §Pitfall 6)
// -----------------------------------------------------------------------------

describe("preserveCancellationDetail", () => {
  it("returns the raw cancel_detail when present", () => {
    const detail = preserveCancellationDetail(orderCancelled as unknown as MLOrder);
    expect(detail).toBe("seller_cancelled");
  });

  it("returns null for non-cancelled orders (no cancel_detail field)", () => {
    expect(preserveCancellationDetail(orderPaid as unknown as MLOrder)).toBeNull();
  });

  it("returns null for explicit null cancel_detail", () => {
    const synth = { ...(orderPaid as unknown as MLOrder), cancel_detail: null };
    expect(preserveCancellationDetail(synth)).toBeNull();
  });

  it("survives missing cancel_detail key entirely", () => {
    const synth = { ...(orderPaid as unknown as MLOrder) };
    delete (synth as { cancel_detail?: string | null }).cancel_detail;
    expect(preserveCancellationDetail(synth)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Fixture cross-check — the cancelled-seller fixture maps end-to-end.
// -----------------------------------------------------------------------------

describe("fixture cross-check", () => {
  it("ml-order-cancelled-seller.json → cancelado + seller_cancelled preserved", () => {
    const order = orderCancelled as unknown as MLOrder;
    expect(mapMLStatus(order.status)).toBe("cancelado");
    expect(preserveCancellationDetail(order)).toBe("seller_cancelled");
  });

  it("ml-order-paid.json → pagado + null cancel_detail", () => {
    const order = orderPaid as unknown as MLOrder;
    expect(mapMLStatus(order.status)).toBe("pagado");
    expect(preserveCancellationDetail(order)).toBeNull();
  });
});
