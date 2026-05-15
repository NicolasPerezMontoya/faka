-- Migration 20260615000006 — v_hoy_last_hour must also filter by fecha=today.
-- Phase 2.1 / hotfix.
-- Without `s.fecha = today`, any historical backfill (XLSX import, REST
-- pull with custom `since`) that inserts old sales with `created_at = now()`
-- would surface in `/hoy`'s live-feed pretending to be "fresh ML orders".
-- The semantic of the view is "today's sales with a recent landing event"
-- — both filters are required.

create or replace view public.v_hoy_last_hour
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
  and s.fecha = (now() at time zone 'America/Bogota')::date
group by s.sale_id, s.canal, s.created_at, s.total
order by s.created_at desc
limit 50;
