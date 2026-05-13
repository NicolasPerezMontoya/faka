-- Migration 0005 — FACTS layer.
-- Phase 1 / Plan 1.1.3.
--
-- The "what happened" tables. Every sale across every channel lands here
-- once normalized. master_sku and customer_id are nullable so that rows
-- can be ingested before the matching cascades (F2 product / F4 customer)
-- have a confident match.
--
-- Idempotency: UNIQUE (canal, external_order_id) is the single CONSTR-
-- idempotency-key per FND-08 / PATTERNS §5.9. Connectors UPSERT via this
-- key so retries and DLQ replays do not duplicate facts.

------------------------------------------------------------------------------
-- sales
------------------------------------------------------------------------------

create table public.sales (
  sale_id            uuid           primary key default gen_random_uuid(),
  canal              public.channel not null,
  external_order_id  text           not null,
  fecha              date           not null,
  hora               time           null,
  customer_id        uuid           null references public.customers (customer_id) on delete set null,
  subtotal           numeric(14, 2) not null default 0,
  descuento          numeric(14, 2) not null default 0,
  total              numeric(14, 2) not null default 0,
  costo_envio        numeric(14, 2) not null default 0,
  moneda             text           not null default 'COP',
  estado             text           not null default 'pagado'
                       check (estado in ('pagado', 'pendiente', 'cancelado', 'devuelto', 'parcial')),
  punto_venta_id     text           null,
  payment_method     text           null,
  customer_external_id text         null,                       -- raw id from the channel (kept for traceability)
  customer_phone     text           null,
  customer_email     text           null,
  customer_name      text           null,
  customer_city      text           null,
  notes              text           null,
  raw_payload_ref    jsonb          null,                       -- pointer back to raw_orders row id or upload_id
  upload_id          uuid           null references public.raw_csv_uploads (upload_id) on delete set null,
  created_at         timestamptz    not null default now(),
  updated_at         timestamptz    not null default now(),
  unique (canal, external_order_id)                              -- CONSTR-idempotency-key (PATTERNS §5.9)
);

create index sales_canal_fecha_idx    on public.sales (canal, fecha desc);
create index sales_fecha_idx          on public.sales (fecha desc);
create index sales_customer_idx       on public.sales (customer_id) where customer_id is not null;
create index sales_estado_idx         on public.sales (estado) where estado <> 'pagado';
create index sales_upload_idx         on public.sales (upload_id) where upload_id is not null;

------------------------------------------------------------------------------
-- sale_items
------------------------------------------------------------------------------

create table public.sale_items (
  id                 uuid           primary key default gen_random_uuid(),
  sale_id            uuid           not null references public.sales (sale_id) on delete cascade,
  master_sku         uuid           null references public.master_products (master_sku) on delete set null,
  master_variant_sku uuid           null references public.product_variants (master_variant_sku) on delete set null,
  external_sku       text           null,
  external_product_id text          null,
  product_name       text           not null,
  quantity           integer        not null check (quantity > 0),
  unit_price         numeric(14, 2) not null,
  unit_cost          numeric(14, 2) null,
  line_discount      numeric(14, 2) not null default 0,
  line_total         numeric(14, 2) not null,
  created_at         timestamptz    not null default now()
);

create index sale_items_sale_idx         on public.sale_items (sale_id);
create index sale_items_master_sku_idx   on public.sale_items (master_sku) where master_sku is not null;
create index sale_items_unmatched_idx    on public.sale_items (sale_id)    where master_sku is null;

------------------------------------------------------------------------------
-- inventory_snapshots: point-in-time stock per (master_sku, canal)
-- Populated by inventory pulls from connectors (F2+) or CSV uploads.
------------------------------------------------------------------------------

create table public.inventory_snapshots (
  id            uuid           primary key default gen_random_uuid(),
  master_sku    uuid           not null references public.master_products (master_sku) on delete cascade,
  canal         public.channel not null,
  cantidad      integer        not null check (cantidad >= 0),
  captured_at   timestamptz    not null default now(),
  unique (master_sku, canal, captured_at)
);

create index inventory_snapshots_master_canal_captured_idx
  on public.inventory_snapshots (master_sku, canal, captured_at desc);
