# Phase 2.1: Mercado Libre Colombia integration — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 14 new file targets + 2 env/infra updates
**Analogs found:** 13 strong / 14 (ML-signed-query-params webhook verify has no F1 analog — design from RESEARCH/ML docs, but borrow WP `webhook-verify.ts` envelope)

This document maps every new file Phase 2.1 will create to its closest existing analog in the codebase (F1 skeletons + F2 Wave 0-2 outputs). The planner consumes this to write per-plan action lists; every action should reference an analog (`<file>:<line-range>`) and the specific pattern to copy. F2.1 reuses F2 cascade + F2 dashboard views — there is NO new UI work in this phase.

> **F2 dependency:** F2 Waves 0-1 are committed (per `04697cb memoria: pause point — F2 Waves 0-1 complete, Wave 2 pending`). F2.1 Wave 2's matching cascade (`packages/connectors/src/matching/cascade.ts`) is **NOT yet on disk**. F2.1 PLAN MUST sequence Wave 2 such that F2 Wave 2 closes first OR extract `runMatchCascade` to a standalone PR landed before F2.1's Wave 3 cron files. **Flag for planner: F2.1 plan introduction must call this out and resolve.**

---

## Architectural Map

```
              ┌────────────────────────────────────────────────────┐
              │  apps/orchestrator (Hono + cron)                   │
              │                                                    │
   webhook ──▶│  routes/mercadolibre-webhook.ts (NEW)              │
              │     │                                              │
              │     ├─ verify signed query params (NEW shape)      │──┐
              │     ├─ writes raw_orders/raw_events                │  │
              │     └─ acks 200 fast                               │  │
              │                                                    │  │
              │  crons/sync-ml-orders.ts (NEW, every 15m)          │  │
              │  crons/sync-ml-products.ts (NEW, every 60m)        │  │
              │  crons/ml-refresh-tokens.ts (NEW, every 5h)        │  │
              └────────────────────────────────────────────────────┘  │
                              │                                       │
                              ▼                                       │
              ┌────────────────────────────────────────────────────┐  │
              │  packages/connectors/src/mercadolibre/ (REWRITE)   │  │
              │                                                    │  │
              │  index.ts       → ChannelConnector factory         │◀─┘
              │  oauth.ts       → code-exchange + refresh-rotation │
              │  api-client.ts  → typed REST + rate-limit retries  │
              │  state-mapper.ts→ ML status → sales.estado         │
              │  variant-mapper → variations[] → product_variants  │
              │  types.ts       → narrow ML payload types          │
              └────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌────────────────────────────────────────────────────┐
              │  packages/db (Postgres)                            │
              │                                                    │
              │  oauth_tokens (NEW MIGRATION 20260615000001)       │
              │     RLS: service-role ONLY (no authenticated read) │
              │                                                    │
              │  REUSED: sales / sale_items / master_products /    │
              │  product_mappings / product_variants /             │
              │  v_hoy_* / product_embeddings /                    │
              │  connector_runs / raw_orders / raw_events          │
              └────────────────────────────────────────────────────┘
                              │
                              ▼
                  REUSES F2 cascade (no re-impl):
                  packages/connectors/src/matching/runMatchCascade()
```

**One-line phase shape:** F2.1 adds a single new table (`oauth_tokens`), a single new channel implementation (mirroring `csv/index.ts`'s factory shape + `wordpress/index.ts`'s degraded-mode envelope as built by F2 Wave 2), one webhook route + three crons in the orchestrator, and no UI. Dashboard views (`v_hoy_*`, `/matching` page) are channel-agnostic; ML rows show up automatically.

---

## File Classification

| New file / module                                                              | Role                      | Data Flow                    | Closest Analog                                                                                                              | Match                          |
| ------------------------------------------------------------------------------ | ------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `packages/connectors/src/mercadolibre/index.ts` (REWRITE skeleton)             | connector                 | pull + push                  | `packages/connectors/src/csv/index.ts:74-495` (factory) + `packages/connectors/src/wordpress/index.ts` (post-F2 Wave 2)     | exact (role + degraded-mode)   |
| `packages/connectors/src/mercadolibre/oauth.ts`                                | service module            | request-response (OAuth)     | **NO ANALOG** — borrow `packages/connectors/src/idempotency.ts` shape + `csv/index.ts:80-119` (helper-with-supabase-arg)    | partial (style only)           |
| `packages/connectors/src/mercadolibre/api-client.ts`                           | service module            | request-response             | `packages/connectors/src/wordpress/client.ts` (planned by F2 Plan 2.2.1) + `packages/connectors/src/retry.ts:30-67`         | role-match                     |
| `packages/connectors/src/mercadolibre/state-mapper.ts`                         | service module (pure fn)  | transform                    | `packages/connectors/src/wordpress/normalize-order.ts` (F2 Plan 2.2.1 STATUS_MAP block) + `csv/index.ts:148-182` envelope   | exact (pure-fn pattern)        |
| `packages/connectors/src/mercadolibre/variant-mapper.ts`                       | service module (pure fn)  | transform                    | `csv/index.ts:217-264` (master_products + product_mappings + product_variants UPSERT shape)                                 | role-match                     |
| `packages/connectors/src/mercadolibre/types.ts`                                | types-only                | n/a                          | `packages/connectors/src/types.ts:14-128` (header doc + narrow types) + `packages/connectors/src/wordpress/client.ts` Zod   | exact                          |
| `packages/db/supabase/migrations/20260615000001_oauth_tokens.sql`              | migration (table+RLS)     | DDL                          | `20260513000004_master_layer.sql:17-45` (table style) + `20260513000010_rls_policies.sql:19-50` (RLS enable, service-only)  | exact                          |
| `apps/orchestrator/src/routes/mercadolibre-webhook.ts`                         | controller (Hono handler) | event-driven (webhook)       | `apps/orchestrator/src/server.ts:18-50` (route + ctx + envelope) + `wordpress/webhook-verify.ts` (F2 Plan 2.2.1)             | partial (HMAC ≠ signed params) |
| `apps/orchestrator/src/crons/sync-ml-orders.ts`                                | cron job                  | batch + transform            | `apps/orchestrator/src/cron.ts:1-55` (entrypoint, exit-code, recordConnectorRun) + F2 Plan 2.3.x sync-wp-orders             | role-match                     |
| `apps/orchestrator/src/crons/sync-ml-products.ts`                              | cron job                  | batch + transform            | same as above                                                                                                               | role-match                     |
| `apps/orchestrator/src/crons/ml-refresh-tokens.ts`                             | cron job                  | batch (token rotation)       | `apps/orchestrator/src/cron.ts:22-49` (try/catch + process.exit) — body is novel                                            | partial (cron shape only)      |
| `packages/connectors/__tests__/mercadolibre-state-mapper.test.ts`              | test                      | n/a                          | `packages/connectors/__tests__/wordpress/normalize-order.test.ts` (F2 Plan 2.2.1 fixture-driven)                            | role-match                     |
| `packages/connectors/__tests__/mercadolibre-oauth.test.ts`                     | test                      | n/a                          | `packages/connectors/__tests__/wordpress/webhook-verify.test.ts` (F2 Plan 2.2.1 valid/tampered fixture pattern)             | role-match                     |
| `apps/orchestrator/__tests__/mercadolibre-webhook.test.ts`                     | test                      | n/a                          | **NO F1/F2 ANALOG** — orchestrator has no `__tests__` dir today; design from RESEARCH/MSW                                   | none                           |
| `apps/orchestrator/.env.example` (modify)                                      | config                    | n/a                          | existing file lines 22-26 (WP block — comment + var pattern) + lines 30-33 (existing `ML_CLIENT_ID/SECRET` slots)           | exact                          |
| `apps/orchestrator/railway.toml` (modify)                                      | config                    | n/a                          | existing file `[services.cron].schedule` block (currently `*/30 * * * *`) — replicate for 3 ML crons                        | exact                          |

