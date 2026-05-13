-- Migration 0012 — Grants on per-role views (column-level enforcement).
-- Phase 1 / Plan 1.1.6.
--
-- After this migration:
--   * Base tables: authenticated has SELECT only (so SECURITY INVOKER
--     views can read them). No INSERT/UPDATE/DELETE for authenticated;
--     mutations always run with service-role from Server Actions.
--   * Views: authenticated has SELECT. Server-side code chooses which
--     view to read based on current_role_claim().
--
-- IMPORTANT: We do NOT split grants by role here (Postgres can't grant
-- a view to "everyone whose JWT role is X"). Instead, the application
-- layer in apps/dashboard chooses the right view name from the JWT
-- before issuing the query. The view's SECURITY INVOKER + RLS combo
-- ensures the projection is the only data the user can see.
--
-- Three layers of defense (RESEARCH §3 + Pitfall 1 + this migration):
--   1. RLS on base tables (migration 0010).
--   2. SECURITY INVOKER on every view (migration 0011).
--   3. Application chooses view name from JWT (apps/dashboard + middleware).

------------------------------------------------------------------------------
-- sales views
------------------------------------------------------------------------------

grant select on public.sales_view_admin     to authenticated;
grant select on public.sales_view_manager   to authenticated;
grant select on public.sales_view_analista  to authenticated;

------------------------------------------------------------------------------
-- sale_items views
------------------------------------------------------------------------------

grant select on public.sale_items_view_admin     to authenticated;
grant select on public.sale_items_view_manager   to authenticated;
grant select on public.sale_items_view_analista  to authenticated;

------------------------------------------------------------------------------
-- customers views (Mini-CRM)
------------------------------------------------------------------------------

grant select on public.customers_view_admin     to authenticated;
grant select on public.customers_view_manager   to authenticated;
grant select on public.customers_view_analista  to authenticated;

grant select on public.customer_external_links_view_admin    to authenticated;
grant select on public.customer_external_links_view_manager  to authenticated;
grant select on public.customer_external_links_view_analista to authenticated;

grant select on public.customer_merge_log_view_admin     to authenticated;
grant select on public.customer_merge_log_view_manager   to authenticated;
grant select on public.customer_merge_log_view_analista  to authenticated;

------------------------------------------------------------------------------
-- mart views
------------------------------------------------------------------------------

grant select on public.mart_cannibalization_view_admin     to authenticated;
grant select on public.mart_cannibalization_view_manager   to authenticated;
grant select on public.mart_cannibalization_view_analista  to authenticated;

------------------------------------------------------------------------------
-- audit_log view (Super Admin + own-row Admin only)
------------------------------------------------------------------------------

grant select on public.audit_log_view_admin to authenticated;
