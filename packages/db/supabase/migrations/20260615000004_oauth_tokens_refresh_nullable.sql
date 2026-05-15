-- Migration 20260615000004 — refresh_token nullable on oauth_tokens.
-- Phase 2.1 / hotfix.
-- ML Colombia (MCO) does not return refresh_token on every OAuth flow.
-- The original NOT NULL constraint assumed offline_access semantics that
-- MCO's authorize endpoint silently ignores. Making the column nullable
-- lets the bootstrap UPSERT land with just access_token; the safety-net
-- refresh cron already skips rows with null refresh_token (it only sweeps
-- expires_at < now() + 1h AND refresh_token IS NOT NULL).
--
-- Operationally: a token row with refresh_token NULL needs a manual
-- re-auth at /operacion/conectar-mercadolibre once the access_token's 6h
-- TTL runs out. This is acceptable for the demo path; a follow-up phase
-- will revisit the ML MCO offline_access semantics for long-lived sync.

alter table public.oauth_tokens
  alter column refresh_token drop not null;

comment on column public.oauth_tokens.refresh_token is
  'Nullable since 20260615000004: ML MCO authorize flow does not always '
  'return a refresh_token. Rows with NULL require re-auth at 6h TTL.';
