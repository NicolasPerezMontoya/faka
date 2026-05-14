-- Migration 20260601000001 — Product embeddings.
-- Phase 2 / Plan 2.1.1.
-- Purpose: cascade level 4 (semantic match via pgvector).
-- Invariant: vector dim is 1536 (text-embedding-3-small) — never edit;
-- bump model = new column. The `vector` extension is enabled in
-- migration 0001.

create table public.product_embeddings (
  master_sku  uuid        primary key references public.master_products(master_sku) on delete cascade,
  embedding   vector(1536) not null,
  source_text text         not null,
  source_hash text         not null,
  model       text         not null default 'text-embedding-3-small',
  updated_at  timestamptz  not null default now()
);

create index product_embeddings_hnsw
  on public.product_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create or replace function public.find_similar_products(
  query_vec vector(1536),
  k int default 5
)
returns table (master_sku uuid, distance float)
language sql stable
as $$
  select master_sku, embedding <=> query_vec as distance
  from public.product_embeddings
  order by embedding <=> query_vec
  limit k;
$$;

alter table public.product_embeddings enable row level security;

-- Baseline: read-only for authenticated roles. Orchestrator writes
-- via the service_role JWT (bypasses RLS).
create policy product_embeddings_select_all
  on public.product_embeddings
  for select
  to authenticated
  using (true);

grant select on public.product_embeddings to authenticated;
grant execute on function public.find_similar_products(vector, int) to authenticated;
