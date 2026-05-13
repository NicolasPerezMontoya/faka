-- Migration 0004 — MASTER layer.
-- Phase 1 / Plan 1.1.2.
--
-- The "single source of truth" catalog. F1 creates the tables; the
-- matching cascade that populates product_mappings is F2 (see
-- scripts/discovery/cascade.ts:38-89 for the algorithm reference).
--
-- Includes ADR-004 LOCKED Mini-CRM stubs (customers, customer_external_links,
-- customer_merge_log). Empty in F1; F4 implements the matching cascade for
-- clients (phone → email → document → phone fuzzy).

------------------------------------------------------------------------------
-- master_products: the canonical product. master_sku is our own UUID,
-- independent of any channel.
------------------------------------------------------------------------------

create table public.master_products (
  master_sku         uuid         primary key default gen_random_uuid(),
  nombre_canonico    text         not null,
  brand              text         null,
  category           text         null,
  master_category_id uuid         null,       -- FK added below after master_categories exists
  barcode            text         null,
  supplier_code      text         null,
  imagen_principal   text         null,
  costo_promedio     numeric(14, 2) null,
  precio_sugerido    numeric(14, 2) null,
  estado             text         not null default 'activo'
                       check (estado in ('activo', 'descontinuado', 'nuevo')),
  attributes_json    jsonb        not null default '{}'::jsonb,
  confidence_score   numeric(4, 3) not null default 0.000
                       check (confidence_score between 0 and 1),
  created_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now()
);

create unique index master_products_barcode_uidx
  on public.master_products (barcode)
  where barcode is not null;

create unique index master_products_supplier_code_uidx
  on public.master_products (supplier_code)
  where supplier_code is not null;

create index master_products_estado_idx on public.master_products (estado);

------------------------------------------------------------------------------
-- product_mappings: the bridge between channel-specific identifiers and
-- master_products. Every line item in `sale_items.master_sku` comes from
-- a (canal, external_id) lookup against this table.
--
-- validado_humano = true means: a human clicked "this match is correct" in
-- the validation queue. Once true, the cascade never asks again for this
-- (canal, external_id) pair. This is the "learn once" mechanism Nicolás
-- highlighted as crucial.
------------------------------------------------------------------------------

create table public.product_mappings (
  id                 uuid           primary key default gen_random_uuid(),
  master_sku         uuid           not null references public.master_products (master_sku) on delete cascade,
  canal              public.channel not null,
  external_id        text           not null,
  external_name      text           null,
  external_sku       text           null,
  match_method       public.match_method not null,
  score              numeric(4, 3)  not null check (score between 0 and 1),
  validado_humano    boolean        not null default false,
  validated_by       uuid           null,                                 -- FK to auth.users added in migration 0009
  validated_at       timestamptz    null,
  created_at         timestamptz    not null default now(),
  updated_at         timestamptz    not null default now(),
  unique (canal, external_id)
);

create index product_mappings_master_sku_idx on public.product_mappings (master_sku);

create index product_mappings_pending_validation_idx
  on public.product_mappings (canal, score)
  where validado_humano = false;

------------------------------------------------------------------------------
-- product_variants: per-variant detail when master_products is treated as
-- the parent. Sparse in v1 (20% of catalog has variants per discovery).
------------------------------------------------------------------------------

create table public.product_variants (
  master_variant_sku uuid          primary key default gen_random_uuid(),
  master_sku         uuid          not null references public.master_products (master_sku) on delete cascade,
  atributos_json     jsonb         not null default '{}'::jsonb,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);

create index product_variants_master_sku_idx on public.product_variants (master_sku);

------------------------------------------------------------------------------
-- master_categories: hierarchical taxonomy curated by the team
-- (cliente cada canal taxonomía propia, dijo en discovery — la maestra
-- la construimos nosotros).
------------------------------------------------------------------------------

create table public.master_categories (
  id            uuid         primary key default gen_random_uuid(),
  nombre        text         not null,
  slug          text         not null,
  parent_id     uuid         null references public.master_categories (id) on delete restrict,
  depth         smallint     not null default 0,
  is_active     boolean      not null default true,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),
  unique (parent_id, slug)
);

create index master_categories_parent_idx on public.master_categories (parent_id);

-- Wire master_products → master_categories FK (deferred until table exists)
alter table public.master_products
  add constraint master_products_master_category_id_fkey
  foreign key (master_category_id) references public.master_categories (id) on delete set null;

------------------------------------------------------------------------------
-- category_mappings: per-channel category → master_category mapping.
-- Populated as part of the Operación taxonomy UI in F2/F3.
------------------------------------------------------------------------------

create table public.category_mappings (
  id                  uuid           primary key default gen_random_uuid(),
  canal               public.channel not null,
  external_category   text           not null,
  master_category_id  uuid           not null references public.master_categories (id) on delete cascade,
  validado_humano     boolean        not null default false,
  created_at          timestamptz    not null default now(),
  updated_at          timestamptz    not null default now(),
  unique (canal, external_category)
);

create index category_mappings_master_idx on public.category_mappings (master_category_id);

------------------------------------------------------------------------------
-- ADR-004 LOCKED — Mini-CRM stubs.
-- F1 creates EMPTY tables. F4 implements customer matching + population.
-- Columns mirror docs/ADR-004-mini-crm.md verbatim.
------------------------------------------------------------------------------

create table public.customers (
  customer_id        uuid         primary key default gen_random_uuid(),
  displayed_name     text         null,
  phone              text         null,
  email              text         null,
  document_id        text         null,                       -- cédula u otro; F4 decide si hashear
  first_purchase_at  timestamptz  null,
  last_purchase_at   timestamptz  null,
  total_purchases    integer      not null default 0 check (total_purchases >= 0),
  total_spent        numeric(14, 2) not null default 0,
  channels_purchased text[]       not null default '{}',
  tags               text[]       not null default '{}',
  notes              text         null,
  created_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now()
);

-- Lookup indexes used by the F4 customer-matching cascade.
create unique index customers_phone_uidx     on public.customers (phone)       where phone is not null;
create unique index customers_email_uidx     on public.customers (lower(email)) where email is not null;
create unique index customers_document_uidx  on public.customers (document_id) where document_id is not null;
create index customers_last_purchase_idx     on public.customers (last_purchase_at desc nulls last);

create table public.customer_external_links (
  id                       uuid           primary key default gen_random_uuid(),
  customer_id              uuid           not null references public.customers (customer_id) on delete cascade,
  canal                    public.channel not null,
  external_customer_id     text           not null,
  external_identifier_type text           not null
                             check (external_identifier_type in ('email', 'phone', 'nickname', 'document')),
  merged_method            text           not null
                             check (merged_method in ('auto_phone', 'auto_email', 'auto_document', 'manual')),
  created_at               timestamptz    not null default now(),
  unique (canal, external_customer_id)
);

create index customer_external_links_customer_idx on public.customer_external_links (customer_id);

create table public.customer_merge_log (
  id            uuid         primary key default gen_random_uuid(),
  merged_at     timestamptz  not null default now(),
  merged_into   uuid         not null references public.customers (customer_id) on delete cascade,
  merged_from   uuid         not null references public.customers (customer_id) on delete cascade,
  method        text         not null
                  check (method in ('auto_phone', 'auto_email', 'auto_document', 'manual', 'undo')),
  validated_by  uuid         null,                                  -- FK to auth.users added in migration 0009
  reason        text         null,
  check (merged_into <> merged_from)
);

create index customer_merge_log_merged_into_idx on public.customer_merge_log (merged_into);
create index customer_merge_log_merged_from_idx on public.customer_merge_log (merged_from);
