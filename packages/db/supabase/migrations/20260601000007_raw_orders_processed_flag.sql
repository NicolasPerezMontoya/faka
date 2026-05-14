-- Migration 20260601000007 — raw_orders processed flag for the durable queue.
-- Phase 2 / Plan 2.3.1 (WordPress webhook route — RESEARCH Open Question §1 RESOLVED).
--
-- The WP webhook handler (apps/orchestrator/src/routes/webhooks-wordpress.ts)
-- inserts every verified delivery into `raw_orders` with `processed=false`.
-- The async event processor cron (Plan 2.3.2 — process-wp-events.ts) polls
-- `raw_orders WHERE canal='wordpress' AND processed=false` every minute,
-- normalizes the WC payload, UPSERTs into `sales`/`sale_items`, runs the
-- matching cascade, and finally flips `processed=true, processed_at=now()`.
--
-- This is the **Postgres queue** pattern from RESEARCH §Pattern 1 — we deliberately
-- AVOID `executionCtx.waitUntil` for post-ACK work because Railway's Node runtime
-- doesn't guarantee request-bound continuations after the response flushes. A
-- durable queue inside Postgres (this column + the cron poller) gives us
-- at-least-once semantics + crash recovery for free: if the cron crashes
-- mid-loop, the next minute it picks up where it left off because `processed`
-- only flips after the UPSERT + cascade succeed.
--
-- Why a boolean + a timestamp instead of a single timestamp?
--   - The boolean is what the cron's WHERE clause filters on; a partial index
--     on `processed=false` keeps the hot path O(unprocessed) rather than
--     O(all_orders_ever).
--   - The timestamp is for observability ("when was this drained?") and for
--     diagnosing stuck rows in the queue.
--
-- Additive: both columns are nullable / defaulted, so pre-existing rows
-- (F1 CSV ingestion + manual seeds) get `processed=false, processed_at=null`
-- and will be picked up by the next cron pass. That's intentional — the cron
-- is idempotent on UPSERT-by-conflict, so re-processing F1 rows is a no-op.

alter table public.raw_orders
  add column if not exists processed     boolean      not null default false,
  add column if not exists processed_at  timestamptz  null;

comment on column public.raw_orders.processed is
  'Plan 2.3.1: durable-queue flag flipped by process-wp-events cron (2.3.2) '
  'after successful normalize + UPSERT + cascade.';

comment on column public.raw_orders.processed_at is
  'Plan 2.3.1: when the async processor finished draining this raw_orders row. '
  'NULL while processed=false; observability only — the cron filters on `processed`.';

-- Partial index for the cron hot path: `select * from raw_orders where canal=$1
-- and processed=false order by fetched_at asc limit 100`. The partial predicate
-- keeps the index tiny (covers only the unprocessed tail) while still serving
-- the cron's exact filter. Drops to ~0 rows once the queue drains.
create index if not exists raw_orders_unprocessed_idx
  on public.raw_orders (canal, fetched_at asc)
  where processed = false;
