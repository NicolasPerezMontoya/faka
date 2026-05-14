-- Migration 0009 — Profiles table + custom_access_token Auth Hook + auth.users FKs.
-- Phase 1 / Plan 1.1.5.
--
-- ADR-002 LOCKED: role comes from public.profiles.role, gets propagated to
-- the JWT via custom_access_token Auth Hook. RESEARCH §4 verbatim.
--
-- CRITICAL (RESEARCH Pitfall 2): grant execute on the hook function to
-- supabase_auth_admin. Without it, login fails cryptically ("Database error
-- granting user"). The grant must NOT extend to authenticated/anon/public.
--
-- After this migration, all auth.users FK references on tables created in
-- 0003–0008 are wired up (uploaded_by, validated_by, user_id, etc.).

------------------------------------------------------------------------------
-- profiles — single row per auth user, source of truth for role.
------------------------------------------------------------------------------

create table public.profiles (
  user_id      uuid             primary key references auth.users (id) on delete cascade,
  email        text             not null,
  role         public.user_role not null default 'analista',
  display_name text             null,
  phone        text             null,
  created_at   timestamptz      not null default now(),
  updated_at   timestamptz      not null default now()
);

create index profiles_role_idx on public.profiles (role);

------------------------------------------------------------------------------
-- RLS on profiles.
-- Self-read: users can read their own profile.
-- Self-update of display_name/phone is allowed; role/email mutations go
-- through Server Actions with service-role key (RLS bypass by design).
------------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_self_read
  on public.profiles
  for select
  to authenticated
  using (user_id = auth.uid());

create policy profiles_self_update_safe_columns
  on public.profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and role = (select p.role from public.profiles p where p.user_id = auth.uid())
    -- role mutations rejected by the with-check; the seeder/admin API mutates with service role
  );

------------------------------------------------------------------------------
-- custom_access_token_hook — RESEARCH §4 verbatim.
-- Reads role from public.profiles, defaults to 'analista' if absent.
-- Writes claim into BOTH `claims.role` (top-level) and
-- `claims.app_metadata.role` (where supabase-js looks).
------------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer                                    -- Function owner has read on profiles
set search_path = public, auth
as $$
declare
  v_user_id    uuid;
  v_role       public.user_role;
  v_claims     jsonb;
begin
  v_user_id := (event ->> 'user_id')::uuid;

  -- Look up the role; default to 'analista' if profile missing
  -- (defensive — Super Admin seeder writes the profile on user create).
  select role into v_role
  from public.profiles
  where user_id = v_user_id;

  if v_role is null then
    v_role := 'analista';
  end if;

  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  -- Inject claim at top level (for direct JWT access) and in app_metadata
  -- (where @supabase/supabase-js's getUser() surfaces it).
  v_claims := jsonb_set(v_claims, '{role}', to_jsonb(v_role::text));
  v_claims := jsonb_set(
    v_claims,
    '{app_metadata,role}',
    to_jsonb(v_role::text),
    true
  );

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

------------------------------------------------------------------------------
-- Grants for the hook function — RESEARCH Pitfall 2.
-- ONLY supabase_auth_admin gets execute. Others get nothing.
------------------------------------------------------------------------------

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- The hook function needs to read public.profiles. Grant only what's needed.
grant usage on schema public to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;

------------------------------------------------------------------------------
-- Helper: current_role_claim() — RESEARCH §3.
-- RLS policies and views call this to read the role from the JWT.
------------------------------------------------------------------------------

create or replace function public.current_role_claim()
returns public.user_role
language sql
stable
as $$
  select coalesce(
    (auth.jwt() ->> 'role')::public.user_role,
    (auth.jwt() -> 'app_metadata' ->> 'role')::public.user_role,
    'analista'::public.user_role
  );
$$;

grant execute on function public.current_role_claim() to authenticated, anon, supabase_auth_admin;

------------------------------------------------------------------------------
-- Wire all deferred auth.users FK references.
-- These were left null-able in earlier migrations so this single migration
-- can attach them after profiles + auth schema is finalized.
------------------------------------------------------------------------------

alter table public.csv_mapping_profiles
  add constraint csv_mapping_profiles_creado_por_fkey
  foreign key (creado_por) references auth.users (id) on delete set null;

alter table public.raw_csv_uploads
  add constraint raw_csv_uploads_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users (id) on delete set null;

alter table public.product_mappings
  add constraint product_mappings_validated_by_fkey
  foreign key (validated_by) references auth.users (id) on delete set null;

alter table public.customer_merge_log
  add constraint customer_merge_log_validated_by_fkey
  foreign key (validated_by) references auth.users (id) on delete set null;

alter table public.ai_insights
  add constraint ai_insights_revisado_por_usuario_fkey
  foreign key (revisado_por_usuario) references auth.users (id) on delete set null;

alter table public.ai_insights
  add constraint ai_insights_dismissed_by_fkey
  foreign key (dismissed_by) references auth.users (id) on delete set null;

alter table public.ai_conversations
  add constraint ai_conversations_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

alter table public.audit_log
  add constraint audit_log_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

alter table public.dead_letter_queue
  add constraint dead_letter_queue_resolved_by_fkey
  foreign key (resolved_by) references auth.users (id) on delete set null;
