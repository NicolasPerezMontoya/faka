-- Migration 20260601000006 — product_mappings metadata.
-- Phase 2 / Plan 2.2.5 (matching cascade orchestrator).
--
-- Adds `last_arbitrated_at timestamptz` to `public.product_mappings` so the
-- validation queue UI (Plan 2.4.x) can show operators "last reviewed by AI"
-- per mapping. The cascade orchestrator (`persistMatch` in
-- packages/connectors/src/matching/persist.ts) writes `now()` to this column
-- on every UPSERT into `product_mappings`.
--
-- Why a new column instead of overloading `updated_at`?
--   - `updated_at` already moves whenever any field changes — including a
--     human flipping `validado_humano` from the queue UI. We need a column
--     that tracks ONLY cascade activity so the UI can distinguish "system
--     last re-arbitrated this on Tuesday" from "Carlos validated this
--     yesterday".
--   - Future re-cascade-unmatched cron (Plan 2.3.4) uses this column to
--     decide which rows are stale enough to re-run through the cascade.
--
-- Additive: nullable, no default required (cascade writes the value on
-- every UPSERT; pre-2.2.5 rows simply have NULL until they're re-matched).

alter table public.product_mappings
  add column if not exists last_arbitrated_at timestamptz null;

comment on column public.product_mappings.last_arbitrated_at is
  'When the cascade last persisted this mapping (Plan 2.2.5). NULL for rows '
  'created before the cascade orchestrator landed, or for rows touched only '
  'by human validation (the validation route updates validated_at, not this).';

-- Partial index for the `re-cascade-unmatched` cron (Plan 2.3.4) — it scans
-- unvalidated rows ordered by oldest-arbitration first. Putting the index
-- here keeps the cron's hot path indexed without a separate migration later.
create index if not exists product_mappings_stale_cascade_idx
  on public.product_mappings (last_arbitrated_at)
  where validado_humano = false;
