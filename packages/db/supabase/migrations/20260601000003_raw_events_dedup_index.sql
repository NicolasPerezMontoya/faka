------------------------------------------------------------------------------
-- Plan 2.2.1 — raw_events delivery-id dedupe unique index
--
-- The WordPress connector (and any future webhook connector) writes a marker
-- row into `raw_events` for every webhook delivery, keyed by the channel's
-- delivery-id header (`x-wc-webhook-delivery-id` for WooCommerce, comparable
-- headers for ML/Falabella). The connector dedupe path uses
-- INSERT … ON CONFLICT DO NOTHING and reads the rowcount to decide whether
-- the delivery has been seen before — that requires a UNIQUE constraint
-- targeting `(canal, payload_json->>'_delivery_id')`.
--
-- A partial unique index lets us scope the uniqueness to rows that actually
-- store a `_delivery_id` (webhook events) and ignore any other raw_events
-- shape (cron heartbeats, polled events without a stable id).
--
-- RESEARCH §Pitfall 4 — dedupe MUST live at the storage layer (a UNIQUE
-- constraint), never an in-memory map; otherwise cron + webhook concurrent
-- writes can both pass dedupe before either commits.
------------------------------------------------------------------------------

create unique index if not exists raw_events_delivery_dedupe_uidx
  on public.raw_events (canal, ((payload_json ->> '_delivery_id')))
  where payload_json ? '_delivery_id';

comment on index public.raw_events_delivery_dedupe_uidx is
  'Plan 2.2.1: per-channel webhook delivery-id idempotency. WordPress connector '
  'and future webhook connectors use INSERT … ON CONFLICT DO NOTHING against '
  'this index to detect retried deliveries (RESEARCH §Pitfall 4).';
