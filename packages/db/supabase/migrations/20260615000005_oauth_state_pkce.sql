-- Migration 20260615000005 — code_verifier column on oauth_state (PKCE).
-- Phase 2.1 / hotfix.
-- ML Colombia's app config enforces PKCE (Proof Key for Code Exchange).
-- The token endpoint rejects exchanges without code_verifier with
-- 400 invalid_request. We store the verifier alongside the state nonce
-- so the callback can replay it during the code-exchange POST.
--
-- Nullable for backwards-compat with any in-flight rows; new rows always
-- carry it (the start-oauth action generates a random verifier per call).

alter table public.oauth_state
  add column if not exists code_verifier text null;

comment on column public.oauth_state.code_verifier is
  'PKCE verifier — random 43-128 char string. Sent in the token exchange '
  'as code_verifier; the authorize call carries sha256(verifier)/base64url '
  'as code_challenge.';
