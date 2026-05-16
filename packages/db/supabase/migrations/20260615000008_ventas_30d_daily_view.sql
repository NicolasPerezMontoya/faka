-- Migration 20260615000008 — v_ventas_30d_daily.
-- Phase 2.1 / hotfix.
-- Trend chart on /hoy + summary widget on /ventas. Aggregates the last 30
-- calendar days of sales (excluding cancelados/devueltos) into per-day rows.
-- Days with no sales are NOT in the view — the consumer fills gaps client-side.
--
-- SECURITY INVOKER so the role-scoped Supabase client (Postgres RLS) gates
-- access; same pattern as the v_hoy_* views.

create or replace view public.v_ventas_30d_daily
  with (security_invoker = true) as
select
  s.fecha,
  s.canal,
  count(distinct s.sale_id)::bigint                  as ordenes,
  coalesce(sum(si.line_total), 0)::numeric(14, 2)    as ingresos,
  coalesce(sum(si.quantity), 0)::bigint              as unidades
from public.sales s
left join public.sale_items si on si.sale_id = s.sale_id
where s.fecha >= ((now() at time zone 'America/Bogota')::date - interval '29 days')
  and s.fecha <= (now() at time zone 'America/Bogota')::date
  and s.estado in ('pagado', 'pendiente', 'parcial')
group by s.fecha, s.canal
order by s.fecha asc;

grant select on public.v_ventas_30d_daily to authenticated;
