-- Migration 0008 — Observability tables (connector_runs + audit_log + DLQ).
-- Phase 1 / Plan 1.1.4.
--
-- connector_runs: one row per orchestrator execution (real channel sync OR
-- cron heartbeat). W2 fix: kind/canal coherence enforced by CHECK so the
-- channel enum stays real-channels-only — cron-heartbeat lives on the
-- separate connector_run_kind enum.
--
-- audit_log: verbatim ADR-002:43. Every mutation on a user-readable
-- table writes one row from the application layer (helper in 1.2.4).
--
-- dead_letter_queue: table-based DLQ per RESEARCH §7. Connector helpers
-- write here after exceeding retry budget; F4+ alerting reads.

create table public.connector_runs (
  id                 uuid                       primary key default gen_random_uuid(),
  kind               public.connector_run_kind  not null default 'channel',
  canal              public.channel             null,                       -- W2 — required when kind='channel'
  started_at         timestamptz                not null default now(),
  completed_at       timestamptz                null,
  status             text                       not null default 'running'
                       check (status in ('running', 'succeeded', 'partial', 'failed')),
  records_processed  integer                    not null default 0,
  records_failed     integer                    not null default 0,
  retry_count        integer                    not null default 0,
  errors_json        jsonb                      null,
  duration_ms        integer                    null,
  upload_id          uuid                       null references public.raw_csv_uploads (upload_id) on delete set null,
  metadata_json      jsonb                      null,                       -- free-form extras per run kind
  -- W2 CHECK: kind/canal coherence (PATTERNS §5.4 + RESEARCH §7).
  constraint connector_runs_kind_canal_coherence
    check (
      (kind = 'channel'        and canal is not null) or
      (kind = 'cron-heartbeat' and canal is null)
    )
);

create index connector_runs_canal_started_idx
  on public.connector_runs (canal, started_at desc)
  where canal is not null;

create index connector_runs_kind_started_idx
  on public.connector_runs (kind, started_at desc);

create index connector_runs_status_idx
  on public.connector_runs (status)
  where status in ('running', 'failed');

------------------------------------------------------------------------------
-- audit_log — ADR-002:43 schema verbatim.
-- Application layer writes a row on every user-driven mutation
-- (validate-match, upload-CSV, change-role, etc.). Helper in 1.2.4.
------------------------------------------------------------------------------

create table public.audit_log (
  id            uuid             primary key default gen_random_uuid(),
  user_id       uuid             null,                                   -- FK to auth.users in 0009; nullable for system actions
  role_at_time  public.user_role null,
  action        text             not null,
  target_table  text             not null,
  target_id     text             null,
  payload_json  jsonb            null,
  at            timestamptz      not null default now()
);

create index audit_log_at_idx                on public.audit_log (at desc);
create index audit_log_user_at_idx           on public.audit_log (user_id, at desc) where user_id is not null;
create index audit_log_target_idx            on public.audit_log (target_table, target_id);

comment on table public.audit_log is 'ADR-002:43 schema. Columns are exact; do NOT add ip_address/user_agent (defer to post-F4).';

------------------------------------------------------------------------------
-- dead_letter_queue — RESEARCH §7 table-based DLQ.
-- Connectors that fail beyond retry budget write here; F4+ alerts on count.
------------------------------------------------------------------------------

create table public.dead_letter_queue (
  id                 uuid           primary key default gen_random_uuid(),
  canal              public.channel not null,
  source             text           not null,                                   -- e.g. 'orders.fetch', 'csv.row'
  payload_json       jsonb          not null,
  error              text           not null,
  attempts           integer        not null default 0,
  last_attempted_at  timestamptz    not null default now(),
  created_at         timestamptz    not null default now(),
  resolved_at        timestamptz    null,
  resolved_by        uuid           null,                                       -- FK to auth.users in 0009
  resolution_note    text           null
);

create index dlq_canal_created_idx on public.dead_letter_queue (canal, created_at desc);
create index dlq_unresolved_idx    on public.dead_letter_queue (created_at desc) where resolved_at is null;