---

## Pattern Assignments

### 1. Mercado Libre connector — `packages/connectors/src/mercadolibre/index.ts` (REWRITE)

**Analogs:**
- Primary: `packages/connectors/src/csv/index.ts:74-495` (the only fully-realized `ChannelConnector` in the repo at planning time).
- Secondary: `packages/connectors/src/wordpress/index.ts` (post-F2 Wave 2) — same `pull` connector shape with degraded-mode envelope. **Read at planning time only if F2 Wave 2 has landed; if not, treat the F2 PATTERNS §1 description as the spec.**
- Skeleton being replaced: current `packages/connectors/src/mercadolibre/index.ts:1-76` (throws `NOT_IMPLEMENTED_F4` — F2.1 is the new "F4 work happening earlier than originally scoped").

**What to copy (line ranges) — LIFT VERBATIM then mutate:**

- **Factory + closure signature** (csv/index.ts:74-78, current ML skeleton:23-26): keep the existing `export const createMercadoLibreConnector: ConnectorFactory<MercadoLibreConnectorConfig> = (config) => { const canal: Channel = "mercadolibre"; ... return connector as ChannelConnector; };` shell intact — REPLACE only the throwing method bodies. Update `MercadoLibreConnectorConfig` to add `redirectUri: string; webhookSecret: string;` alongside the existing `clientId, clientSecret`.
- **Helper-function partitioning** (csv/index.ts:80-279): hoist `loadTokens`, `refreshAccessToken`, `fetchOrdersForUser`, `fetchItemsForUser`, `upsertSales`, `upsertSaleItems`, `upsertMasterProduct`, `upsertVariants` OUTSIDE the returned connector object. Each takes `supabase: SupabaseClient` (or `cfg` / `accessToken`) as first arg, no `this`.
- **`safeNormalize*` envelope** (csv/index.ts:148-182): every parse of an ML payload goes through a `safeParse → { data } | { _error }` discriminated union. ML payloads are heavily nested (`order.order_items[].item.variation_attributes[]`) and partial-batch resilience matters more than for WP because ML often returns 500s mid-stream — accumulate errors, never throw out the whole batch.
- **Idempotent UPSERTs** (csv/index.ts:211-214, 259-263): `supabase.from("sales").upsert(payload, { onConflict: "canal,external_order_id" })` + `supabase.from("product_mappings").upsert(payload, { onConflict: "canal,external_id" })`. Composite keys are the F1 LOCKED invariant from migration 0005:43 — DO NOT introduce new keys. `external_order_id` for ML = `String(order.id)`.
- **`healthCheck` degraded-mode** (current ML skeleton:70-72 — KEEP this pattern, just upgrade the gate): `if (loadConfig() returns not_configured) return { ok: false, last_error: "not configured" }`. Otherwise perform a lightweight `GET /users/me` and return `{ ok: true, last_sync: <connector_runs.completed_at> }` on success. **NEVER throws** (PATTERNS §1 W2 rule from F2).
- **Connector contract surface** (csv/index.ts:281-381, ChannelConnector interface in types.ts:79-107): expose `name: "mercadolibre"`, `canal: "mercadolibre"`, `type: "pull"`, `capabilities: new Set(["orders", "products", "inventory"])` (matches current skeleton:29-32; keep). All five required methods: `fetchOrders/fetchProducts/normalizeOrder/normalizeProduct/healthCheck`. Optionally expose `extractCustomerHint` (ML orders carry `buyer.email` + `buyer.nickname`).

**What's different from WP:**

- **OAuth, not API-key auth:** every API call needs a bearer token. The closure-captured config is just the OAuth app credentials — the actual `access_token` lives in `oauth_tokens` and is read per-call. **Pattern: each helper-fn reads via `await loadAccessToken(supabase, "mercadolibre", { lazyRefreshOn401: true })` before issuing the request.** This is the load-bearing divergence from WP/CSV — neither has a token lifecycle.
- **`type: "pull"`** is correct (matches current skeleton); **same as WP**. Webhook receipts are a secondary push channel that lands in `raw_orders` and triggers reconciliation, not a primary path.
- `fetchOrders` calls `/orders/search?seller=$user_id&order.status=paid,confirmed&order.date_last_updated.from=<since.toISOString()>` (NOT `modified_after` like WC — ML uses ISO `from`/`to` range params per docs). Pagination is offset-based with hard cap 1000; partition by `date_created` ranges when more than 1000 hits expected (CONTEXT.md Open Q3).
- `fetchProducts` calls `/users/$user_id/items/search?search_type=scan` + per-id `GET /items/$id`.
- `extractCustomerHint`: ML returns `buyer.id` (anonymous internal ID), `buyer.nickname`, `buyer.email` (often masked), `shipping.receiver_address.receiver_phone`. Map to `{ phone, email, displayed_name: buyer.nickname, source: "order_payload" }`.
- **Currency:** hardcoded `COP` (CONTEXT.md domain constraint — MCO only; not env-configurable).
- **siteId:** hardcoded `"MCO"` constant in `index.ts` (anti-goal: do NOT make this configurable).

---

### 2. OAuth code-exchange + refresh — `packages/connectors/src/mercadolibre/oauth.ts`

**Analogs:**
- No F1/F2 OAuth analog exists. Closest: `packages/connectors/src/wordpress/webhook-verify.ts` (F2 Plan 2.2.1 — Node `crypto` usage pattern); `packages/connectors/src/idempotency.ts:35-55` (clear error type + stable signature for unit tests).
- **Style guide:** `packages/connectors/src/csv/index.ts:80-119` (helper functions take `supabase` as first arg + return discriminated unions).

**What to copy (style only — STUDY AND WRITE FRESH):**

- **Helper-fn signatures** (csv/index.ts:80-119): `async function exchangeCodeForToken(cfg, code): Promise<TokenResponse | { error: string }>`, `async function refreshToken(supabase, canal): Promise<{ access_token, expires_at } | { error: string }>`, `async function loadAccessToken(supabase, canal, opts?): Promise<string | null>`. Discriminated unions on success/failure — callers branch on `"error" in result`.
- **`fetch` style** (csv has no fetch; orchestrator/lib/supabase.ts:16 uses `global: { fetch }`): use Node's global `fetch` for the OAuth POST to `https://api.mercadolibre.com/oauth/token`. Body: `application/x-www-form-urlencoded` (NOT JSON — ML requirement). Wrap in `withRetryAndDLQ` from `packages/connectors/src/retry.ts:30-67` with `canal: "mercadolibre"`, `source: "oauth.exchange"` so a transient ML auth-server 503 lands in DLQ instead of failing the whole sync.
- **Token storage** (idempotency.ts:35-55 pattern, mutated): `await supabase.from("oauth_tokens").upsert({ canal: "mercadolibre", user_id, access_token, refresh_token, expires_at, scope }, { onConflict: "canal,user_id" })`. Composite key `(canal, user_id)` mirrors F1's `(canal, external_order_id)` idempotency invariant.

