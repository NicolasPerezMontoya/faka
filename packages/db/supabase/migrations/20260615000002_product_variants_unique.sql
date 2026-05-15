-- Migration 20260615000002 — product_variants natural-key unique constraint.
-- Phase 2.1 / Plan 2.1.2.2.
-- Purpose: enable idempotent UPSERTs from the Mercado Libre variant mapper
-- (packages/connectors/src/mercadolibre/variant-mapper.ts) on the natural
-- key (master_sku, atributos_json).
--
-- F1's product_variants table (`20260513000004_master_layer.sql:86-94`) uses
-- a generated `master_variant_sku uuid primary key default gen_random_uuid()`
-- as the surrogate key. That's the right shape for foreign-key references
-- (e.g. sale_items.master_variant_sku) but it's USELESS as an UPSERT conflict
-- target — the surrogate key is freshly minted on every insert. ML needs to
-- write "this color/talla combination for this master product" idempotently,
-- which is exactly what the natural key gives us.
--
-- ADDITIVE — does not break F1's CSV connector. CSV doesn't write
-- product_variants today (variants come from ML/WC later); when F2 backfills
-- variants from WC, the same unique constraint applies and CSV remains
-- agnostic.
--
-- Per-variant cost data is stashed inline under `atributos_json.__pricing`
-- (FLAGGED in PATTERNS §5 as deferrable — F1 product_variants intentionally
-- has no dedicated cost column in v1). The fingerprint logic in
-- variant-mapper.ts FILTERS reserved `__*` keys, so cost-data changes don't
-- cause variant duplication on UPSERT.
--
-- After this migration applies, regenerate `packages/db/src/database.ts`
-- via the standard `pnpm --filter @faka/db gen` flow (the CI artifact path
-- introduced in commit 50baf83).

alter table public.product_variants
  add constraint product_variants_master_sku_atributos_unique
  unique (master_sku, atributos_json);

comment on constraint product_variants_master_sku_atributos_unique
  on public.product_variants is
  'F2.1: natural-key uniqueness for idempotent variant UPSERTs from ML';
