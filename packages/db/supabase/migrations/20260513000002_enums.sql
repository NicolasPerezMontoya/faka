-- Migration 0002 — Enumerated types.
-- Phase 1 / Plan 1.1.1.
--
-- Enum contracts:
--   channel              : real channels only (PATTERNS §5.4 — Falabella included, cron-heartbeat NOT).
--   match_method         : verbatim from scripts/discovery/types.ts:20-29.
--   csv_upload_status    : per docs/AMENDMENT-csv-source.md (ADR-001 LOCKED).
--   user_role            : per docs/ADR-002-role-matrix.md (LOCKED).
--   connector_run_kind   : per W2 fix — separates real-channel runs from cron heartbeats
--                          so the channel enum stays a clean contract.

-- Real channels. Includes 'falabella' (FND-04 — connector skeleton in F1, real impl F6).
-- Includes 'pos1' / 'pos2' for the two physical points; 'pos' kept for aggregate.
-- 'csv-upload' lets CSV-driven ingestion be a first-class channel per ADR-001.
create type public.channel as enum (
  'wordpress',
  'mercadolibre',
  'dropi',
  'pos',
  'pos1',
  'pos2',
  'whatsapp',
  'csv-upload',
  'falabella'
);

-- Match methods for the matching cascade. F1 creates the enum;
-- the cascade logic itself is F2 work (PATTERNS §5.5).
create type public.match_method as enum (
  'barcode_exact',
  'supplier_code_exact',
  'sku_exact',
  'normalized_name_exact',
  'embeddings_high',
  'embeddings_mid',
  'llm_arbiter_match',
  'llm_arbiter_reject',
  'unresolved'
);

-- CSV upload lifecycle states (ADR-001).
create type public.csv_upload_status as enum (
  'uploaded',
  'validating',
  'processed',
  'failed'
);

-- User roles (ADR-002 LOCKED).
create type public.user_role as enum (
  'super_admin',
  'admin',
  'manager',
  'analista'
);

-- Connector-run categorization (W2 fix). Separate from channel enum so that
-- cron heartbeats and other non-channel scheduled tasks do not pollute the
-- real-channel contract. Used by connector_runs.kind in migration 0008.
create type public.connector_run_kind as enum (
  'channel',
  'cron-heartbeat'
);