**Logic distinct to this file (no analog):**

- **Lazy refresh on 401:** the load-bearing decision from CONTEXT.md Open Q2. `loadAccessToken` reads the cached token; if `expires_at < now() + 60s` OR caller signals `lazyRefreshOn401`, call `refreshToken`. The cron `ml-refresh-tokens.ts` is the **safety net**, not the primary path.
- **Refresh token rotation:** ML rotates the refresh token on every refresh. The upsert MUST replace both `access_token` AND `refresh_token` — DO NOT keep the old refresh_token (it is invalidated server-side immediately).
- **6-hour TTL on access tokens:** `expires_at` is `now() + 21600s`. Refresh tokens themselves last 6 months but rotate every refresh. **Document this in a top-of-file comment.**

**Pattern type:** STUDY AND WRITE FRESH (no verbatim source).

---

### 3. Typed REST client + rate-limit retries — `packages/connectors/src/mercadolibre/api-client.ts`

**Analogs:**
- Primary: `packages/connectors/src/wordpress/client.ts` (F2 Plan 2.2.1 — Zod schemas for WC payloads + thin SDK wrapper). **If F2 Wave 2 hasn't landed, treat F2 PATTERNS §1 spec as the source.**
- Retry envelope: `packages/connectors/src/retry.ts:30-67` (the F1 `withRetryAndDLQ` wrapper — `pRetry({ retries: 3, factor: 2, minTimeout: 1000 })` per RESEARCH §7).

**What to copy (LIFT VERBATIM then mutate):**

- **Zod-schema-validated client surface** (wordpress/client.ts F2 Plan): export `MLOrderSchema`, `MLOrderItemSchema`, `MLItemSchema`, `MLVariationSchema`, plus type aliases. Each API method (`getOrder`, `searchOrders`, `getItem`, `searchItems`) validates the response body via `safeParse`; rows that fail Zod parse are LOGGED + SKIPPED.
- **Retry wrapper** (retry.ts:30-67): wrap every API call in `withRetryAndDLQ(() => fetch(...), { canal: "mercadolibre", source: "orders.fetch", payload: { since: since.toISOString() }, maxRetries: 3 }, supabase)`. ML's default rate limit is 50 req/sec per app; on 429, surface the retry-after header and respect it — `pRetry` supports `onFailedAttempt` for this.

**Logic distinct to this file:**

- **Bearer-token header injection:** every call adds `Authorization: Bearer ${access_token}` (token resolved at call time, NOT at client construction). Compare to WC's HTTP Basic with `queryStringAuth: true` — ML never uses basic auth.
- **Pagination shape:** offset-based with `offset=0&limit=50` query params, max 1000 results. The client exposes a generator `async function* paginate(searchUrl, opts)` that callers iterate.
- **`siteId` baked in:** all listing/search calls pin `?site_id=MCO` (anti-goal: not configurable).
- **401 handling distinct from retry:** on 401, the api-client throws an `MLUnauthorizedError` (do NOT retry — refresh the token in the caller via `oauth.refreshToken` then retry once). Distinct from generic 5xx retries which `pRetry` handles.

**Pattern type:** LIFT VERBATIM (Zod + retry envelope) then mutate (ML-specific headers/pagination).

---

### 4. ML status → `sales.estado` mapper — `packages/connectors/src/mercadolibre/state-mapper.ts`

**Analogs:**
- Primary: F2 Plan 2.2.1 `wordpress/normalize-order.ts` STATUS_MAP block (`{ completed: "pagado", processing: "pendiente", cancelled: "cancelado", refunded: "devuelto" }`).
- Envelope: `packages/connectors/src/csv/index.ts:148-182` (safe-normalize discriminated union).
- Enum source: `packages/db/supabase/migrations/20260513000005_facts_layer.sql:29-30` (`sales.estado check constraint: pagado, pendiente, cancelado, devuelto, parcial`).

**What to copy (LIFT VERBATIM the structure, change the map):**

- **Pure function + const map** (WP analog): `export const ML_STATUS_MAP: Record<string, SalesEstado> = { paid: "pagado", confirmed: "pendiente", payment_required: "pendiente", payment_in_process: "pendiente", partially_paid: "parcial", partially_refunded: "parcial", cancelled: "cancelado", invalid: "cancelado", refunded: "devuelto" }`. Export `export function mapMLStatus(mlStatus: string): SalesEstado` — **defaults to `"pendiente"` on unknown** (do NOT throw; partial-batch resilience per csv:148-182).
- **Pure fn signature** (csv/index.ts:148-152): zero side effects, no `supabase` parameter, easy to test.

**Logic distinct to this file:**

- **ML's "status_detail" sub-field:** for `cancelled` orders, ML provides `status_detail` (e.g., `seller_cancelled`, `buyer_cancelled`, `expired`). PRESERVE this in `sales.notes` (or `raw_payload_ref.status_detail`) — do not collapse into `cancelado` only. Document the mapping in a top-of-file comment.
- **Compound statuses:** ML can return `paid` + `shipment.status=delivered` vs `paid` + `shipment.status=pending`. The enum `sales.estado` does not track shipment state — only payment. So `shipment.status` flows into `raw_orders.payload_json` and we surface it later via a Hoy/Operacion column if needed (out of scope for F2.1).

**Pattern type:** LIFT VERBATIM (WP STATUS_MAP pattern) then mutate the map values.

---

### 5. ML variations → `product_variants` mapper — `packages/connectors/src/mercadolibre/variant-mapper.ts`

