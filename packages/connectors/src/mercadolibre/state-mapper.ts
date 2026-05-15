/**
 * Mercado Libre order status → internal `sales.estado` mapper (Plan 2.1.1.3).
 *
 * Pure functions only — no `supabase` parameter, no side effects, no
 * raised errors. Mirrors the WordPress connector's mapper shape
 * (`packages/connectors/src/wordpress/normalize-order.ts:17-25`) so the
 * cron-side normalizer wiring stays uniform across channels.
 *
 * ── Source-of-truth invariants ───────────────────────────────────────────────
 *
 * (a) `cancellation_detail` preservation (RESEARCH §State Mapping +
 *     §Pitfall 6): ML's `order.cancel_detail` carries the buyer-vs-seller
 *     cancellation reason. Collapsing every cancellation to `cancelado`
 *     erases that signal — finance reports lose the ability to distinguish
 *     buyer-initiated cancellations (chargeback risk) from seller-initiated
 *     ones (stock-out signal). The mapping itself maps to `cancelado`, but
 *     the caller MUST also call `preserveCancellationDetail(order)` and
 *     persist the result into `sales.notes`.
 *
 * (b) Shipment status orthogonality: `sales.estado` tracks PAYMENT state,
 *     NOT logistics. `paid` + `shipment.status=delivered` and `paid` +
 *     `shipment.status=pending` both map to `pagado`. Logistics state
 *     belongs in `inventory_snapshots` / shipment-tracking tables (out of
 *     F2.1 scope).
 *
 * (c) `payments[]` array recency-vs-creation-order trap (RESEARCH §Pitfall
 *     11): ML's `order.payments` is NOT sorted by recency. Use
 *     `order.status` as the authoritative payment-state signal — NEVER
 *     `order.payments[0].status` (the first array element is often the
 *     oldest, not the most recent).
 *
 * (d) Partial refunds: ML emits `partially_refunded` when SOME of the order
 *     was refunded after `paid`. We map this to the F1 `parcial` estado
 *     (migration 0005 check constraint includes it). `refunded` (full)
 *     maps to `devuelto`.
 *
 * (e) Unknown statuses: default to `pendiente`. NEVER raise — partial-batch
 *     resilience invariant from PATTERNS §"Pure-function normalizer
 *     envelope". The caller logs the unknown status via the cron's
 *     `connector_runs.errors_json` aggregator instead.
 *
 * F1 contract: `sales.estado` CHECK constraint at
 * `packages/db/supabase/migrations/20260513000005_facts_layer.sql:29-30`
 * permits exactly five values:
 *   ('pagado', 'pendiente', 'cancelado', 'devuelto', 'parcial')
 * The map's right-hand side MUST be a subset of those.
 */

import type { MLOrder } from "./types.js";

/**
 * Local mirror of the F1 `sales.estado` check-constraint enum. Kept local
 * because there's no `SalesEstado` export anywhere yet (the F1 codegen
 * surfaces this column as `string`); promoting it to `@faka/schema` would
 * be a cross-cutting refactor outside Wave 1's scope.
 */
export type SalesEstado =
  | "pagado"
  | "pendiente"
  | "cancelado"
  | "devuelto"
  | "parcial";

/**
 * Verified table from RESEARCH §State Mapping — derived from the official
 * Mercado Libre "Manage Sales" documentation. The nine documented statuses
 * we observe in the wild are all enumerated here; anything else collapses
 * to `pendiente` via the lookup default below.
 *
 * RIGHT-HAND-SIDE INVARIANT: every value must be in the F1 check constraint
 * set. If you add a key whose target is not in
 * (pagado, pendiente, cancelado, devuelto, parcial), the next migration's
 * INSERT will violate the constraint.
 */
export const ML_STATUS_MAP: Record<string, SalesEstado> = {
  paid: "pagado",
  confirmed: "pendiente",
  payment_required: "pendiente",
  payment_in_process: "pendiente",
  partially_paid: "parcial",
  partially_refunded: "parcial",
  cancelled: "cancelado",
  invalid: "cancelado",
  refunded: "devuelto",
};

/**
 * Pure lookup with a `pendiente` default (RESEARCH §State Mapping defensive
 * fallback). Never raises.
 *
 * The single-arg signature is intentional: callers that need to vary
 * behavior on `cancellation_detail` should call
 * `preserveCancellationDetail` separately. Two pure functions compose
 * cleaner than one parameter-overloaded function.
 */
export function mapMLStatus(mlStatus: string): SalesEstado {
  return ML_STATUS_MAP[mlStatus] ?? "pendiente";
}

/**
 * Preserve ML's `cancel_detail` for `sales.notes`.
 *
 * Returns the raw string or `null` (never undefined — `sales.notes` accepts
 * NULL). Callers MUST drop the return value into `sales.notes` whenever
 * `mapMLStatus(order.status) === "cancelado"`; otherwise the buyer-vs-seller
 * signal is lost (RESEARCH §Pitfall 6).
 *
 * Implementation is a pass-through today — but as a dedicated helper it:
 *   (a) anchors the invariant in one place,
 *   (b) gives us a stable hook to add normalization later (e.g. coalescing
 *       `seller_cancelled` and `seller_canceled` spelling variants), and
 *   (c) makes the rule grep-discoverable (the call site reads
 *       `preserveCancellationDetail(order)` instead of
 *       `order.cancel_detail ?? null`, which a reviewer might delete as
 *       redundant).
 */
export function preserveCancellationDetail(order: MLOrder): string | null {
  return order.cancel_detail ?? null;
}
