-- Migration 0001 — Extensions and schemas.
-- Phase 1 / Plan 1.1.1.
--
-- pgcrypto: gen_random_uuid() for default UUID PKs.
-- pg_trgm: trigram similarity for future fuzzy text matching (F2 cascade).
-- vector: pgvector for future embeddings (F2 cascade stage 5).
-- Note: vector extension is provided by Supabase out of the box.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "vector";

-- All app tables live in public. We do NOT create custom schemas in F1.
-- Reserved: future schemas like `audit` or `mart` may be added if the
-- public namespace gets too crowded (defer to F4+).
