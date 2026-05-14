-- Migration 20260601000002 — Hoy views.
-- Phase 2 / Plan 2.1.2.
-- Purpose: 5 SECURITY INVOKER aggregate views powering the "Hoy"
-- dashboard (totals, per-channel, per-channel analista-redacted,
-- top-products, last-hour realtime feed).
-- Invariant CC-12: every view declares `with (security_invoker = true)`.
-- Invariant: timezone is America/Bogota; sales.fecha is already
-- date-typed (migration 0005).

-- Totals for today: total ingresos, units sold, distinct orders.
-- Excludes cancelado/devuelto (only pagado/pendiente/parcial count).
create view public.v_hoy_totals
  with (security_invoker = true) as
select
  coalesce(sum(si.line_total), 0)::numeric(14, 2) as ingresos_hoy,
  coalesce(sum(si.quantity), 0)::bigint           as unidades_hoy,
  count(distinct s.sale_id)::bigint               as ordenes_hoy
from public.sales s
left join public.sale_items si on si.sale_id = s.sale_id
where s.fecha = (now() at time zone 'America/Bogota')::date
  and s.estado in ('pagado', 'pendiente', 'parcial');

-- Per-channel breakdown for today's bar chart.
create view public.v_hoy_per_channel
  with (security_invoker = true) as
select
  s.canal,
  count(distinct s.sale_id)::bigint               as ordenes,
  coalesce(sum(si.line_total), 0)::numeric(14, 2) as ingresos
from public.sales s
left join public.sale_items si on si.sale_id = s.sale_id
where s.fecha = (now() at time zone 'America/Bogota')::date
  and s.estado in ('pagado', 'pendiente', 'parcial')
group by s.canal
order by ingresos desc;

-- Analista variant: same per-channel breakdown but money columns
-- redacted to NULL. The dashboard's <PerChannelChart> Server
-- Component reads this view when role == 'analista' (ADR-002).
create view public.v_hoy_per_channel_analista
  with (security_invoker = true) as
select
  s.canal,
  count(distinct s.sale_id)::bigint as ordenes,
  null::numeric(14, 2)              as ingresos
from public.sales s
where s.fecha = (now() at time zone 'America/Bogota')::date
  and s.estado in ('pagado', 'pendiente', 'parcial')
group by s.canal
order by ordenes desc;

-- Top 10 products for today by ingresos. Filtered to matched items
-- only (master_sku is not null) — unmatched go to the validation
-- queue, not the top-10.
create view public.v_hoy_top_products
  with (security_invoker = true) as
select
  mp.master_sku,
  mp.nombre_canonico,
  mp.brand,
  sum(si.quantity)::bigint                      as unidades,
  sum(si.line_total)::numeric(14, 2)            as ingresos,
  count(distinct s.sale_id)::bigint             as ordenes
from public.sale_items si
join public.sales s         on s.sale_id = si.sale_id
join public.master_products mp on mp.master_sku = si.master_sku
where s.fecha = (now() at time zone 'America/Bogota')::date
  and s.estado in ('pagado', 'pendiente', 'parcial')
  and si.master_sku is not null
group by mp.master_sku, mp.nombre_canonico, mp.brand
order by ingresos desc
limit 10;

-- Last-hour realtime feed: 50 most recent sales rows from the past
-- hour. Used by the SSR initial render; subsequent updates stream
-- via Supabase Realtime (postgres_changes on sales).
create view public.v_hoy_last_hour
  with (security_invoker = true) as
select
  s.sale_id,
  s.canal,
  s.created_at,
  s.total,
  coalesce(sum(si.quantity), 0)::bigint as item_count
from public.sales s
left join public.sale_items si on si.sale_id = s.sale_id
where s.created_at >= now() - interval '1 hour'
group by s.sale_id, s.canal, s.created_at, s.total
order by s.created_at desc
limit 50;

grant select on
  public.v_hoy_totals,
  public.v_hoy_per_channel,
  public.v_hoy_per_channel_analista,
  public.v_hoy_top_products,
  public.v_hoy_last_hour
to authenticated;
