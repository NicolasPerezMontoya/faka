/**
 * Plan 2.1.4.1 — exhaustive state-mapper coverage.
 *
 * Wave 1 (`state-mapper.test.ts`) shipped the baseline matrix + cancel-detail
 * preservation. This file is the Wave 4 *exhaustive* layer: a single source of
 * truth for the documented status set, defensive defaults, fixture
 * cross-checks, and the pure-function contract. It exists alongside the W1
 * file so a regression in either layer surfaces independently — duplicating
 * the input table by hand would silently mask a typo.
 *
 * Coverage requirements (Plan 2.1.4.1):
 *   1. All 9 documented ML statuses → internal `sales.estado` (matrix-driven
 *      over `ML_STATUS_MAP` itself, so an accidentally-dropped key is caught).
 *   2. Defensive default `pendiente` for unknown statuses (empty string,
 *      uppercase variant, whitespace, garbage tokens, numeric-like inputs).
 *   3. Fixture cross-check — `ml-order-paid.json` → `pagado`,
 *      `ml-order-cancelled-seller.json` → `cancelado`.
 *   4. `cancel_detail` semantics for the two cases we ship a fixture for:
 *      - `seller_cancelled` (the cancelled-seller fixture) preserves the
 *        seller-cancelled signal alongside the `cancelado` estado.
 *      - `paid` fixture has `cancel_detail: null` → returns null.
 *   5. `refunded` status → `devuelto` (full refund). `partially_refunded` →
 *      `parcial` (partial). These are the two "money came back" rows F1
 *      finance reports rely on.
 *   6. Purity invariant — `mapMLStatus("paid")` called 1000 times produces
 *      identical output (no hidden state, no async, no Date-dependent
 *      branching).
 *
 * Anti-duplication: this file IMPORTS the production map and iterates over
 * its entries, rather than re-declaring the table. If you ever need to add a
 * new ML status, ONLY edit `state-mapper.ts`; both this test and W1's table
 * pick it up automatically (W1 also iterates; W4 iterates the map).
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
// (1) Documented-status matrix — every key in ML_STATUS_MAP round-trips.
// -----------------------------------------------------------------------------
//
// The matrix is the production map itself. If state-mapper.ts ships a new key
// without a partner test row, vitest still validates it here (since we're
// asserting the mapper returns the map's right-hand value for every key).

describe("Plan 2.1.4.1 — exhaustive state-mapper", () => {
  describe("documented ML statuses (matrix over ML_STATUS_MAP)", () => {
    // Expected count from RESEARCH §State Mapping — the nine documented
    // statuses we observe in the wild. If this count drifts, either the
    // research changed (update both this assertion and ML_STATUS_MAP) or a
    // typo dropped a row.
    it("has exactly 9 documented status keys", () => {
      expect(Object.keys(ML_STATUS_MAP).length).toBe(9);
    });

    for (const [mlStatus, expected] of Object.entries(ML_STATUS_MAP)) {
      it(`maps "${mlStatus}" → "${expected}"`, () => {
        expect(mapMLStatus(mlStatus)).toBe(expected);
      });
    }

    // RHS membership — the F1 sales.estado CHECK constraint accepts exactly
    // five values. A typo on the right hand side (e.g. `pagada` instead of
    // `pagado`) would brick every INSERT once the cron persists; catching it
    // here avoids a production migration violation.
    it("every map value is a member of the sales.estado CHECK set", () => {
      const allowed = new Set<SalesEstado>([
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

  // ---------------------------------------------------------------------------
  // (2) Defensive defaults — unknown / malformed inputs collapse to "pendiente".
  // ---------------------------------------------------------------------------

  describe("defensive default — unknown statuses", () => {
    const UNKNOWN_CASES: ReadonlyArray<string> = [
      "",
      " ",
      "PAID", // case-sensitive intentional (ML statuses are lowercase)
      "Paid", // mixed-case variant
      "weird_future_status",
      "definitely_not_a_status",
      "12345",
      "null",
      "undefined",
      "in_progress", // close to "payment_in_process" but not a key
      "delivered", // shipment status, not order status (RESEARCH §State Mapping orthogonality)
      "approved", // payment status, not order status (RESEARCH §Pitfall 11)
    ];

    for (const bad of UNKNOWN_CASES) {
      it(`defaults "${bad}" → "pendiente" (no throw)`, () => {
        expect(() => mapMLStatus(bad)).not.toThrow();
        expect(mapMLStatus(bad)).toBe("pendiente");
      });
    }
  });

  // ---------------------------------------------------------------------------
  // (3) Money-back invariants — refunded vs partially_refunded.
  // ---------------------------------------------------------------------------
  //
  // Confusingly, ML's `refunded` (full) maps to F1's `devuelto`, while
  // `partially_refunded` (partial) maps to `parcial`. Finance reports rely on
  // this disambiguation — collapsing both to one bucket would erase the
  // partial-vs-full refund signal. Anchor the invariant here.

  describe("money-back disambiguation", () => {
    it('"refunded" (full) → "devuelto"', () => {
      expect(mapMLStatus("refunded")).toBe("devuelto");
    });

    it('"partially_refunded" (partial) → "parcial"', () => {
      expect(mapMLStatus("partially_refunded")).toBe("parcial");
    });

    it("the two are NEVER the same internal estado", () => {
      expect(mapMLStatus("refunded")).not.toBe(mapMLStatus("partially_refunded"));
    });
  });

  // ---------------------------------------------------------------------------
  // (4) Fixture cross-checks — production fixtures map end-to-end.
  // ---------------------------------------------------------------------------

  describe("fixture cross-checks", () => {
    it("ml-order-paid.json → pagado + null cancel_detail", () => {
      const order = orderPaid as unknown as MLOrder;
      expect(order.status).toBe("paid");
      expect(mapMLStatus(order.status)).toBe("pagado");
      expect(preserveCancellationDetail(order)).toBeNull();
    });

    it("ml-order-cancelled-seller.json → cancelado + seller_cancelled preserved", () => {
      const order = orderCancelled as unknown as MLOrder;
      expect(order.status).toBe("cancelled");
      expect(mapMLStatus(order.status)).toBe("cancelado");
      // PRESERVATION INVARIANT (RESEARCH §Pitfall 6): cancel_detail flows
      // through verbatim. Collapsing it would erase the buyer-vs-seller
      // signal finance needs for chargeback-risk reports.
      expect(preserveCancellationDetail(order)).toBe("seller_cancelled");
    });

    it("a synthetic cancelled order with no cancel_detail returns null", () => {
      // Defensive — some legacy ML deliveries omit cancel_detail entirely
      // (RESEARCH §Pitfall 6 corollary). The preservation helper MUST NOT
      // throw on missing keys.
      const synth = {
        ...(orderCancelled as unknown as MLOrder),
        cancel_detail: null,
      };
      expect(mapMLStatus(synth.status)).toBe("cancelado");
      expect(preserveCancellationDetail(synth)).toBeNull();
    });

    it("a synthetic order with cancel_detail key absent returns null", () => {
      const synth = { ...(orderCancelled as unknown as MLOrder) };
      delete (synth as { cancel_detail?: string | null }).cancel_detail;
      expect(preserveCancellationDetail(synth)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // (5) Purity invariant — no state, no async, no clock-dependent branching.
  // ---------------------------------------------------------------------------
  //
  // PATTERNS §"Pure-function normalizer envelope" — `mapMLStatus` is a
  // single-arg pure function. Calling it many times in succession produces
  // the same output; this guards against an accidental refactor introducing
  // a Date.now() or random-id-tagged branch (both of which are real
  // mistakes I have seen in mappers that grew "feature flags").

  describe("purity", () => {
    it("mapMLStatus is referentially transparent over 1000 calls", () => {
      const samples = ["paid", "cancelled", "refunded", "unknown_x", ""];
      for (const s of samples) {
        const first = mapMLStatus(s);
        for (let i = 0; i < 1000; i++) {
          expect(mapMLStatus(s)).toBe(first);
        }
      }
    });

    it("mapMLStatus signature is single-arg (no supabase overload)", () => {
      // Compile-time check would be ideal, but TS strips at runtime — assert
      // the function arity instead. If a future PR adds a second parameter
      // (e.g. `mapMLStatus(status, supabase)`), this test fails loud.
      expect(mapMLStatus.length).toBe(1);
    });

    it("preserveCancellationDetail signature is single-arg (order only)", () => {
      expect(preserveCancellationDetail.length).toBe(1);
    });
  });
});
