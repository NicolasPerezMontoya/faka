-- Migration 20260615000007 — promote sale_items unique index from partial to full.
-- Phase 2.1 / hotfix.
-- The pre-existing partial unique index (WHERE external_product_id IS NOT NULL)
-- breaks INSERT ... ON CONFLICT (sale_id, external_product_id) because Postgres
-- requires an index_predicate hint to target a partial index, and supabase-js
-- has no way to pass that hint. Result: the sync-ml-orders cron fails every
-- order with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" → 0 sale_items land.
--
-- Dropping the partial predicate is safe: Postgres treats NULL as DISTINCT in
-- unique indexes by default, so the CSV-uploads use-case (NULL external_product_id)
-- still allows multiple rows per sale without conflict.

drop index if exists public.sale_items_sale_external_product_uidx;

create unique index sale_items_sale_external_product_uidx
  on public.sale_items (sale_id, external_product_id);
