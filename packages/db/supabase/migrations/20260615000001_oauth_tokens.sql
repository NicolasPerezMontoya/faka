-- Migration 20260615000001 — oauth_tokens table.
-- Phase 2.1 / Plan 2.1.1.1.
-- Purpose: service-role-only OAuth token storage for F2.1 Mercado Libre
-- (and any future OAuth channel). The orchestrator reads + UPSERTs through
-- `packages/connectors/src/mercadolibre/oauth.ts`; nothing else ever touches
-- this table — by design.
--
-- RLS DIVERGENCE — INTENTIONAL (PATTERNS §7):
--   F1's migration 0010 (`20260513000010_rls_policies.sql:19-50`) establishes
--   the baseline pattern of `alter table ... enable row level security` +
--   a `create policy "authenticated_select_<table>" ... using (auth.uid() is not null)`
--   so the SECURITY INVOKER role views can read base tables. This migration
--   INTENTIONALLY OMITS that authenticated SELECT policy. Tokens are
--   service-role-only; even a permissive read policy would be wrong because
--   `access_token`/`refresh_token` must never leak to a row-scope a regular
--   authenticated user inherits. A future reviewer who notices the missing
--   policy and "fixes" it would silently break the security model — hence
--   this header comment.
--
-- Encryption at rest: Supabase Postgres uses TDE for the data volume
-- (storage-level encryption). No application-layer encryption is added here
-- per F2.1 RESEARCH §Security: V8 Data Protection — TDE is the contract.
-- This also keeps `oauth.ts` simple (no per-row key envelope).
--
-- Composite uniqueness: (canal, user_id) — a single ML seller account in v1
-- per PATTERNS §"F2.1-NEW — Single ML seller account". Multi-account support
-- is a future migration; the unique constraint anchors the UPSERT conflict
-- target in `oauth.ts`.
--
-- Refresh-cron index: (canal, expires_at) supports the 5h safety-net cron's
-- `select user_id from oauth_tokens where canal='mercadolibre' and
-- expires_at < now() + interval '1 hour'` pattern (Plan 2.1.1.4).

create table public.oauth_tokens (
  id              uuid          primary key default gen_random_uuid(),
  canal           public.channel not null,
  user_id         text          not null,
  access_token    text          not null,
  refresh_token   text          not null,
  expires_at      timestamptz   not null,
  scope           text          null,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

-- Stable UPSERT conflict target (PATTERNS §7).
-- ML invalidates the prior refresh_token on every rotation; the unique
-- constraint guarantees the rotated pair lands in the SAME row.
alter table public.oauth_tokens
  add constraint oauth_tokens_canal_user_id_unique unique (canal, user_id);

-- Refresh-cron lookup (Plan 2.1.1.4).
create index oauth_tokens_canal_expires_idx
  on public.oauth_tokens (canal, expires_at);

-- updated_at auto-touch — mirrors migration 0004's pattern (master_products).
create or replace function public.touch_oauth_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger oauth_tokens_touch_updated_at
  before update on public.oauth_tokens
  for each row execute function public.touch_oauth_tokens_updated_at();

-- Enable RLS — but DO NOT add any policies. The service-role key bypasses
-- RLS by design (Supabase invariant); the explicit `revoke` below makes
-- the intent unmistakable to any future reviewer.
alter table public.oauth_tokens enable row level security;

revoke all on public.oauth_tokens from authenticated;
revoke all on public.oauth_tokens from anon;

-- Table comment is the runtime breadcrumb: a `\d+ public.oauth_tokens` in
-- psql shows this string to whoever is investigating.
comment on table public.oauth_tokens is
  'F2.1: service-role-only OAuth token storage. No authenticated SELECT policy (per RESEARCH Security).';
