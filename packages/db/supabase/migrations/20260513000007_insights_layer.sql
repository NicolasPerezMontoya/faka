-- Migration 0007 — INSIGHTS layer (+ ADR-003 messaging_log EMPTY stub).
-- Phase 1 / Plan 1.1.4.
--
-- IA-generated content (insights, chat conversations) lives here. F5 fills.
-- ADR-003 LOCKED: messaging_log is created EMPTY in F1; F5.5 writers populate.

create table public.ai_insights (
  id                  uuid         primary key default gen_random_uuid(),
  type                text         not null
                        check (type in ('alerta', 'oportunidad', 'anomalia', 'resumen', 'felicitacion')),
  severity            text         not null default 'info'
                        check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  titulo              text         not null,
  cuerpo_markdown     text         not null,
  master_skus_afectados uuid[]     not null default '{}',
  canal_afectado      public.channel null,
  accion_sugerida     text         null,
  payload_json        jsonb        null,
  generado_at         timestamptz  not null default now(),
  generado_por_modelo text         null,                              -- e.g. 'anthropic/claude-haiku-4-5'
  prompt_version      text         null,                              -- e.g. 'insights.v1'
  revisado_por_usuario uuid        null,                              -- FK to auth.users in 0009
  feedback            text         null check (feedback in ('util', 'no_util', 'accionado', null)),
  feedback_at         timestamptz  null,
  dismissed_at        timestamptz  null,
  dismissed_by        uuid         null                               -- FK to auth.users in 0009
);

create index ai_insights_generado_at_idx     on public.ai_insights (generado_at desc);
create index ai_insights_type_severity_idx   on public.ai_insights (type, severity);
create index ai_insights_canal_idx           on public.ai_insights (canal_afectado) where canal_afectado is not null;
create index ai_insights_pending_review_idx  on public.ai_insights (generado_at desc) where feedback is null and dismissed_at is null;

create table public.ai_conversations (
  id              uuid         primary key default gen_random_uuid(),
  user_id         uuid         null,                                  -- FK to auth.users in 0009
  started_at      timestamptz  not null default now(),
  ended_at        timestamptz  null,
  messages_json   jsonb        not null default '[]'::jsonb,          -- [{role, content, ts, ...}]
  contexto_datos_json jsonb    null,                                  -- mart snapshots loaded
  model_used      text         null,
  total_tokens    integer      null,
  cost_usd        numeric(8, 4) null
);

create index ai_conversations_user_started_idx
  on public.ai_conversations (user_id, started_at desc);

------------------------------------------------------------------------------
-- ADR-003 LOCKED — messaging_log EMPTY stub.
-- F5.5 writers populate (WhatsApp Cloud API inbound/outbound).
-- DO NOT seed, DO NOT populate. CC-14 in PLAN.md asserts count() = 0
-- after db reset and after full integration suite.
------------------------------------------------------------------------------

create table public.messaging_log (
  id              uuid         primary key default gen_random_uuid(),
  direction       text         not null check (direction in ('inbound', 'outbound')),
  channel         text         not null default 'whatsapp',
  recipient       text         null,
  sender          text         null,
  template_name   text         null,
  payload_json    jsonb        not null,
  status          text         not null default 'pending'
                    check (status in ('pending', 'sent', 'delivered', 'read', 'failed', 'received')),
  provider_message_id text     null,
  sent_at         timestamptz  null,
  delivered_at    timestamptz  null,
  read_at         timestamptz  null,
  error           text         null,
  cost_usd        numeric(8, 4) null,
  created_at      timestamptz  not null default now()
);

create index messaging_log_direction_created_idx on public.messaging_log (direction, created_at desc);
create index messaging_log_status_idx            on public.messaging_log (status) where status in ('pending', 'failed');

comment on table public.messaging_log is 'ADR-003 LOCKED — empty in F1. Writers populated in F5.5 (WhatsApp Cloud API). CC-14: SELECT count(*) must return 0 throughout F1 lifecycle.';
