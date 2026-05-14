-- Migration 20260601000008 — sale_items idempotency key.
-- Phase 2 / Plan 2.3.2 (async event processor cron — raw_orders queue drainer).
--
-- The async event processor (apps/orchestrator/src/jobs/process-wp-events.ts)
-- needs to UPSERT sale_items idempotently so that re-running the cron over
-- the same `raw_orders` row produces no duplicates. RESEARCH §Pitfall 4
-- (UPSERT-on-conflict makes the latest write win) requires a unique
-- constraint on the conflict target — without one, Supabase's `.upsert()`
-- silently degrades to plain INSERT, which would duplicate every line item
-- on every retry.
--
-- Conflict target: (sale_id, external_product_id). external_product_id is
-- the channel-side identifier WC sends in the order's `line_items[].product_id`;
-- the normalizer (`normalizeOrderItems` in @faka/connectors/wordpress) writes
-- it as a stringified WC product_id. Inside one `sale_id` this is unique by
-- WC's own invariants (one line per product per order; quantity collapses
-- repeats).
--
-- Partial-index uniqueness (WHERE external_product_id IS NOT NULL) preserves
-- backwards-compat with F1 CSV-only rows where `external_product_id` may be
-- null (CSV uploads sometimes omit it). Those rows continue to land without
-- triggering the unique constraint — they just can't be re-played
-- idempotently, which is acceptable because CSV ingestion already gates on
-- (canal, external_order_id) at the sale level.
--
-- Additive + safe: no data rewrite, no row locks beyond the index build.
-- Existing rows with NULL external_product_id are excluded by the partial
-- predicate.

create unique index if not exists sale_items_sale_external_product_uidx
  on public.sale_items (sale_id, external_product_id)
  where external_product_id is not null;

comment on index public.sale_items_sale_external_product_uidx is
  'Plan 2.3.2: idempotency key for the async event processor''s sale_items '
  'UPSERT. Conflict target is (sale_id, external_product_id); partial '
  'predicate skips legacy CSV rows where external_product_id is null.';
