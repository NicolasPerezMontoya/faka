# Phase 2.1: Mercado Libre Colombia integration — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Source:** Lightweight context (no /gsd-discuss-phase run — direct decision from cliente meeting)

## Phase Boundary

**In scope:**
- ML Colombia (siteId `MCO`) channel connector implementing the LOCKED `ChannelConnector` interface from F1.
- OAuth flow: Mercado Libre app registration, client_credentials/authorization_code, refresh token rotation, token storage in Postgres.
- Orders sync — periodic pull every 15 min via REST `/orders/search` with date-based pagination and idempotent UPSERT into `sales` + `sale_items` keyed on `(canal='mercadolibre', external_order_id)`.
- Products sync — every 1 hour via REST `/users/{user_id}/items/search` with attribute/variant extraction; pushes into `master_products` candidate flow.
- 5-level matching cascade integration — items missing `master_sku` flow through the cascade (barcode → supplier code → normalized name → embeddings → LLM arbiter). MUST extend without duplicating F2's cascade work.
- Webhook receiver — ML push notifications for orders + items via Hono `/webhooks/mercadolibre` with HMAC-equivalent shared-secret verify (ML uses signed query params, not HMAC body).
- Cron heartbeat + `connector_runs` rows per pull/webhook.
- Dashboard "Hoy" + "Matching" views already exist (F2 Wave 4); ML rows show up via the same role-gated views without new pages.
- Operational env vars: `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_WEBHOOK_SECRET`. Orchestrator-only, never `NEXT_PUBLIC_*` (CC-11).

