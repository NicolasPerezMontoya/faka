-- Migration 0011 — Per-role SECURITY INVOKER views (ADR-002 LOCKED).
-- Phase 1 / Plan 1.1.6.
--
-- RESEARCH Pitfall 1 — MANDATORY: every view has `with (security_invoker = true)`.
-- Without it, SECURITY DEFINER semantics bypass RLS on the base table and
-- Analista would see everything.
--
-- ADR-002 matrix:
--   Super Admin / Admin:  see all columns
--   Manager:              hides customer columns + Mini-CRM tables
--   Analista:             hides customer columns + Mini-CRM + $ columns
--
-- View pattern: one view per (table, role). Application reads the right
-- view based on the JWT role claim (current_role_claim() helper).

------------------------------------------------------------------------------
-- sales views
------------------------------------------------------------------------------

create view public.sales_view_admin
  with (security_invoker = true) as
  select
    sale_id, canal, external_order_id, fecha, hora, customer_id,
    subtotal, descuento, total, costo_envio, moneda, estado,
    punto_venta_id, payment_method,
    customer_external_id, customer_phone, customer_email,
    customer_name, customer_city, notes,
    raw_payload_ref, upload_id, created_at, updated_at
  from public.sales;

-- Manager: drop customer-identifying columns; $ columns visible.
create view public.sales_view_manager
  with (security_invoker = true) as
  select
    sale_id, canal, external_order_id, fecha, hora,
    null::uuid as customer_id,
    subtotal, descuento, total, costo_envio, moneda, estado,
    punto_venta_id, payment_method,
    null::text as customer_external_id,
    null::text as customer_phone,
    null::text as customer_email,
    null::text as customer_name,
    null::text as customer_city,
    null::text as notes,
    raw_payload_ref, upload_id, created_at, updated_at
  from public.sales;

-- Analista: drop customer columns AND $ columns.
create view public.sales_view_analista
  with (security_invoker = true) as
  select
    sale_id, canal, external_order_id, fecha, hora,
    null::uuid    as customer_id,
    null::numeric as subtotal,
    null::numeric as descuento,
    null::numeric as total,
    null::numeric as costo_envio,
    moneda, estado, punto_venta_id, payment_method,
    null::text    as customer_external_id,
    null::text    as customer_phone,
    null::text    as customer_email,
    null::text    as customer_name,
    null::text    as customer_city,
    null::text    as notes,
    raw_payload_ref, upload_id, created_at, updated_at
  from public.sales;

------------------------------------------------------------------------------
-- sale_items views
------------------------------------------------------------------------------

create view public.sale_items_view_admin
  with (security_invoker = true) as
  select * from public.sale_items;

create view public.sale_items_view_manager
  with (security_invoker = true) as
  select
    id, sale_id, master_sku, master_variant_sku,
    external_sku, external_product_id, product_name,
    quantity, unit_price, unit_cost, line_discount, line_total,
    created_at
  from public.sale_items;

-- Analista: drop unit_price / unit_cost / line_discount / line_total ($).
create view public.sale_items_view_analista
  with (security_invoker = true) as
  select
    id, sale_id, master_sku, master_variant_sku,
    external_sku, external_product_id, product_name,
    quantity,
    null::numeric as unit_price,
    null::numeric as unit_cost,
    null::numeric as line_discount,
    null::numeric as line_total,
    created_at
  from public.sale_items;

------------------------------------------------------------------------------
-- customers views — ADR-004:67-69. Manager + Analista cannot see Mini-CRM.
-- Return zero rows for those roles; admins see everything.
------------------------------------------------------------------------------

create view public.customers_view_admin
  with (security_invoker = true) as
  select * from public.customers;

create view public.customers_view_manager
  with (security_invoker = true) as
  select * from public.customers where false;       -- zero rows

create view public.customers_view_analista
  with (security_invoker = true) as
  select * from public.customers where false;       -- zero rows

------------------------------------------------------------------------------
-- customer_external_links views
------------------------------------------------------------------------------

create view public.customer_external_links_view_admin
  with (security_invoker = true) as
  select * from public.customer_external_links;

create view public.customer_external_links_view_manager
  with (security_invoker = true) as
  select * from public.customer_external_links where false;

create view public.customer_external_links_view_analista
  with (security_invoker = true) as
  select * from public.customer_external_links where false;

------------------------------------------------------------------------------
-- customer_merge_log views
------------------------------------------------------------------------------

create view public.customer_merge_log_view_admin
  with (security_invoker = true) as
  select * from public.customer_merge_log;

create view public.customer_merge_log_view_manager
  with (security_invoker = true) as
  select * from public.customer_merge_log where false;

create view public.customer_merge_log_view_analista
  with (security_invoker = true) as
  select * from public.customer_merge_log where false;

------------------------------------------------------------------------------
-- mart_cannibalization views — references customer_id, so Manager/Analista
-- should see this aggregated WITHOUT customer_id.
------------------------------------------------------------------------------

create view public.mart_cannibalization_view_admin
  with (security_invoker = true) as
  select * from public.mart_cannibalization;

create view public.mart_cannibalization_view_manager
  with (security_invoker = true) as
  select null::uuid as customer_id, master_sku, canales, ventana,
         total_compras, refreshed_at
  from public.mart_cannibalization;

create view public.mart_cannibalization_view_analista
  with (security_invoker = true) as
  select null::uuid as customer_id, master_sku, canales, ventana,
         null::integer as total_compras, refreshed_at
  from public.mart_cannibalization;

------------------------------------------------------------------------------
-- audit_log views — Super Admin sees all; Admin sees only their own
-- actions; Manager/Analista cannot see audit_log at all (handled in grants).
------------------------------------------------------------------------------

create view public.audit_log_view_admin
  with (security_invoker = true) as
  select * from public.audit_log
  where current_role_claim() = 'super_admin'
     or (current_role_claim() = 'admin' and user_id = auth.uid());