**Analogs:**
- Primary: `packages/connectors/src/csv/index.ts:217-264` (the only existing master_products + product_mappings + product_variants UPSERT codepath — CSV's `upsertProducts` is a "best-effort" master_products INSERT followed by product_mappings UPSERT).
- Schema: `packages/db/supabase/migrations/20260513000004_master_layer.sql:86-94` (`product_variants` table: `master_variant_sku PK`, `master_sku FK`, `atributos_json jsonb`).
- Resolution: CONTEXT.md Open Q5 — "variation = `master_variant_sku` row" is the LOCKED decision; this file enforces it.

**What to copy (mutate verbatim):**

- **UPSERT chain pattern** (csv/index.ts:237-263): three writes in order — `master_products` INSERT (only if not already mapped) → `product_variants` UPSERT keyed on `(master_sku, atributos_json hash)` → `product_mappings` UPSERT keyed on `(canal, external_id)`. **Idempotent at every step** (idempotency.ts:35-55 wrapper).
- **`atributos_json` payload shape** (master_layer.sql:89): ML's `variation_attributes` array (e.g. `[{name: "Color", value: "Rojo"}, {name: "Talla", value: "M"}]`) flattens to a sorted JSON object `{ "Color": "Rojo", "Talla": "M" }` (sort keys for stable hashing). Hash this object → use as the `(master_sku, atributos_json)` natural key when the table lacks a unique constraint on it (F2.1 may need a small additive migration `20260615000002_product_variants_unique.sql` adding `unique (master_sku, atributos_json)` — flag for planner).

**Logic distinct to this file:**

- **Per-variation pricing:** ML returns price per variation (`variation.price`, `variation.available_quantity`). F1 has no per-variant price column — proposal: store in `product_variants.atributos_json.__pricing` as nested metadata. **Flag for planner — this MAY be deferred to a later phase.**
- **Catalog products mode** (CONTEXT.md Open Q6): if ML adopted catalog products in MCO, `item.catalog_product_id` is set. In that case, the parent is the catalog product, variations are "sellers' offers" → different semantic. **Research should confirm MCO adoption; v1 assumes legacy item-with-variations model.**

**Pattern type:** LIFT VERBATIM (csv UPSERT chain) then mutate.

---

### 6. Narrow TypeScript types — `packages/connectors/src/mercadolibre/types.ts`

**Analogs:**
- Primary: `packages/connectors/src/types.ts:14-128` (whole file is the F1 contract surface — header doc block + narrow interfaces).
- Style guide: F2 Plan 2.2.1 `wordpress/client.ts` Zod schemas (`WCOrder`, `WCOrderLineItem`, `WCProduct` — narrow types for only the fields the connector touches).

**What to copy (LIFT VERBATIM the doc shape):**

- **Top-of-file doc block** (connectors/types.ts:1-12): explain purpose, link to ML docs URL, note "only fields the connector touches — DO NOT add fields proactively". `RawOrder.payload_json` already holds the full ML response; types here cover only the parsed/typed subset.
- **Interfaces, not classes** (types.ts:25-107): `MLOrder`, `MLOrderItem`, `MLItem`, `MLVariation`, `MLBuyer`, `MLShipment`, `MLTokenResponse`. Each interface has a one-line `/** ... */` doc above it.
- **Discriminated unions for OAuth responses** (matches the F2 PATTERNS §"safeNormalize envelope" idiom): `type MLTokenResult = { ok: true, response: MLTokenResponse } | { ok: false, error: string, status?: number }`.

**Logic distinct:**

- **ML-specific oddities to document:** `order.total_amount` is a number not a string (unlike WC where `total` is a string); `order.date_created` is ISO 8601 with timezone (`-04:00` for MCO, NOT UTC); `item.id` is a string starting `MCO-` for MCO listings; `buyer.email` is often the masked `nickname@example.com` form, NOT a real email.

**Pattern type:** LIFT VERBATIM the structure of `packages/connectors/src/types.ts` doc block.

---

### 7. OAuth tokens table — `packages/db/supabase/migrations/20260615000001_oauth_tokens.sql`

**Analogs:**
- Table style: `20260513000004_master_layer.sql:17-45` (`master_products` — column conventions, `default now()` timestamps, `primary key default gen_random_uuid()`, partial unique indexes).
- RLS lockdown: `20260513000010_rls_policies.sql:19-50` (enable RLS + service-role-only — note that file enables RLS but adds a `SELECT to authenticated` baseline; for `oauth_tokens` we want **NO authenticated policy at all**, only service-role bypass).
- Migration header: every existing migration's leading comment block (e.g. master_layer.sql:1-11, raw_layer.sql:1-16).

**What to copy (LIFT VERBATIM):**

- **Top-of-file doc block** (master_layer.sql:1-11): `-- Migration 20260615000001 — OAuth tokens. -- Phase 2.1 / Plan 2.1.W.X. -- Purpose: store OAuth access/refresh tokens for ML (and future OAuth channels). -- Invariant: service-role write ONLY. NO authenticated SELECT policy — even authenticated users must NOT be able to read tokens. -- Compromise of access_token = grant for entire ML seller account. -- Refresh tokens rotate on every refresh; this table is the single source of truth.`
- **Column conventions** (master_layer.sql:17-35): `primary key default gen_random_uuid()` for `id`, `created_at`/`updated_at` as `timestamptz not null default now()`, all sensitive fields `text not null` (no nulls — empty tokens are a bug, not a state).
- **Unique constraint pattern** (master_layer.sql:37-43): `unique (canal, user_id)` so the upsert in `oauth.ts` has a stable conflict target.

**Concrete shape (write fresh, not in any F1 file yet):**

```sql
create table public.oauth_tokens (
  id            uuid           primary key default gen_random_uuid(),
  canal         public.channel not null,
  user_id       text           not null,                       -- ML seller user_id (numeric, stored as text for stability)
  access_token  text           not null,
  refresh_token text           not null,
  expires_at    timestamptz    not null,
  scope         text           null,
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now(),
  unique (canal, user_id)
);

create index oauth_tokens_canal_expires_idx on public.oauth_tokens (canal, expires_at);

alter table public.oauth_tokens enable row level security;
-- NO policies → only service_role JWT (bypasses RLS) can read or write.
-- Explicitly revoke from authenticated:
revoke all on public.oauth_tokens from authenticated;
revoke all on public.oauth_tokens from anon;
```

**What's different from F1/F2 migration patterns:**

- **No authenticated SELECT policy** — distinct from every other migration. Even `product_embeddings` (migration 20260601000001:38-42, just landed in F2 Wave 1) grants `select to authenticated`. `oauth_tokens` MUST NOT. Document this divergence in the file's doc block.
- **No view in `20260513000011_role_views.sql` style** — no role ever sees tokens; even Admin reads "ML connected: yes/no" via a separate health endpoint, never the token itself.
- **No `database.ts` regeneration concern in the consumer-app dimension** — the orchestrator uses service-role and types it locally; the dashboard never imports this table's types.

**Pattern type:** LIFT VERBATIM the migration header + table style; the RLS body is INTENTIONALLY MINIMAL.

---

### 8. ML webhook route — `apps/orchestrator/src/routes/mercadolibre-webhook.ts`

**Analogs:**
- Primary: `apps/orchestrator/src/server.ts:18-50` (existing Hono route with ctx + envelope) + the 501 stub at `server.ts:52-54` you must replace/extend.
- Verify pattern (style only, NOT signature): F2 Plan 2.2.1 `packages/connectors/src/wordpress/webhook-verify.ts` (the HMAC-SHA256 + `timingSafeEqual` envelope).
- **No directory exists yet:** `apps/orchestrator/src/routes/` is NEW in F2.1 (or F2 Wave 3 lands it first — flag for planner). The first route file establishes the directory convention.

**What to copy (LIFT VERBATIM the envelope; WRITE FRESH the verify body):**

- **Hono + ctx construction** (server.ts:18-29): `app.post("/webhooks/mercadolibre", async (c) => { const supabase = getSupabase(); const ctx = { supabase, logger: { debug: m => log.debug(m), info: m => log.info(m), warn: m => log.warn(m), error: m => log.error(m) } }; ... });`. Mount via `mountMercadoLibreWebhook(app: Hono): void` exported from this file, called from `server.ts` after the other route registrations.
- **Error envelope** (server.ts:39-46, 58-61): `c.json({ error: "invalid_signature" }, 401)` for verify failure, `c.json({ error: "internal_server_error" }, 500)` for unhandled, `c.json({ ok: true }, 200)` for success — match exact JSON shape.
- **Replace the dispatch stub** (server.ts:52-54): F2 Wave 3 (Plan 2.3.1) is expected to replace the generic `/webhooks/:canal` stub with explicit `/webhooks/wordpress`. F2.1 follows the same pattern with explicit `/webhooks/mercadolibre`. **Coordinate with F2 Wave 3:** if F2 chose dispatch over explicit, F2.1 mounts explicit anyway (CONTEXT.md anti-goal: do not pollute generic infrastructure with ML specifics).
- **Raw-body read pattern** (F2 Plan 2.2.1's W-new invariant `Pitfall 2 — signature verified on bytes, never on parsed object`): `const raw = await c.req.arrayBuffer(); const bodyBuf = Buffer.from(raw);`. Even though ML signs query params (NOT the body), follow this convention for consistency in case ML adds body-HMAC later.

**Logic distinct to this file — NO ANALOG, design from RESEARCH/ML docs:**

- **ML signature verification (DISTINCT FROM WP):** ML signs query string parameters (`topic`, `user_id`, `application_id`, `attempts`, `sent`, `received`), NOT the body. The signature header (`x-signature` or query param `signature` depending on app config) is HMAC-SHA256 of the concatenated query params using the app's shared secret. **Pattern:**
  ```typescript
  const params = ["topic", "user_id", "application_id", "attempts", "sent", "received"];
  const canonical = params.map(p => `${p}:${c.req.query(p) ?? ""}`).join(";");
  const expected = createHmac("sha256", env.ML_WEBHOOK_SECRET).update(canonical).digest("hex");
  const provided = c.req.query("signature") ?? c.req.header("x-signature");
  if (!provided || !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
    return c.json({ error: "invalid_signature" }, 401);
  }
  ```
- **Idempotency by `(topic, resource, sent)`:** ML retries up to 5x with the same `sent` timestamp. Dedup via INSERT into `raw_events` with `ON CONFLICT (canal, tipo_evento, payload_json->>'resource', payload_json->>'sent') DO NOTHING` (compose this index in an additive migration if needed — flag for planner).
- **Topic dispatch:** ML sends a single endpoint for all event types (`topic: "orders_v2"`, `"items"`, `"questions"`, `"messages"`, ...). F2.1 handles `orders_v2` + `items`; others get logged and dropped (NOT 4xx — return 200 to stop retries).
- **Ack-then-process pattern** (F2 PATTERNS §2): persist raw to `raw_orders`/`raw_events`, then ACK 200. The actual sync (full order fetch via `/orders/$id`) happens async — either via `waitUntil` in the route or a Postgres-queue style poller in cron. **CONTEXT.md prefers reconciliation pull** (sync-ml-orders.ts handles missed/dropped webhooks), so the webhook can be lighter: write to `raw_events`, ACK, let the next 15-min cron pick up the resource.

**Pattern type:** LIFT VERBATIM the Hono envelope from `server.ts`; STUDY AND WRITE FRESH for the verify body (HMAC of signed query params is novel).

> **Proposed shared verifier module (CONTEXT.md HMAC-pattern note):** since WP and ML both do HMAC-SHA256 + `timingSafeEqual` but with different inputs (raw body vs. canonical query string), there's a clean abstraction: `packages/connectors/src/webhook-verify.ts` exposing `verifyHmac(secret, signature, canonicalString): boolean`. WP's `webhook-verify.ts` becomes a 2-line wrapper that passes `rawBody.toString()`; ML's becomes a 2-line wrapper that passes the joined query params. **Flag for planner — propose this in F2.1 Wave 0 as a small refactor IF F2 Wave 2's `wordpress/webhook-verify.ts` has not yet landed; otherwise defer to F3 when POS adds a third HMAC variant.**

---

### 9. Cron — `apps/orchestrator/src/crons/sync-ml-orders.ts` (every 15 min)

**Analogs:**
- Primary: `apps/orchestrator/src/cron.ts:1-55` (the F1 heartbeat — entrypoint shape, `process.exit(0)`/`process.exit(1)`, top-of-file doc block).
- Sync body: F2 Plan 2.3.x `sync-wp-orders.ts` (planned; not yet on disk). **Treat F2 PLAN.md Wave 3 description as the spec.**
- **Directory:** `apps/orchestrator/src/crons/` is NEW (or F2 Wave 3 lands it first — coordinate). The current `cron.ts` is a top-level file; F2 introduced the convention of moving per-channel crons under `crons/`.

**What to copy (LIFT VERBATIM the entrypoint shell):**

- **File-header doc block** (cron.ts:1-16): same shape — purpose, Railway exit-code rule, schedule granularity, W2 kind/canal coherence.
- **`async function main(): Promise<void>` + try/catch + `process.exit`** (cron.ts:22-49): identical wrapping. The body becomes:
  1. `const since = await getLastSuccessfulRun(supabase, "mercadolibre", "orders"); // last connector_runs.completed_at where kind='channel' AND canal='mercadolibre'`
  2. `const connector = createMercadoLibreConnector(loadConfig());`
  3. `const orders = await connector.fetchOrders(since, ctx);`
  4. For each order, normalize → UPSERT into `sales`/`sale_items` → if unmatched item, run `runMatchCascade(item, cascadeCtx)` → UPSERT `product_mappings`.
  5. `recordConnectorRun(supabase, { kind: "channel", canal: "mercadolibre", started_at, completed_at, status, records_processed, records_failed, retry_count, ...})` at end-of-run in `finally` (single write, W2 invariant).
- **`recordConnectorRun` call** (cron.ts:29-41): **CRITICAL — `kind: "channel"` and `canal: "mercadolibre"`, NEVER `kind: "cron-heartbeat"`** (observability.ts:36-45 throws if mis-paired; this is the F2 W2 invariant carried forward).

**Logic distinct to this file:**

- **Cascade integration:** for every sale_item with `master_sku IS NULL` after normalize, call F2's `runMatchCascade(item, cascadeCtx)` and `persistMatch(supabase, item, result)`. **DO NOT re-implement cascade** (CONTEXT.md anti-goal). If F2 Wave 2's `packages/connectors/src/matching/cascade.ts` isn't on disk yet, the F2.1 PLAN must serialize this cron behind F2 Wave 2 completion.
- **OAuth token guard:** if `loadAccessToken(supabase, "mercadolibre")` returns null (no cliente-provided credentials yet) → log structured warning, write `connector_runs.status="failed", errors_json={reason:"not_configured"}`, `process.exit(0)` (NOT 1 — Railway would alarm on exit 1 every 15 minutes during pre-OAuth period). Matches the WP "degraded mode" pattern from F2 Plan 2.2.1 (anti-goal: no Railway pager noise).
- **15-min cron schedule** is a Railway `[services.cron].schedule = "*/15 * * * *"` block in `railway.toml`.

**Pattern type:** LIFT VERBATIM the cron.ts entrypoint shell; STUDY AND WRITE FRESH the sync body (but the F2 sync-wp-orders.ts is the closest sibling).

---

### 10. Cron — `apps/orchestrator/src/crons/sync-ml-products.ts` (every 1 hour)

**Analog:** identical to sync-ml-orders.ts above (mirror its structure).

**What's different:**

- Calls `connector.fetchProducts(since, ctx)` instead of `fetchOrders`.
- Pipes each ML item through `variant-mapper.ts` → UPSERTs `master_products` + `product_variants` + `product_mappings`. For unmatched items, the cascade is NOT called here (products are the candidates, not the to-be-matched — the cascade runs on `sale_items` not `master_products`).
- **Re-embedding hook:** if F2 Wave 2 shipped a `reembed-products.ts` re-embedding cron (PATTERNS §"reembed" entries in F2 Wave 3), this cron should NOT re-embed inline — let the periodic reembed cron pick up the changes via `source_hash` invalidation (F2 Plan 2.2.3 RESEARCH §Pitfall 5).
- Schedule: `0 * * * *` (top of every hour).

**Pattern type:** LIFT VERBATIM from sync-ml-orders.ts (sibling), mutate body.

---

### 11. Cron — `apps/orchestrator/src/crons/ml-refresh-tokens.ts` (every 5 hours)

**Analog:** `apps/orchestrator/src/cron.ts:1-55` (entrypoint shape only).

**What to copy:**

- File-header doc block + `async function main` + try/catch + `process.exit` (same as #9 above).
- `recordConnectorRun({ kind: "channel", canal: "mercadolibre", ...metadata_json: { source: "token-refresh-cron" } })` — NOT `cron-heartbeat` because we are operating on the `mercadolibre` channel; the metadata distinguishes refresh runs from sync runs.

**Logic distinct:**

- Body: `select user_id from oauth_tokens where canal='mercadolibre' and expires_at < now() + interval '1 hour'` → for each, call `refreshToken(supabase, "mercadolibre", user_id)`. Errors logged + accumulated but do not throw (other users still get refreshed).
- **Safety net only:** lazy refresh on 401 in `api-client.ts` is the primary path. This cron exists for the edge case where lazy-refresh fails and no sync touches the token for >5h (CONTEXT.md Open Q2 resolution).
- Schedule: `0 */5 * * *`.

**Pattern type:** LIFT VERBATIM the cron entrypoint shell; STUDY AND WRITE FRESH the body.

---

### 12. Tests — `packages/connectors/__tests__/mercadolibre-state-mapper.test.ts`

**Analog:** F2 Plan 2.2.1 `packages/connectors/__tests__/wordpress/normalize-order.test.ts` (fixture-driven; golden file + `expect(mapStatus(...)).toEqual(...)`).

**What to copy:**

- Vitest structure: `describe("ML state mapper") → it("maps each ML status to internal estado", () => { ... })`.
- Fixture file: `packages/connectors/__tests__/__fixtures__/ml-order-paid.json` and `ml-order-cancelled-seller.json` (real-shape minimal ML order payloads, redacted of buyer PII).
- Assertion pattern: table-driven (`each.each` form) covering all ML status values in `ML_STATUS_MAP` + at least 2 unknown statuses (defaults to `"pendiente"`).

**Pattern type:** ROLE-MATCH — copy WP test structure, mutate fixtures + assertions.

---

### 13. Tests — `packages/connectors/__tests__/mercadolibre-oauth.test.ts`

**Analog:** F2 Plan 2.2.1 `packages/connectors/__tests__/wordpress/webhook-verify.test.ts` (the valid-sig vs. tampered-sig pattern).

**What to copy:**

- Vitest + MSW: mock the ML OAuth endpoint (`https://api.mercadolibre.com/oauth/token`) with `msw` (already a F2 devDep per Plan 2.0.4).
- Test cases: (a) `exchangeCodeForToken` with valid code returns `TokenResponse`; (b) with invalid code returns `{ error: "invalid_grant" }`; (c) `refreshToken` rotates both access AND refresh; (d) `loadAccessToken` returns cached value when not expired; (e) `loadAccessToken` refreshes when within 60s of expiry; (f) `loadAccessToken` retries once on 401.

**Pattern type:** ROLE-MATCH.

---

### 14. Tests — `apps/orchestrator/__tests__/mercadolibre-webhook.test.ts`

**Analog:** **NO F1/F2 ANALOG** — the orchestrator has no `__tests__` directory today. F2.1 introduces the convention.

**What to copy (style only, from RESEARCH):**

- Vitest + Hono testing: build the app via `mountMercadoLibreWebhook(app)`, then `await app.request("/webhooks/mercadolibre?topic=orders_v2&user_id=...&signature=<computed>", { method: "POST", body: "..." })`.
- Test cases: (a) valid signed query → 200 + `raw_events` row inserted; (b) tampered signature → 401; (c) missing required query param → 401 (canonical-string mismatch); (d) duplicate `sent` timestamp → 200 + no second insert (idempotency); (e) unknown topic (`questions`) → 200 + log "dropped"; (f) database insert fails → 500.

**Pattern type:** STUDY AND WRITE FRESH (no analog).

---

### 15. Env vars update — `apps/orchestrator/.env.example` (MODIFY)

**Analog:** existing file. ML slots `ML_CLIENT_ID` / `ML_CLIENT_SECRET` already exist at lines 30-32 (in the F1 file; verify current line numbers post-F2 Wave 0).

**What to add:**

- `ML_REDIRECT_URI=` (the OAuth callback URL — `https://orchestrator.fakawholesale.com/oauth/mercadolibre/callback` in prod, `http://localhost:8080/oauth/mercadolibre/callback` in dev).
- `ML_WEBHOOK_SECRET=` (the app's shared secret for signing webhook query params).
- Comment block above the ML block: `# Mercado Libre (F2.1) — OAuth + webhook. Graceful degrade when ML_CLIENT_ID/SECRET unset: connector returns ok:false, sync no-ops, webhook 503s.` (Mirror the WP block's comment at lines 22-24.)

**Pattern type:** EXACT (extend existing block in-place).

---

### 16. Railway schedules — `apps/orchestrator/railway.toml` (MODIFY)

**Analog:** existing file `[services.cron].schedule = "*/30 * * * *"` block.

**What to add:**

- Three new `[[services]]` blocks (one per ML cron) OR three `[[services.cron]]` sub-blocks if Railway supports multiple schedules per service. **Research needed:** Railway's TOML schema for multi-cron — F2.1 PLAN must confirm. If single-schedule-per-service, create three services (`orchestrator-cron-ml-orders`, `orchestrator-cron-ml-products`, `orchestrator-cron-ml-refresh`), each with `startCommand = "node dist/crons/sync-ml-orders.js"` etc.
- Extend the F2-environment-surface comment block at the bottom: add ML vars (`ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI, ML_WEBHOOK_SECRET`) under a new `# Mercado Libre (F2.1):` section.

**Pattern type:** EXACT (extend in-place).

---

## Shared Patterns

### OAuth token lifecycle (NEW in F2.1)

**Source:** `packages/connectors/src/mercadolibre/oauth.ts` (new file).
**Apply to:** every ML API call site (`api-client.ts`, all three crons, the webhook route's reconciliation pull).
Pattern: `await loadAccessToken(supabase, "mercadolibre", { userId, lazyRefreshOn401 })`; on 401 from ML, retry once after `refreshToken(...)`. Refresh token rotates on every refresh — UPSERT replaces BOTH tokens atomically. The `ml-refresh-tokens.ts` cron is a 5h safety net, not the primary path.

### Idempotent UPSERT (REUSED from F1)

**Source:** `packages/connectors/src/idempotency.ts:35-55` + usage in `csv/index.ts:211-214, 259-263`.
**Apply to:** ML sales writes (`onConflict: "canal,external_order_id"`), product_mappings writes (`onConflict: "canal,external_id"`), `oauth_tokens` upserts (`onConflict: "canal,user_id"` — NEW composite key F2.1 adds).
Pattern: identical to F1 — `supabase.from(table).upsert(rows, { onConflict })`. Composite keys are the F1 LOCKED invariant.

### connector_runs writing (REUSED from F1 + F2's W2 invariant)

**Source:** `packages/connectors/src/observability.ts:31-75` + `apps/orchestrator/src/cron.ts:29-41`.
**Apply to:** every ML cron (sync-orders, sync-products, refresh-tokens) + the webhook route's heavy-lifting path.
Pattern: write ONCE at end of run in `finally`. **`kind:"channel", canal:"mercadolibre"` for ALL ML runs** — never `cron-heartbeat` (W2 invariant from F2 PATTERNS). The token-refresh cron operates on the ML channel; it is NOT a generic heartbeat.

### Retry + DLQ (REUSED from F1)

**Source:** `packages/connectors/src/retry.ts:30-67`.
**Apply to:** every ML API call (orders search, item fetch, OAuth exchange/refresh).
Pattern: `withRetryAndDLQ(() => apiCall(), { canal: "mercadolibre", source: "<orders.fetch|oauth.refresh|items.search>", payload, maxRetries: 3 }, supabase)`. ML's 429 rate-limit responses count as retryable; 401 throws an `MLUnauthorizedError` that the caller catches separately for token-refresh.

### Hono handler shape (REUSED from F1)

**Source:** `apps/orchestrator/src/server.ts:18-50`.
**Apply to:** the new ML webhook route.
Pattern: build `ctx = { supabase, logger }` inline from `getSupabase()` + `log.*`; wrap handler body in `try/catch`; return `c.json({error}, status)` envelope on failure; `c.json({ok:true})` on success. The ML webhook adds signed-query-params verification BEFORE building ctx (verify is cheap; ctx build is wasted on tampered requests).

### Cron entrypoint shape (REUSED from F1)

**Source:** `apps/orchestrator/src/cron.ts:1-55`.
**Apply to:** all three ML crons.
Pattern: top-of-file doc block (purpose + Railway exit-code rule + schedule note), `async function main()` body, `process.exit(0)` on success, `process.exit(1)` on unhandled (except OAuth-not-configured → exit 0 to silence Railway alarms).

### Migration file header (REUSED from F1)

**Source:** every existing migration's leading comment block.
**Apply to:** `20260615000001_oauth_tokens.sql` + any additive migration F2.1 adds (e.g. `raw_events` dedup index).
Pattern: `-- Migration NNNNNNNNNNNN — <Name>. -- Phase 2.1 / Plan W.X.Y. -- -- <3-5 lines of purpose + invariants this file maintains>`.

### Migration RLS conventions — DIVERGENCE for oauth_tokens

**Source:** `20260513000010_rls_policies.sql:19-50` (the F1 baseline: enable RLS + add `authenticated_select_<table>` policy).
**Apply to:** every NEW user-readable table except `oauth_tokens`.
**Divergence (DO NOT apply to oauth_tokens):** `oauth_tokens` enables RLS but adds NO policies. `revoke all from authenticated` and `revoke all from anon` to make the intent explicit. Service-role JWT bypasses RLS — that is the only write path. Document the divergence in the migration header.

### Pure-function normalizer envelope (REUSED from F2 W1 invariant)

**Source:** `packages/connectors/src/csv/index.ts:148-182` (safe-normalize discriminated union).
**Apply to:** `state-mapper.ts`, `variant-mapper.ts`, normalize logic inside `mercadolibre/index.ts`.
Pattern: every normalizer returns `T | { _error }`. Outer caller accumulates errors instead of throwing — partial-batch resilience. **`mercadolibre/*.ts` MUST NOT import `applyColumnMap`** (W1 invariant from F2 PATTERNS — that helper is CSV-only).

---

## No Analog Found

| File / pattern                                                          | Role             | Data Flow              | Reason                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ---------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mercadolibre/oauth.ts` — OAuth code-exchange + refresh-token rotation  | service          | request-response       | No OAuth flow exists in F1/F2. WP uses static API keys; CSV is server-action only. Style guide is `csv/index.ts` helper shape, but logic is fresh.                           |
| `mercadolibre-webhook.ts` — signed-query-params HMAC                    | controller       | event-driven           | F2's WP webhook signs the raw BODY (HMAC of bytes per RESEARCH §Pitfall 2). ML signs the QUERY STRING (no body involvement). Distinct verify; envelope from `server.ts`.     |
| `apps/orchestrator/__tests__/`                                          | test directory   | n/a                    | Orchestrator has no test directory at planning time. F2.1 introduces the convention. Style guide is `packages/connectors/__tests__/*.test.ts`.                               |
| `oauth_tokens` table — no authenticated SELECT policy                   | migration        | DDL                    | Every other F1 table has a baseline `authenticated_select` policy. `oauth_tokens` intentionally has none — service-role only. Documented divergence.                         |
| Multiple Railway cron schedules per orchestrator                        | infra            | n/a                    | F1 has a single cron service with one schedule. F2.1 needs 3 (orders 15m, products 1h, refresh 5h). Railway's multi-cron TOML syntax — research-needed pre-PLAN.             |

---

## Anti-duplication Invariants

These cross-phase invariants MUST NOT be broken by Phase 2.1. Every plan reviewer's checklist should grep for them.

- **CC-11 (CARRIED FORWARD from F2) — No `NEXT_PUBLIC_ML_*` / `NEXT_PUBLIC_WORDPRESS_*` / `NEXT_PUBLIC_OPENAI_*` / `NEXT_PUBLIC_MOONSHOT_*` / `NEXT_PUBLIC_ANTHROPIC_*` env vars.** ML credentials (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_WEBHOOK_SECRET`) are orchestrator-only. Dashboard never imports `@faka/connectors/mercadolibre` or makes any browser-side call to `api.mercadolibre.com`. Grep gate (from F2 Plan 2.0.2 eslint rule): `grep -E 'NEXT_PUBLIC_.*(SERVICE|SECRET|PRIVATE|WORDPRESS|OPENAI|MOONSHOT|ANTHROPIC|MERCADOLIBRE|ML_)' apps/dashboard/.env.example apps/dashboard/vercel.json` returns ZERO matches. Extend the F2-introduced eslint regex in `packages/config/eslint.base.cjs` to include `MERCADOLIBRE|ML_CLIENT|ML_REDIRECT|ML_WEBHOOK` patterns.

- **CC-12 (CARRIED FORWARD from F2) — Every new view declares `with (security_invoker = true)`.** F2.1 adds NO new views (CONTEXT.md In Scope is explicit: dashboard "Hoy" + "Matching" already exist via F2 Wave 4; ML rows show up via existing role-gated views without new pages). If a researcher proposes a `v_ml_*` view, push back — the channel-agnostic F2 views already aggregate ML's data once `sales.canal='mercadolibre'` rows exist. Grep gate stays at file-creation time: if any `create view` lands in F2.1 without `security_invoker = true`, block merge.

- **F2-CASCADE-REUSE (NEW for F2.1) — Do NOT re-implement the matching cascade.** F2.1's `sync-ml-orders.ts` calls `runMatchCascade(item, ctx)` from `@faka/connectors/matching` (F2 Wave 2 output). If F2 Wave 2 has not landed at F2.1 plan-time, the F2.1 PLAN must serialize sync-ml-orders.ts behind F2 Wave 2 completion OR propose extracting `runMatchCascade` to a standalone PR landed before F2.1 Wave 3. **Grep gate:** `grep -E '(matchByBarcode|matchByEmbedding|arbitrateCandidate|cascade)' packages/connectors/src/mercadolibre/` returns ZERO matches (no level-X imports inside the ML connector). The ML connector calls cascade via the orchestrator (cron file), not via direct imports.

- **F2-LLM-ADAPTER (CARRIED FORWARD from F2 + F1) — No second LLM adapter implementation.** `@faka/llm` (extracted in F2 Plan 2.0.1) is the SINGLE owner of provider routing. F2.1 does not import `@ai-sdk/*` packages directly — only via cascade level 5 which lives in F2's package. Grep gate: `grep -c '@ai-sdk/' packages/connectors/src/mercadolibre/` returns ZERO.

- **HMAC-PATTERN-DIVERGENCE (NEW for F2.1, documented) — WP and ML have DIFFERENT signature verification.** WP signs the raw BODY (`createHmac('sha256', secret).update(rawBody).digest('base64')` per F2 Plan 2.2.1's `webhook-verify.ts`). ML signs a CANONICAL QUERY STRING. The verify functions are NOT interchangeable. F2.1 documents the divergence in `mercadolibre-webhook.ts`'s top-of-file doc block. **Proposed shared abstraction:** if F2 Wave 2 has not yet landed `wordpress/webhook-verify.ts`, F2.1 Wave 0 can introduce `packages/connectors/src/webhook-verify.ts` exposing `verifyHmac(secret, signatureHex, canonicalString): boolean` — both WP and ML wrap it with their own canonical-string builder. **Otherwise defer the refactor to F3** (POS adds a third HMAC variant which is the natural trigger for the abstraction).

- **W1 (CARRIED FORWARD from F2) — `applyColumnMap` is CSV-only.** `mercadolibre/*.ts` MUST NOT import `applyColumnMap`. Grep gate: `grep -c 'applyColumnMap' packages/connectors/src/mercadolibre/*.ts` returns 0. ML normalizers map JSON fields directly.

- **W2 (CARRIED FORWARD from F2) — `cron-heartbeat` stays out of the `channel` enum.** F2.1's three ML crons (`sync-ml-orders.ts`, `sync-ml-products.ts`, `ml-refresh-tokens.ts`) write `recordConnectorRun({ kind: "channel", canal: "mercadolibre", ... })`. Only the existing `apps/orchestrator/src/cron.ts:29-41` heartbeat uses `kind:"cron-heartbeat", canal:null`. Source enforcement: `observability.ts:36-45` throws on mismatch. The token-refresh cron is NOT a heartbeat — it operates on the `mercadolibre` channel.

- **CC-13 (CARRIED FORWARD from F2) — Storage payloads immutable.** ML webhook payloads go to `raw_orders.payload_json` and `raw_events.payload_json` — append-only. No `UPDATE raw_orders SET payload_json = ...` ever. The cron's reconciliation pull writes a new `raw_orders` row per resource, never mutates existing rows.

- **CC-14 (CARRIED FORWARD from F1+F2) — `messaging_log` stays empty in Phase 2.1.** ML messaging API is explicitly out of scope (CONTEXT.md anti-goal — deferred to F5.5). The ML webhook handler MUST NOT route `topic:messages` payloads to `messaging_log` — log + drop (200 ack).

- **F2.1-NEW — Single ML site (MCO) hardcoded.** No env var for siteId; no env var for currency. The string `"MCO"` appears as a const in `mercadolibre/index.ts` and `mercadolibre/api-client.ts`. The string `"COP"` is the default currency for ML rows. Multi-site (MLA/MLM/MLB) is deferred (CONTEXT.md out-of-scope).

- **F2.1-NEW — Single ML seller account (v1).** `oauth_tokens` has `unique (canal, user_id)` but v1 only writes one row per canal. Multi-account support is deferred (CONTEXT.md out-of-scope).

- **F2.1-NEW — `oauth_tokens` is the only table with no `authenticated` SELECT policy.** All other F1/F2 tables grant baseline SELECT to authenticated; `oauth_tokens` does not. Documented divergence in migration 20260615000001's header.

---

## Metadata

**Analog search scope:** `/home/mandark/faka/packages/connectors/**`, `/home/mandark/faka/packages/db/supabase/migrations/**`, `/home/mandark/faka/apps/orchestrator/**`, `/home/mandark/faka/.planning/phases/2-walking-skeleton-wp/PATTERNS.md`, `/home/mandark/faka/.planning/phases/2-walking-skeleton-wp/PLAN.md`
**Files Read in full:** 14 (csv/index.ts, wordpress/index.ts, mercadolibre/index.ts skeleton, types.ts, idempotency.ts, observability.ts, retry.ts, server.ts, cron.ts, lib/supabase.ts, lib/log.ts, registry.ts, migrations 0002/0003/0004/0005/0010/20260601000001/20260601000002, env.example, railway.toml, F2 PATTERNS.md, F2 PLAN.md head + Wave 2 detail, CONTEXT.md)
**Strong analogs found:** 13 of 14 F2.1 file targets (the orchestrator-test directory has no analog)
**Pattern extraction date:** 2026-05-14

**Open coordination items for F2.1 planner:**

1. **F2 Wave 2 cascade dependency.** If `packages/connectors/src/matching/cascade.ts` has not landed at F2.1 plan-time, choose between (a) F2.1 Wave 3 blocks on F2 Wave 2 completion, or (b) extract `runMatchCascade` to a standalone PR before F2.1 Wave 3. CONTEXT.md "Depends On" already flags this.
2. **F2 Wave 2 WordPress connector analog.** Many F2.1 patterns reference F2's `wordpress/webhook-verify.ts`, `wordpress/client.ts`, `wordpress/normalize-order.ts` as the closest analog. If F2 Wave 2 has not landed, use F2 PATTERNS §1 spec + RESEARCH §Pattern 1+2 as the source — the F2 plan is detailed enough to act as the analog.
3. **Shared webhook-verify abstraction.** F2.1 Wave 0 could introduce `packages/connectors/src/webhook-verify.ts` (HMAC-SHA256 + `timingSafeEqual` + caller-supplied canonical-string builder) IF F2 Wave 2's `wordpress/webhook-verify.ts` has not landed. Otherwise defer to F3 (POS adds the natural third HMAC variant).
4. **Railway multi-cron TOML syntax.** F2.1 PLAN must research Railway's TOML schema for either multiple `[services.cron].schedule` blocks per service or multiple service definitions. Affects railway.toml structure for 3 crons.
5. **Additive migrations beyond `oauth_tokens`.** F2.1 may also need: (a) `unique (canal, tipo_evento, payload_json->>'resource', payload_json->>'sent')` partial index on `raw_events` for webhook dedup; (b) `unique (master_sku, atributos_json)` on `product_variants` for variant idempotency. Both are flagged in the per-file sections above.
