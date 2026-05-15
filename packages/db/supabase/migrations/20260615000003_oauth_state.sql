-- Migration 20260615000003 — oauth_state CSRF nonce table.
-- Phase 2.1 / Plan 2.1.3.4.
-- Purpose: short-TTL nonce store for the OAuth `state` CSRF guard. The
-- dashboard's "Conectar Mercado Libre" server action inserts a random
-- 32-byte nonce here before redirecting the user to ML's authorize page;
-- the OAuth callback handler validates the returned `state` against this
-- table before exchanging the authorization code. Without this check, an
-- attacker could trick the operator into authorizing the attacker's ML
-- account into our oauth_tokens row (RESEARCH §Security V3 — CSRF).
--
-- RLS DIVERGENCE — INTENTIONAL (mirror of oauth_tokens, migration 0001):
--   This table is service-role-only. Like `oauth_tokens`, it intentionally
--   has NO `authenticated SELECT` policy because the nonce is not user-
--   addressable — only the orchestrator's callback handler reads it via
--   service-role. Even a permissive read policy would be wrong: leaking
--   active nonces to authenticated clients weakens the CSRF guard.
--
-- TTL: rows are valid for 10 minutes from `created_at`. The callback
-- handler enforces this in app code (the table has `expires_at` as a
-- column for clarity + cheap cleanup), and a future cron may sweep
-- expired rows. The window is short enough that the table never grows
-- large (one row per OAuth attempt by the single super_admin operator).
--
-- Composite shape: `state` is the PRIMARY KEY because it's the natural
-- random unique value the redirect carries back. `canal` lets us reuse
-- this table for future OAuth channels (Falabella, etc.) without a new
-- table; `redirect_after` lets the callback bounce the user back to the
-- exact URL they came from (defensive — v1 always uses
-- `/operacion/conectar-mercadolibre`).
--
-- Additive + safe: net-new table, no data rewrite, no row locks beyond
-- the create. The migration includes a regen of `database.ts` via
-- `pnpm --filter @faka/db codegen` in the same atomic commit.

create table public.oauth_state (
  state             text          primary key,
  canal             public.channel not null,
  redirect_after    text          null,
  created_at        timestamptz   not null default now(),
  expires_at        timestamptz   not null default (now() + interval '10 minutes')
);

-- Cleanup index — cheap range scan for any sweeper cron we add later.
create index oauth_state_expires_at_idx
  on public.oauth_state (expires_at);

-- Enable RLS — but DO NOT add any policies. The service-role key bypasses
-- RLS by design (Supabase invariant); the explicit `revoke` below makes
-- the intent unmistakable.
alter table public.oauth_state enable row level security;

revoke all on public.oauth_state from authenticated;
revoke all on public.oauth_state from anon;

comment on table public.oauth_state is
  'F2.1: short-TTL CSRF nonce store for OAuth bootstrap. Service-role only; '
  'no authenticated SELECT policy (mirror of oauth_tokens divergence).';
