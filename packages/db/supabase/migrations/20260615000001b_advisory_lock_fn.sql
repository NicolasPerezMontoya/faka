-- Migration 20260615000001b — try_acquire_advisory_lock() helper.
-- Phase 2.1 / Plan 2.1.1.2.
-- Purpose: race-condition mitigation for `oauth.ts:refreshToken` (RESEARCH
-- §Pitfall 1). Concurrent crons WILL race the refresh in production — ML
-- invalidates the old refresh token immediately on rotation, so a loser
-- callsite that proceeds to UPSERT the old token bricks the integration.
--
-- This helper wraps the standard Postgres `pg_try_advisory_xact_lock(int1,
-- int2)` with a text-keyed surface so callers don't re-implement the
-- hashtext pair every site. Hashing `('ml-refresh', user_id)` into the two
-- int4 arguments yields a low-collision lock identifier; the lock is
-- transaction-scoped (`_xact_`) so it releases automatically on commit or
-- rollback — no explicit unlock needed.
--
-- Contract: returns `true` if the lock was acquired (caller owns it for
-- the remainder of the transaction), `false` if another transaction
-- already holds it. The losing call should re-read `oauth_tokens` after a
-- short sleep — the winning caller's UPSERT will be visible.
--
-- Why a SECURITY DEFINER function: the function itself does no privileged
-- IO, but `pg_try_advisory_xact_lock` requires the calling role to be able
-- to acquire locks. Service-role bypasses RLS; authenticated/anon have no
-- business calling this. We GRANT EXECUTE to service_role only (anon and
-- authenticated are revoked by default for new functions in Supabase).

create or replace function public.try_acquire_advisory_lock(key_text text)
returns boolean
language sql
volatile
security invoker
as $$
  select pg_try_advisory_xact_lock(
    hashtext('faka:oauth-refresh:1'),
    hashtext(key_text)
  );
$$;

comment on function public.try_acquire_advisory_lock(text) is
  'F2.1: race-mitigation helper for oauth.ts refreshToken (RESEARCH Pitfall 1).';

-- Only the service-role key gets to call this; everyone else has no business
-- racing token refresh.
revoke all on function public.try_acquire_advisory_lock(text) from public;
revoke all on function public.try_acquire_advisory_lock(text) from authenticated;
revoke all on function public.try_acquire_advisory_lock(text) from anon;
