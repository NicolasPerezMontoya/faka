-- Migration 0013 — Reprocess versioning columns on raw_csv_rows.
-- Phase 1 / Plan 1.1.7 (additive — slots at end of migration stream).
--
-- FND-07: "Historical uploads table supports re-running a versioned
-- csv_mapping_profile against an existing upload without re-uploading."
--
-- When a user clicks "Reprocess" on a past upload, the workflow:
--   1. Selects a new mapping_profile_id (newer version of same canal/tipo).
--   2. For each raw_csv_row in the upload, re-runs the column-map and
--      re-emits the normalized result into facts.
--   3. Marks the prior emission's per-row mapping with superseded_at.
--
-- Storing which profile version was used per row makes this auditable
-- and reversible — you can re-run a row against any past or future
-- profile version without ambiguity.

alter table public.raw_csv_rows
  add column mapping_profile_id_used  uuid         null references public.csv_mapping_profiles (id) on delete set null,
  add column superseded_at            timestamptz  null,
  add column processed_at             timestamptz  null;

create index raw_csv_rows_active_idx
  on public.raw_csv_rows (upload_id, processed)
  where superseded_at is null;

-- A reprocess history table makes the audit trail explicit:
-- one row per reprocess invocation. The upload_id stays the same;
-- mapping_profile_id_before/after capture the version delta.
create table public.csv_reprocess_history (
  id                         uuid         primary key default gen_random_uuid(),
  upload_id                  uuid         not null references public.raw_csv_uploads (upload_id) on delete cascade,
  triggered_at               timestamptz  not null default now(),
  triggered_by               uuid         null references auth.users (id) on delete set null,
  mapping_profile_id_before  uuid         null references public.csv_mapping_profiles (id) on delete set null,
  mapping_profile_id_after   uuid         not null references public.csv_mapping_profiles (id) on delete restrict,
  rows_processed             integer      not null default 0,
  rows_failed                integer      not null default 0,
  status                     text         not null default 'running'
                               check (status in ('running', 'succeeded', 'partial', 'failed')),
  errors_json                jsonb        null,
  completed_at               timestamptz  null,
  duration_ms                integer      null
);

create index csv_reprocess_history_upload_idx
  on public.csv_reprocess_history (upload_id, triggered_at desc);

alter table public.csv_reprocess_history enable row level security;

create policy csv_reprocess_history_authenticated_select
  on public.csv_reprocess_history
  for select
  to authenticated
  using (auth.uid() is not null);