**Out of scope (defer):**
- Other ML sites (MLA/MLM/MLB). MCO only.
- ML Shipments / Logistics API (orders' carrier metadata stays in `raw_orders.payload_json` until needed).
- Multi-account ML support (single seller account v1).
- ML messaging API (defer to F5.5 messaging layer).
- POS / WhatsApp / Dropi / Falabella (their named phases).

## Locked Decisions (from project memory + F1/F2 architecture)

- **ADR-001 (LOCKED):** CSV upload remains a first-class fallback. If ML credentials lag, ML rows can still enter via CSV-upload wizard. The connector ships in degraded mode (no creds → `healthCheck` returns `ok:false`, syncs no-op, webhook 503s) following the WP pattern.
- **ADR-002 (LOCKED):** 4-role RLS preserved. ML reads go through the existing role-gated `v_hoy_*` views — no per-channel role logic.
- **Stack pinned (LOCKED):** Supabase + Railway (orchestrator) + Vercel (dashboard). ML connector lives in `packages/connectors/src/mercadolibre/` (extend skeleton from F1). All ML credentials are orchestrator-only.
- **Matching cascade (LOCKED):** Same 5 levels, channel-agnostic. F2.1 reuses F2's cascade as-is. If F2's cascade is incomplete (Wave 2 pending), F2.1's plan must NOT re-implement — it depends on F2 closing the cascade first OR planning a shared cascade extraction.
- **Idempotency key (LOCKED):** `(canal, external_order_id)` unique constraint on `sales` already exists from F1 migration 0005.

## Depends On

- **Phase 1 (Foundation):** ChannelConnector interface, `master_products`/`product_mappings`/`sales`/`sale_items` tables, RLS, Hono orchestrator, cron infra, `connector_runs` schema, audit log.
- **Phase 2 (Walking skeleton WP):** Matching cascade implementation (Wave 2 plans 2.2.1–2.2.5), HMAC webhook pattern (Plan 2.3.1), CSV mapping profile registry pattern (extended for ML if CSV fallback used).
- **Open question — F2 cascade dependency resolution:** Either F2 closes Wave 2 first (cleanest) OR F2.1 plan extracts cascade as standalone work that lands in `packages/connectors/src/matching/` and is consumable by both F2 and F2.1. Planner should choose based on which path closes faster.

## Domain Constraints (Mercado Libre Colombia)

- **siteId:** `MCO` (Colombia). Hardcode in connector config; do NOT make this an env var (single-site v1).
- **API base:** `https://api.mercadolibre.com` (multi-site, scope via siteId in requests/listings).
- **OAuth:** App registered at https://developers.mercadolibre.com.co. Authorization code flow (`authorization_code`) for first auth; refresh tokens last 6 hours, must be rotated. Cliente must create the app and provide client_id + client_secret BEFORE F2.1 sync code runs (degraded mode handles missing creds).
- **Rate limits:** Default 50 req/sec per app; orders endpoint stricter. Implement exponential backoff (F1 pattern).
- **Currency:** COP always for MCO orders. Don't assume USD.
- **Webhook signature:** ML signs query params `topic`, `user_id`, `application_id`, `attempts`, `sent`, `received`. We verify via shared secret (different from WP HMAC body signing). Pattern lives in F2 Plan 2.3.1 conceptually but ML's verify is distinct — research must produce concrete verifier code.
- **Order states:** ML's order statuses are different from internal `sales.estado` enum (`pagado`/`pendiente`/`parcial`/`cancelado`/`devuelto`). Need a state mapper.

## Open Questions for Researcher

1. **OAuth storage:** Where do ML tokens live? Suggested: new table `oauth_tokens(canal, access_token, refresh_token, expires_at, scope, user_id)` with RLS lockdown to service-role only. Researcher should confirm or propose alternative.
2. **Refresh token rotation:** Cron-driven refresh vs lazy refresh on 401? Recommend: lazy refresh + cron safety net every 5 hours.
3. **Pagination:** ML uses offset-based with hard cap of 1000 results. For orders, partition by `date_created` ranges; for items, scroll via search_type=scan.
4. **Webhook missed events:** ML retries up to 5x but defines no SLA. Pair webhook with hourly reconciliation pull keyed on `last_updated_after`.
5. **Variant handling:** ML items have a `variations` array. Each variation has its own `id`, `attribute_combinations`, `price`, `available_quantity`. Decide: variation = `master_variant_sku` row (per ADR? F1 schema has `product_variants` table — check). Researcher must define the mapping.
6. **Catalog vs Item listings:** ML now pushes "catalog products" model (universal product). MCO adoption?? — research current state.

## Effort Estimate (rough, to be refined by planner)

- Total: ~60-80h (smaller than F2 because cascade is reused, no UI changes — same `/hoy` + `/matching` views serve)
- Waves: (0) deps install + env vars, (1) oauth_tokens migration + state mapper, (2) connector real impl + token lifecycle, (3) orchestrator routes (webhook + 2 crons), (4) tests + smoke, (5) docs + deploy notes.
- No Wave 4 (Dashboard UI) — F2 already shipped /hoy + /matching which are channel-agnostic.

## Anti-Goals

- Do NOT build a "Mercado Libre" page or section in dashboard. Channel-agnostic views from F2 are correct.
- Do NOT duplicate the cascade. Reuse F2's plans 2.2.2-2.2.5 outputs.
- Do NOT make siteId or currency configurable. MCO + COP locked.
- Do NOT ship credentials in repo. Even `.env.example` placeholders are fine; real values via Vercel/Railway env vars only.
- Do NOT build a ML-specific role or RLS. The 4-role matrix is LOCKED.

## Canonical References

- `docs/PRD.md` — overall product context.
- `docs/AMENDMENT-csv-source.md` — ADR-001 CSV fallback path.
- `.planning/phases/2-walking-skeleton-wp/RESEARCH.md` — research style + cascade + HMAC pattern.
- `.planning/phases/2-walking-skeleton-wp/PATTERNS.md` — how phases map to F1 analogs.
- `.planning/phases/2-walking-skeleton-wp/PLAN.md` — Wave structure + plan granularity.
- `packages/connectors/src/mercadolibre/` — F1 skeleton (throws NOT_IMPLEMENTED — F2.1 replaces).
- `apps/orchestrator/.env.example` — `ML_CLIENT_ID` / `ML_CLIENT_SECRET` slots already reserved.
- `memoria/F2-PROGRESO.md` — F2 progress + WP credential reality.
