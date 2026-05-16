-- Migration 20260615000009 — v_unmatched_items_grouped.
-- Phase 2.1 / hotfix.
-- /matching needs a "items pendientes de mapear" section: every sale_item
-- with master_sku IS NULL grouped by (canal, external_product_id) so the
-- operator sees one row per channel-listing instead of one per sale.
-- Ordered by revenue desc so the highest-impact listings are tackled first.

create or replace view public.v_unmatched_items_grouped
  with (security_invoker = true) as
select
  s.canal,
  si.external_product_id,
  max(si.product_name)                       as product_name,
  max(si.external_sku)                       as external_sku,
  count(si.id)::bigint                       as item_count,
  count(distinct si.sale_id)::bigint         as order_count,
  coalesce(sum(si.line_total), 0)::numeric(14, 2) as revenue,
  min(s.fecha)                               as first_seen,
  max(s.fecha)                               as last_seen
from public.sale_items si
join public.sales s on s.sale_id = si.sale_id
where si.master_sku is null
  and si.external_product_id is not null
group by s.canal, si.external_product_id;

grant select on public.v_unmatched_items_grouped to authenticated;
