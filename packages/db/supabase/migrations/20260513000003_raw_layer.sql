-- Migration 0003 — RAW layer.
-- Phase 1 / Plan 1.1.1.
--
-- RAW layer captures payloads as they arrive from each channel,
-- before any transformation. Two halves:
--
-- 1) Per-source ingestion tables (raw_orders, raw_products, raw_events) —
--    populated by future connector impls (F2+). F1 creates the tables only.
--
-- 2) CSV ingestion (ADR-001 LOCKED — channel-agnostic, immutable):
--    - csv_mapping_profiles : column-map definitions per export shape
--    - raw_csv_uploads      : metadata per file (Storage path + status)
--    - raw_csv_rows         : every row in the file, payload preserved verbatim
--
-- The 5 pre-seed mapping profiles from scripts/discovery/profiles/*.json
-- are inserted by supabase/seed.sql in Plan 1.1.7.

------------------------------------------------------------------------------
-- Per-channel ingestion tables (F1: empty; F2+: writers)
------------------------------------------------------------------------------

create table public.raw_orders (
  id            uuid        primary key default gen_random_uuid(),
  canal         public.channel not null,
  payload_json  jsonb       not null,
  fetched_at    timestamptz not null default now()
);

create index raw_orders_canal_fetched_idx on public.raw_orders (canal, fetched_at desc);

create table public.raw_products (
  id            uuid        primary key default gen_random_uuid(),
  canal         public.channel not null,
  payload_json  jsonb       not null,
  fetched_at    timestamptz not null default now()
);

create index raw_products_canal_fetched_idx on public.raw_products (canal, fetched_at desc);

create table public.raw_events (
  id            uuid        primary key default gen_random_uuid(),
  canal         public.channel not null,
  tipo_evento   text        not null,
  payload_json  jsonb       not null,
  ocurrido_at   timestamptz not null,
  fetched_at    timestamptz not null default now()
);

create index raw_events_canal_tipo_ocurrido_idx
  on public.raw_events (canal, tipo_evento, ocurrido_at desc);

------------------------------------------------------------------------------
-- CSV mapping profiles (ADR-001 LOCKED — schema per docs/AMENDMENT §3.4)
------------------------------------------------------------------------------

-- Profiles version individually; "Mercado Libre · Export publicaciones · v2"
-- is a distinct row from v1. Reprocess workflow (FND-07) picks an upload
-- and applies any version of its (canal, tipo) profile.
create table public.csv_mapping_profiles (
  id                uuid        primary key default gen_random_uuid(),
  nombre            text        not null,
  canal             public.channel not null,
  tipo              text        not null check (tipo in ('orders', 'products', 'order_items', 'inventory', 'mixto')),
  column_map_json   jsonb       not null,
  reglas_json       jsonb       null,
  version           integer     not null default 1,
  is_active         boolean     not null default true,
  creado_por        uuid        null,                            -- FK to auth.users added in migration 0009
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (canal, tipo, nombre, version)
);

create index csv_mapping_profiles_canal_tipo_active_idx
  on public.csv_mapping_profiles (canal, tipo)
  where is_active = true;

------------------------------------------------------------------------------
-- CSV uploads (one row per file)
------------------------------------------------------------------------------

create table public.raw_csv_uploads (
  upload_id           uuid                    primary key default gen_random_uuid(),
  canal_declarado     public.channel          not null,
  tipo                text                    not null check (tipo in ('orders', 'products', 'order_items', 'inventory', 'mixto')),
  filename            text                    not null,
  bytes               bigint                  not null check (bytes >= 0),
  row_count           integer                 not null default 0 check (row_count >= 0),
  uploaded_by         uuid                    null,             -- FK to auth.users added in migration 0009
  uploaded_at         timestamptz             not null default now(),
  storage_path        text                    not null,         -- e.g. csv-uploads/<channel>/<YYYY>/<MM>/<DD>/<upload_id>.csv
  mapping_profile_id  uuid                    null references public.csv_mapping_profiles (id) on delete restrict,
  status              public.csv_upload_status not null default 'uploaded',
  error_log_json      jsonb                   null,
  superseded_at       timestamptz             null,             -- set by migration 0013 when reprocess produces a newer version
  superseded_by       uuid                    null references public.raw_csv_uploads (upload_id) on delete set null
);

create index raw_csv_uploads_canal_uploaded_idx
  on public.raw_csv_uploads (canal_declarado, uploaded_at desc);

create index raw_csv_uploads_status_idx
  on public.raw_csv_uploads (status)
  where status <> 'processed';

------------------------------------------------------------------------------
-- CSV rows (one row per row in the source file — payload preserved verbatim)
------------------------------------------------------------------------------

create table public.raw_csv_rows (
  id            bigserial    primary key,
  upload_id     uuid         not null references public.raw_csv_uploads (upload_id) on delete cascade,
  row_number    integer      not null check (row_number >= 0),
  payload_json  jsonb        not null,         -- the row exactly as parsed, Record<string,string>
  processed     boolean      not null default false,
  target_table  text         null check (target_table in (
                                'raw_orders', 'raw_products', 'raw_events',
                                'master_products', 'master_categories'
                              )),
  error         text         null,
  unique (upload_id, row_number)
);

create index raw_csv_rows_upload_processed_idx
  on public.raw_csv_rows (upload_id, processed);

------------------------------------------------------------------------------
-- Storage bucket: csv-uploads (private)
------------------------------------------------------------------------------

-- Creates the bucket idempotently; storage.buckets is provided by Supabase.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'csv-uploads',
  'csv-uploads',
  false,
  20971520,  -- 20MB hard cap (matches CSV_MAX_BYTES default in .env.example)
  array['text/csv', 'application/vnd.ms-excel', 'text/plain']
)
on conflict (id) do nothing;
