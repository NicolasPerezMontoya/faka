-- Migration 0006 — MARTS skeleton.
-- Phase 1 / Plan 1.1.4.
--
-- Empty mart tables. Populated by Postgres functions/views in F2 (basic),
-- F4 (advanced), and F5.5 (chat queries). F1 only creates the shapes so
-- the dashboard can target them in development without errors.
--
-- Every mart has refreshed_at so the dashboard can show staleness and
-- the refresh job can decide whether to recompute.

create table public.mart_top_products_by_window (
  master_sku   uuid         not null references public.master_products (master_sku) on delete cascade,
  ventana      text         not null check (ventana in ('day', 'week', 'month', 'quarter')),
  ranking      integer      not null check (ranking > 0),
  unidades     integer      not null default 0,
  ingresos     numeric(14, 2) not null default 0,
  score        numeric      not null default 0,
  computed_at  date         not null,
  refreshed_at timestamptz  not null default now(),
  primary key (ventana, ranking, computed_at)
);

create index mart_top_products_master_idx
  on public.mart_top_products_by_window (master_sku, ventana, computed_at desc);

create table public.mart_channel_performance (
  canal          public.channel not null,
  mes            date           not null,                          -- first day of month
  ingresos       numeric(14, 2) not null default 0,
  num_ordenes    integer        not null default 0,
  ticket_promedio numeric(14, 2) not null default 0,
  margen_est     numeric(14, 2) null,
  growth_pct     numeric(7, 2)  null,
  refreshed_at   timestamptz    not null default now(),
  primary key (canal, mes)
);

create table public.mart_product_velocity (
  master_sku    uuid         not null references public.master_products (master_sku) on delete cascade,
  ventana       text         not null check (ventana in ('d7', 'd30', 'd90')),
  unidades      integer      not null default 0,
  unidades_dia  numeric(10, 2) not null default 0,
  tendencia     text         null check (tendencia in ('aceleracion', 'estable', 'declive')),
  refreshed_at  timestamptz  not null default now(),
  primary key (master_sku, ventana)
);

-- Cliente Bloque K + J: el caso de uso #1 del negocio. dead_stock subido
-- de [v2] a MVP per PROJECT.md key decision (2026-05-13).
create table public.mart_dead_stock (
  master_sku        uuid         not null references public.master_products (master_sku) on delete cascade,
  dias_sin_venta    integer      not null,
  stock_actual      integer      not null,
  ultimo_movimiento date         null,
  promotion_score   numeric(4, 3) null,
  razon             text         null,
  refreshed_at      timestamptz  not null default now(),
  primary key (master_sku)
);

create index mart_dead_stock_dias_idx on public.mart_dead_stock (dias_sin_venta desc);

create table public.mart_days_of_inventory (
  master_sku           uuid         not null references public.master_products (master_sku) on delete cascade,
  canal                public.channel null,                         -- null = consolidated
  dias_inventario      numeric(10, 2) not null,
  stock_actual         integer      not null,
  unidades_dia_avg     numeric(10, 2) not null,
  refreshed_at         timestamptz  not null default now(),
  primary key (master_sku, coalesce(canal, 'pos'::public.channel))
);

create table public.mart_cannibalization (
  customer_id      uuid           not null references public.customers (customer_id) on delete cascade,
  master_sku       uuid           not null references public.master_products (master_sku) on delete cascade,
  canales          text[]         not null,
  ventana          text           not null check (ventana in ('d30', 'd90', 'd180')),
  total_compras    integer        not null default 0,
  refreshed_at     timestamptz    not null default now(),
  primary key (customer_id, master_sku, ventana)
);
