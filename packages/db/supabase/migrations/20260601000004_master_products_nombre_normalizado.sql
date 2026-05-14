-- Migration 20260601000004 — master_products.nombre_normalizado generated column.
-- Phase 2 / Plan 2.2.2.
-- Purpose: cascade level 3 (normalized-name exact match) via a stored
-- generated column populated by `public.normalize_name(text)` and indexed
-- for O(log n) lookup. The TypeScript mirror lives at
-- `packages/connectors/src/matching/level-3-normalized-name.ts`.
--
-- Invariant: keep `public.normalize_name(text)` and the JS `normalize()`
-- function in lockstep. Both produce: lower + unaccent + strip non-
-- alphanumeric/space + squash whitespace + trim.
--
-- Why `unaccent` here: Spanish accents are non-semantic for matching
-- ("aceite" vs "acéite" is the same product). pg_trgm (enabled in 0001)
-- is for future fuzzy matching; for level 3 we want an EXACT equality on
-- the normalized form so it's an index seek, not a similarity scan.

-- 1. Enable the unaccent extension (Supabase installs to `extensions`
--    schema; this is an additive, idempotent guard).
create extension if not exists unaccent;

-- 2. Canonical normalizer. Declared IMMUTABLE so the generated column
--    can use it. We pin the search_path so the function resolves
--    `unaccent` regardless of the caller's session settings — required
--    for STABLE/IMMUTABLE generated columns. Note: `unaccent(text)` is
--    technically STABLE because dictionaries are reloadable; we treat
--    our deployed unaccent dictionary as static (standard Postgres
--    pattern; Supabase doesn't hot-reload dictionaries).
create or replace function public.normalize_name(t text)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select case
    when t is null then ''
    else trim(regexp_replace(
      regexp_replace(lower(unaccent(t)), '[^a-z0-9 ]+', ' ', 'g'),
      '\s+', ' ', 'g'
    ))
  end;
$$;

-- 3. Generated stored column. `stored` so the index can cover it without
--    re-computing on every read. Adding the column on an existing table is
--    a metadata-only change in Postgres 12+ for non-default expressions;
--    however a generated column DOES require rewriting every row, so on
--    a large `master_products` this would take time. At F1 scale this is
--    near-instant.
alter table public.master_products add column nombre_normalizado text generated always as (public.normalize_name(nombre_canonico)) stored;

-- 4. B-tree index for equality lookups (level 3 query).
create index master_products_nombre_normalizado_idx
  on public.master_products (nombre_normalizado);

-- 5. No RLS changes needed: master_products RLS is set up in migration
--    0010; the new column inherits the existing policies automatically.

-- 6. Grant execute on the normalizer to authenticated roles so the
--    dashboard can call it for ad-hoc previews (and so RLS-bound views
--    can use it). Service role bypasses grants.
grant execute on function public.normalize_name(text) to authenticated, anon;
