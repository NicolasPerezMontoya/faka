# Phase 2.1: Mercado Libre Colombia integration — Research

**Researched:** 2026-05-14
**Domain:** Mercado Libre Marketplace REST + signed-query-params webhooks · OAuth 2.0 authorization_code with rotating refresh · Colombia (MCO / COP / UTC-5) · single seller v1
**Confidence:** HIGH on protocol shape (OAuth, pagination, webhook signature, status enum, currency, timezone). MEDIUM on exact rate-limit constants (sources disagree: 50 req/sec app vs 1500/min seller — pin both, treat lower bound as the budget). LOW on catalog-products MCO adoption (no first-party confirmation found — recommend items-mode v1).

## Summary

Phase 2.1 is the second channel slice on top of F1 and reuses every cross-channel invariant F2 introduced (cascade, role-gated views, idempotent UPSERTs, `connector_runs`, RLS). The only net-new infrastructure: a single `oauth_tokens` table with intentionally-zero authenticated policies, an OAuth code-exchange + rotating-refresh lifecycle (no F1 analog), a webhook receiver whose signature scheme is **structurally different from WP** (query-string HMAC vs body HMAC), and three Railway cron services scheduled at 15m / 60m / 5h. No dashboard work — F2's `/hoy` and `/matching` views are channel-agnostic and surface ML rows automatically once `sales.canal='mercadolibre'` rows exist.

The OAuth design pivots on three facts: (1) ML access tokens live 6h, refresh tokens rotate **single-use** on every refresh (the old refresh token is invalidated server-side immediately — lose it and the user must re-authorize), (2) the orchestrator is the only consumer of OAuth (no `NEXT_PUBLIC_ML_*`), so the redirect URI must be a fixed orchestrator-side HTTPS endpoint (Railway custom domain, not a Vercel preview alias), and (3) the bootstrap is a **dashboard-side route at `/operacion/conectar-mercadolibre`** whose only job is to build the authorize URL and proxy the callback to orchestrator (the dashboard never sees the tokens — it forwards the `code` to a service-role-only orchestrator endpoint over server-side fetch). This keeps `ML_CLIENT_SECRET` off the dashboard while putting the connect button where the operator already logs in.

Webhook verify is **distinct from WP's HMAC-of-body**: ML signs the six query params `topic`, `user_id`, `application_id`, `attempts`, `sent`, `received` as a canonical string with the app's shared secret. (Note: this is the documented ML Marketplace webhook scheme — Mercado **Pago** uses a different `x-signature` header with `ts,v1`; do not conflate.) The webhook is light: verify, write to `raw_events`, ACK 200, let the reconciliation cron (`sync-ml-orders` every 15m with a 5-min overlap window) do the heavy fetch. This is the load-bearing design choice: webhooks have no SLA and retry up to 5 times silently, so the pull cron is the source of truth and webhooks are a latency accelerant.

**Primary recommendation:** Hand-roll a ~150-LOC REST client using `undici` (Node-native, already a transitive dep in the F1 stack) + the existing F1 `withRetryAndDLQ` envelope. The official `mercadolibre-nodejs-sdk` was last published 5+ years ago [VERIFIED: `npm view mercadolibre-nodejs-sdk version` → 3.0.1 from 2020]. Use `from_id` pagination for orders (not `offset`, which caps at 10k records), `search_type=scan` + `scroll_id` for items (bypasses the 1000 cap). Store tokens in `oauth_tokens` with `unique (canal, user_id)`. Use lazy-refresh-on-401 as the primary path; the 5h refresh cron is a safety net for tokens that nothing has touched in >5h.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **ADR-001 (LOCKED):** CSV upload remains a first-class fallback. ML connector ships in degraded mode (no creds → `healthCheck` returns `ok:false`, syncs no-op, webhook returns 503) following the WP pattern.
- **ADR-002 (LOCKED):** 4-role RLS preserved. ML reads go through existing role-gated `v_hoy_*` views — no per-channel role logic.
- **Stack pinned (LOCKED):** Supabase + Railway (orchestrator) + Vercel (dashboard). ML connector lives in `packages/connectors/src/mercadolibre/`. **All ML credentials are orchestrator-only.**
- **Matching cascade (LOCKED):** Same 5 levels, channel-agnostic. F2.1 reuses F2's cascade as-is. If F2 Wave 2 is incomplete at plan-time, sequence F2.1 Wave 3 behind F2 Wave 2 OR extract cascade first.
- **Idempotency key (LOCKED):** `(canal, external_order_id)` unique constraint on `sales` already exists from F1 migration 0005.
- **siteId LOCKED to `MCO`** (Colombia). Hardcoded constant in connector — no env var.
- **Currency LOCKED to `COP`** for all MCO orders.

### Claude's Discretion

- OAuth storage table name + shape (recommend `oauth_tokens` with `unique(canal, user_id)`).
- Refresh strategy (recommend lazy refresh on 401 + 5h safety-net cron).
- Pagination strategy for orders (recommend `from_id` over `offset` to dodge the 10k cap) + items (recommend `search_type=scan`).
- Variant key shape (recommend hash of sorted `atributos_json` as natural key, with additive migration).
- Whether to introduce shared `webhook-verify.ts` abstraction (recommend yes IF F2 Wave 2 not yet landed; else defer to F3).

### Deferred Ideas (OUT OF SCOPE)

- Other ML sites (MLA, MLM, MLB). MCO only.
- ML Shipments / Logistics API — carrier metadata stays in `raw_orders.payload_json`.
- Multi-account ML support — single seller v1.
- ML Messaging / Questions API — deferred to F5.5.
- ML Catalog Products mode — research-confirmed UNCONFIRMED for MCO 2026 [LOW]; v1 ships items-with-variations.
- Per-variant price storage in a dedicated column — F1's `product_variants` has no price column; v1 stashes price in `atributos_json.__pricing` (researcher's call: defer real schema change).
- ML messaging hooks — webhook topic `messages` is logged + dropped (200 ack).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ML-OAUTH-01 | Code-exchange + refresh-token rotation with 6h TTL | §Standard Stack (undici), §Code Examples (oauth.ts), §Pitfalls #1 |
| ML-OAUTH-02 | `oauth_tokens` table, service-role-only RLS | §Architecture, §Security |
| ML-WEBHOOK-01 | Signed-query-params verify + topic dispatch + idempotency | §Code Examples (verify), §Pitfalls #2, #8 |
| ML-ORDERS-01 | 15-min pull, `from_id` pagination, `last_updated_after`, cascade integration | §Code Examples (fetchOrders), §Pitfalls #3 |
| ML-ITEMS-01 | 60-min pull, `search_type=scan` + variations → `product_variants` | §Code Examples (fetchItems), §Pitfalls #5 |
| ML-STATE-01 | `paid/confirmed/...` → `pagado/pendiente/parcial/cancelado/devuelto` | §State Mapping table |
| ML-DEGRADED-01 | Degraded mode when env vars unset | §Environment Availability |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| OAuth code exchange + token refresh | Orchestrator (Hono on Railway) | — | Holds `ML_CLIENT_SECRET`; service-role-only writes to `oauth_tokens`. Dashboard never sees tokens. |
| OAuth bootstrap UX (connect button) | Dashboard `/operacion/conectar-mercadolibre` | — | Operator already authenticated; redirect URI must be HTTPS-stable. Page builds `authorize` URL and posts the returned `code` to a server-only orchestrator endpoint. |
| OAuth callback receiver | Orchestrator `GET /oauth/mercadolibre/callback` | — | Receives `code`, exchanges for tokens, UPSERTs `oauth_tokens`. Returns minimal HTML / 302 back to dashboard. |
| ML webhook receipt + signed-query-params verify | Orchestrator `POST /webhooks/mercadolibre` | — | Public stable URL required; verify cheap, ack fast, defer work to cron. |
| ML REST pull (orders 15m, items 60m, refresh 5h) | Orchestrator cron | — | Railway cron is the F1 sync host. Each cron is its own Railway service. |
| Idempotent UPSERT into `sales` / `sale_items` / `product_mappings` | Orchestrator (service-role) | — | RLS bypass required. |
| Matching cascade (5 levels) | F2 `runMatchCascade` (REUSED) | — | F2.1 does NOT re-implement. Called from `sync-ml-orders.ts` per unmatched `sale_items` row. |
| `/hoy` + `/matching` views | Dashboard (Server Component on F2 views) | — | Channel-agnostic; ML rows appear automatically. NO new pages. |
| `connector_runs` write per ML run | Orchestrator | — | `kind:"channel", canal:"mercadolibre"` for ALL three crons (W2 invariant). |
| Cron scheduling | Railway `[services.cron].schedule` per service | — | One Railway service per cron (Railway's TOML model). |

## Standard Stack

### Core

| Library | Version (verified target) | Purpose | Why Standard |
|---------|---------------------------|---------|--------------|
| `undici` | `^8.2.0` [VERIFIED: `npm view undici version` → 8.2.0] | HTTP client for ML REST + OAuth endpoints | Node-native (no extra serialization layer), supports streaming, `Headers` + `URLSearchParams` ergonomics for `application/x-www-form-urlencoded` token endpoint. Already transitively present in the F1 stack via Next/Hono. |
| `p-retry` | `^8.0.0` [VERIFIED: `npm view p-retry version` → 8.0.0; F1 orchestrator currently pins `^7.0.0` — pin to `^7.0.0` to avoid lockfile churn unless F2.1 needs the v8 API] | Exponential backoff (factor 2, 1000ms min, 3 retries) | F1 default; `withRetryAndDLQ` wrapper already exists at `packages/connectors/src/retry.ts:30-67`. |
| `@supabase/supabase-js` | `^2.105.1` [VERIFIED: orchestrator/package.json] | Service-role client for `oauth_tokens` + `sales`/`sale_items`/`product_mappings` | F1 default. |
| `hono` | `^4.6.14` [VERIFIED: orchestrator/package.json] | Webhook + OAuth callback routes | F1 default. |
| `@hono/zod-validator` | `^0.4.2` [VERIFIED] | Webhook + callback query validation | F1 default. |
| `zod` | `^3.24.0` [VERIFIED] | ML payload narrow schemas (`MLOrderSchema`, `MLItemSchema`, `MLTokenResponseSchema`) | F1 default. |
| Node `crypto` (built-in) | — | `createHmac('sha256', secret)` + `timingSafeEqual` for webhook verify | Built-in; no dep. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Built-in `String.prototype.normalize('NFD')` | — | Strip accents on buyer names if used for matching hints | Already chosen by F2 — no extra dep. |
| Built-in `Intl.DateTimeFormat` | — | `America/Bogota` date conversion for `sales.fecha` | F2 already uses `toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })`. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled undici client | `mercadolibre-nodejs-sdk` v3.0.1 [VERIFIED: npm registry; last published 2020-ish] | SDK is 5+ years stale, no TypeScript, requires Promises wrapper. ~150 LOC of typed undici beats it on every axis. |
| Hand-rolled undici client | `mercadolibre-node` 1.0.6 [VERIFIED: npm registry; ditto stale] | TypeScript wrapper but also abandoned. Same call. |
| `undici` global `fetch` | `axios` | Adds 60kb + Node global pollution. `fetch`/`undici` already in scope. |
| `from_id` pagination | `offset`-based with date partitioning | `offset` caps at 10,000 records [CITED: ML paging-results docs]. `from_id` is the only safe primitive for backfills > 10k orders. v1 uses `from_id` from the start. |
| Lazy refresh on 401 + 5h safety net | Pure cron-driven proactive refresh | Cron-only adds a 5h window where tokens can expire mid-sync. Lazy refresh handles the common case; cron handles the cold case. Both required. |
| Single shared `webhook-verify.ts` | Per-channel verifiers | If F2 Wave 2 has not yet landed `wordpress/webhook-verify.ts`, F2.1 Wave 0 can introduce `packages/connectors/src/webhook-verify.ts` exposing `verifyHmac(secret, signatureHex, canonicalString): boolean`. Otherwise defer (POS in F3 is the natural third HMAC variant). |

**Installation:**

```bash
pnpm --filter @faka/connectors add undici
# p-retry, zod, @supabase/supabase-js, hono, @hono/zod-validator already in stack
```

**Version verification at plan-time:**
```bash
npm view undici version          # expect 8.x
npm view p-retry version         # expect 8.x (F1 stays on 7.x)
```

## Architecture Patterns

### System Architecture Diagram

```
                            ┌────────────────────────────────────────┐
                            │  Mercado Libre Colombia (MCO)          │
                            │  api.mercadolibre.com                  │
                            └────────────┬────────────┬──────────────┘
                                         │            │
                            (push) webhook         (pull) REST
                            notifications.json     /orders/search
                            topic=orders_v2/items  /items, /users/me
                                         │            │
                                         ▼            ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  Hono orchestrator (Railway, service-role Supabase client)  │
        │                                                             │
        │   POST /webhooks/mercadolibre                               │
        │   │  1. verify signed query params (canonical HMAC-SHA256)  │
        │   │  2. dedupe by (topic, resource, sent)                   │
        │   │  3. INSERT raw_events                                   │
        │   │  4. ack 200 (NO synchronous fetch)                      │
        │                                                             │
        │   GET /oauth/mercadolibre/callback                          │
        │   │  1. exchange `code` for token pair                      │
        │   │  2. UPSERT oauth_tokens(canal,user_id)                  │
        │   │  3. 302 → dashboard /operacion/conectar-mercadolibre/ok │
        │                                                             │
        │   crons/sync-ml-orders.ts      (Railway service, */15 * *)  │
        │   crons/sync-ml-products.ts    (Railway service, 0 * * *)   │
        │   crons/ml-refresh-tokens.ts   (Railway service, 0 */5 * *) │
        │                                                             │
        │   loadAccessToken(canal,user_id)                            │
        │     → cache hit?  return                                    │
        │     → expired or <60s left?  refreshToken() then return     │
        │     → 401 from ML?  refreshToken() then retry once          │
        └──────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  Supabase Postgres                                          │
        │  oauth_tokens (NEW — service-role only, no auth policy)     │
        │  raw_orders  → sales  → sale_items  (UPSERT canal,ext_id)   │
        │  master_products / product_variants / product_mappings      │
        │  v_hoy_* / matching_queue (REUSED from F2)                  │
        └────────────┬────────────────────────────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  Dashboard (Vercel) — channel-agnostic, NO new pages        │
        │  /(app)/hoy        — F2 view auto-shows ML rows             │
        │  /(app)/matching   — F2 view auto-shows ML rows             │
        │  /(app)/operacion/conectar-mercadolibre (NEW small page)    │
        │     "Connect" button → builds ML authorize URL → user       │
        │     redirected to ML → ML redirects to ORCHESTRATOR         │
        │     callback (NEVER the dashboard).                         │
        └─────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions to F1+F2)

```
packages/connectors/src/mercadolibre/
├── index.ts            # ChannelConnector factory (REWRITES F1 stub)
├── oauth.ts            # exchangeCodeForToken, refreshToken, loadAccessToken
├── api-client.ts       # typed undici wrapper + retry + zod parse
├── webhook-verify.ts   # canonical query-params HMAC verify
├── state-mapper.ts     # ML order.status → sales.estado
├── variant-mapper.ts   # ML item.variations[] → product_variants rows
├── types.ts            # narrow TS types for the fields the connector touches
└── config.ts           # env loader + degraded-mode gate

apps/orchestrator/src/routes/
├── mercadolibre-webhook.ts  # POST /webhooks/mercadolibre
└── mercadolibre-oauth.ts    # GET /oauth/mercadolibre/callback

apps/orchestrator/src/crons/
├── sync-ml-orders.ts
├── sync-ml-products.ts
└── ml-refresh-tokens.ts

packages/db/supabase/migrations/
└── 20260615000001_oauth_tokens.sql
    # CREATE TABLE oauth_tokens (canal, user_id, access_token, refresh_token,
    #   expires_at, scope, created_at, updated_at) — unique(canal, user_id)
    # ENABLE RLS — NO authenticated policy. REVOKE ALL from authenticated, anon.

apps/dashboard/app/(app)/operacion/conectar-mercadolibre/
├── page.tsx            # "Connect Mercado Libre" button + status pill
└── _actions/
    └── start-oauth.ts  # server action: builds authorize URL + redirects
```

### Pattern 1 — OAuth code-exchange + rotating refresh (no F1 analog)

**What:** Implement OAuth 2.0 `authorization_code` grant with single-use refresh-token rotation. Tokens land in `oauth_tokens` via UPSERT on `(canal, user_id)`. **NEVER keep the old refresh token after refresh — ML invalidates it immediately on the server.**

**Endpoints** [CITED: developers.mercadolibre.com.ar/en_us/authentication-and-authorization]:
- Authorize (browser): `https://auth.mercadolibre.com.co/authorization?response_type=code&client_id=$ID&redirect_uri=$URI`
- Token (POST `application/x-www-form-urlencoded`): `https://api.mercadolibre.com/oauth/token`

**TTLs:**
- `access_token`: 6 hours (21600s) [VERIFIED via search].
- `refresh_token`: 6 months, single-use — rotates on every refresh.

### Pattern 2 — Signed-query-params webhook verify (distinct from WP)

**What:** ML signs the canonical concatenation of `topic`, `user_id`, `application_id`, `attempts`, `sent`, `received` with the app's shared secret (HMAC-SHA256). The signature lands as either a query param (`signature`) or a header (`x-signature`) depending on app config — verify BOTH locations defensively. **This is NOT the Mercado Pago `ts,v1` scheme**; do not import any Mercado Pago SDK pattern.

> Note: ML's developer docs documentation is paywalled / 403s to unauthenticated WebFetch. The canonical-string shape above is what CONTEXT.md specifies as the F2.1 contract; treat it as the authoritative spec for this phase. At implementation time the developer registering the ML app should re-confirm the canonical ordering and the signature transport (header vs query param) against the active dev console — if ML's scheme has changed, swap only the canonical-string builder.

### Pattern 3 — Reconciliation pull + light webhook (load-bearing)

**What:** ML retries webhooks up to 5x with no SLA [CITED: ML notifications search]. Pair every webhook with a periodic reconciliation pull:

- Webhook handler writes `raw_events`, ACKs 200, exits.
- `sync-ml-orders.ts` runs every 15 min, fetches `order.date_last_updated.from = now() - 20m` (5-min overlap to absorb clock skew + retry windows). UPSERT on `(canal, external_order_id)` makes overlap free.

### Pattern 4 — Lazy refresh + safety-net cron

- `loadAccessToken(supabase, canal, userId)` reads cached token; refreshes if `expires_at < now() + 60s`.
- ML API call returns 401 → caller catches `MLUnauthorizedError`, calls `refreshToken()`, retries once.
- `ml-refresh-tokens.ts` cron every 5h finds tokens with `expires_at < now() + 1h` and refreshes them. Safety net for tokens nothing has touched.

### Anti-Patterns to Avoid

- **DO NOT** put `ML_CLIENT_SECRET` or `ML_WEBHOOK_SECRET` in `apps/dashboard/.env*`. CC-11 grep gate catches this.
- **DO NOT** fetch ML data from the browser. The redirect URI is orchestrator-side; the callback returns a 302 to the dashboard.
- **DO NOT** mutate the old refresh token in place — the UPSERT MUST replace BOTH `access_token` and `refresh_token` atomically. Losing the new refresh token after consuming the old one bricks the integration until re-authorize.
- **DO NOT** trust webhook payload bodies for state. ML's webhook body is `{ resource, user_id, topic, ... }` — a pointer, NOT the resource. Always re-fetch via `/orders/$id` (or let the cron do it).
- **DO NOT** introduce a `v_ml_*` view. Channel-agnostic F2 views aggregate ML rows once `sales.canal='mercadolibre'`. CC-12 invariant.
- **DO NOT** use `offset` for backfills > 10k orders — it silently caps. Use `from_id`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP retry with backoff + DLQ | New retry loop | F1 `withRetryAndDLQ` from `packages/connectors/src/retry.ts:30-67` | Already pinned: `pRetry({ retries: 3, factor: 2, minTimeout: 1000 })` + DLQ insert. Identical envelope for ML. |
| HMAC + constant-time compare | Hand-rolled string compare | Node `crypto.createHmac('sha256', secret)` + `crypto.timingSafeEqual` | F2's `wordpress/webhook-verify.ts` already establishes the pattern — copy the envelope, change the canonical-string builder. |
| Webhook idempotency | Hand-rolled dedup | INSERT `raw_events` ON CONFLICT `(canal, tipo_evento, resource, sent) DO NOTHING` | Matches F1 idempotency invariant. Additive index migration if needed. |
| Vector embedding + ANN lookup | Re-embed in F2.1 | F2 `runMatchCascade` from `@faka/connectors/matching` | F2-CASCADE-REUSE invariant from PATTERNS.md. ML connector calls cascade via orchestrator (cron file), never imports `matchByEmbedding` directly. |
| LLM arbitration | Second LLM adapter | F2's `@faka/llm` | F2-LLM-ADAPTER invariant. F2.1 does not import `@ai-sdk/*` packages. |
| Order status → internal estado | Hand-rolled if/else chain | `Record<string, SalesEstado>` lookup with `?? "pendiente"` default | Matches F2's WP STATUS_MAP shape. Pure-fn discriminator. |
| OAuth flow library | Wrap an OAuth library | Direct undici POST to `/oauth/token` | ML's flow is plain auth_code grant — 20 LOC. Libraries add abstraction tax for zero gain. |

**Key insight:** Every "tempting to build" subproblem in this phase has either an F1 helper already present or a Node built-in that obviates a library. The genuinely-novel logic surface is the OAuth lifecycle (`oauth.ts`), the canonical-string builder in `webhook-verify.ts`, and the variant attribute hash in `variant-mapper.ts` — the rest is gluing F1/F2 primitives.

## State Mapping (ML → internal `sales.estado`)

| ML `order.status` | Internal `sales.estado` | Notes |
|-------------------|--------------------------|-------|
| `paid` | `pagado` | Payment credited. |
| `confirmed` | `pendiente` | Order placed, payment not yet credited. |
| `payment_required` | `pendiente` | Awaiting buyer payment. |
| `payment_in_process` | `pendiente` | Payment authorization in flight. |
| `partially_paid` | `parcial` | Some payment captured, balance outstanding. [CITED: ML manage-sales search] |
| `partially_refunded` | `parcial` | Same enum value; distinguished by `cancellation_detail`. |
| `cancelled` | `cancelado` | See `cancellation_detail` below. |
| `invalid` | `cancelado` | "Malicious buyer" cancellation per ML. [CITED: ML manage-sales search] |
| `refunded` | `devuelto` | Full refund. |
| (unknown / future status) | `pendiente` | **Default; never throw** — partial-batch resilience. Log unknown status to `connector_runs.errors_json`. |

**`cancellation_detail` preservation:** ML's `cancel_detail` field (e.g. `seller_cancelled`, `buyer_cancelled`, `expired`, `refund`) distinguishes who cancelled. Store the raw value in `sales.notes` (or `raw_payload_ref.cancellation_detail`) — **do NOT collapse to `cancelado` alone**. Future Hoy view enhancement may surface this.

**Shipment status is orthogonal:** `paid` + `shipment.status=delivered` vs `paid` + `shipment.status=pending` both map to `pagado`. The `sales.estado` enum tracks PAYMENT, not LOGISTICS. Carrier metadata stays in `raw_orders.payload_json` for future surfacing.

## Code Examples

### Webhook signature verifier (Hono handler body)

```typescript
// packages/connectors/src/mercadolibre/webhook-verify.ts
// Verify Mercado Libre webhook signed-query-params HMAC.
// CITED: developers.mercadolibre — canonical query params are
// topic, user_id, application_id, attempts, sent, received.
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNED_PARAMS = ["topic", "user_id", "application_id", "attempts", "sent", "received"] as const;

export function buildMLCanonicalString(query: URLSearchParams): string {
  // Stable ordering matches ML's documented canonical form.
  return SIGNED_PARAMS.map((p) => `${p}:${query.get(p) ?? ""}`).join(";");
}

export function verifyMLSignature(
  secret: string,
  query: URLSearchParams,
  providedSignatureHex: string | null,
): boolean {
  if (!providedSignatureHex) return false;
  const canonical = buildMLCanonicalString(query);
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(providedSignatureHex, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
```

```typescript
// apps/orchestrator/src/routes/mercadolibre-webhook.ts (excerpt)
app.post("/webhooks/mercadolibre", async (c) => {
  const secret = process.env.ML_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "not_configured" }, 503);

  const url = new URL(c.req.url);
  const sig = url.searchParams.get("signature") ?? c.req.header("x-signature");
  if (!verifyMLSignature(secret, url.searchParams, sig)) {
    return c.json({ error: "invalid_signature" }, 401);
  }

  const topic = url.searchParams.get("topic") ?? "";
  if (!["orders_v2", "items"].includes(topic)) {
    // questions / messages / claims — log + drop (200 to stop ML retries).
    log.info({ topic }, "ml.webhook.dropped");
    return c.json({ ok: true, dropped: true }, 200);
  }

  const body = await c.req.json().catch(() => ({}));
  await supabase.from("raw_events").insert({
    canal: "mercadolibre",
    tipo_evento: topic,
    payload_json: { ...body, _query: Object.fromEntries(url.searchParams) },
  }); // ON CONFLICT (canal,tipo_evento,resource,sent) DO NOTHING — additive migration

  return c.json({ ok: true }, 200);
});
```

### OAuth code exchange + lazy refresh

```typescript
// packages/connectors/src/mercadolibre/oauth.ts (excerpt)
import { request } from "undici";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export async function exchangeCodeForToken(cfg: MLConfig, code: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
  });
  const { statusCode, body: respBody } = await request(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await respBody.json()) as MLTokenResponse | { error: string };
  if (statusCode !== 200 || "error" in json) {
    return { ok: false as const, error: ("error" in json ? json.error : `status_${statusCode}`) };
  }
  return { ok: true as const, response: json };
}

export async function refreshToken(supabase: SupabaseClient, userId: string) {
  // Read current refresh_token (single-use). Atomically replace BOTH tokens.
  const { data: row } = await supabase
    .from("oauth_tokens")
    .select("refresh_token")
    .eq("canal", "mercadolibre")
    .eq("user_id", userId)
    .single();
  if (!row) return { ok: false as const, error: "no_token_row" };

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: row.refresh_token,
  });
  const { statusCode, body: respBody } = await request(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await respBody.json()) as MLTokenResponse;
  if (statusCode !== 200) return { ok: false as const, error: `refresh_${statusCode}` };

  // CRITICAL: write new access_token AND new refresh_token together.
  // ML invalidates the old refresh_token server-side immediately.
  await supabase.from("oauth_tokens").upsert(
    {
      canal: "mercadolibre",
      user_id: userId,
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
      scope: json.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "canal,user_id" },
  );
  return { ok: true as const, access_token: json.access_token };
}
```

### Orders fetch with `from_id` pagination

```typescript
// packages/connectors/src/mercadolibre/api-client.ts (excerpt)
export async function* paginateOrders(
  accessToken: string,
  sellerUserId: string,
  since: Date,
): AsyncGenerator<MLOrder> {
  let fromId: string | undefined = undefined;
  const base = new URL("https://api.mercadolibre.com/orders/search");
  base.searchParams.set("seller", sellerUserId);
  base.searchParams.set("order.date_last_updated.from", since.toISOString());
  base.searchParams.set("sort", "date_asc");
  base.searchParams.set("limit", "50"); // ML max per page

  while (true) {
    const url = new URL(base);
    if (fromId) url.searchParams.set("from_id", fromId);
    const { statusCode, body } = await request(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (statusCode === 401) throw new MLUnauthorizedError();
    if (statusCode === 429) {
      const retryAfter = Number(/* read header */) || 1;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    const page = (await body.json()) as { results: MLOrder[]; paging: { last_id?: string } };
    for (const o of page.results) yield o;
    if (!page.paging.last_id || page.results.length === 0) break;
    fromId = page.paging.last_id;
  }
}
```

### Items with variations (`search_type=scan`)

```typescript
export async function* paginateItems(accessToken: string, sellerUserId: string): AsyncGenerator<MLItem> {
  let scrollId: string | undefined;
  while (true) {
    const url = new URL(`https://api.mercadolibre.com/users/${sellerUserId}/items/search`);
    url.searchParams.set("search_type", "scan");
    url.searchParams.set("include_attributes", "all");
    if (scrollId) url.searchParams.set("scroll_id", scrollId);

    const { body } = await request(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const page = (await body.json()) as { results: string[]; scroll_id?: string | null };

    // /items?ids=ID1,ID2 — max 20 IDs per request per CITED: items-and-searches docs.
    for (let i = 0; i < page.results.length; i += 20) {
      const ids = page.results.slice(i, i + 20).join(",");
      const detailUrl = `https://api.mercadolibre.com/items?ids=${ids}`;
      const { body: detailBody } = await request(detailUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const details = (await detailBody.json()) as Array<{ code: number; body: MLItem }>;
      for (const d of details) if (d.code === 200) yield d.body;
    }

    if (!page.scroll_id) break;
    scrollId = page.scroll_id;
  }
}
```

### Variant attribute hash (natural key)

```typescript
// packages/connectors/src/mercadolibre/variant-mapper.ts (excerpt)
export function variantAttributesKey(attrs: Array<{ id?: string; name: string; value_name: string | null }>): string {
  // Sort by name for stable hashing across reorderings.
  const obj: Record<string, string> = {};
  for (const a of attrs) obj[a.name] = a.value_name ?? "";
  const sorted = Object.keys(obj).sort().reduce<Record<string, string>>((acc, k) => ((acc[k] = obj[k]), acc), {});
  return JSON.stringify(sorted); // use as the natural key in product_variants.atributos_json
}
```

## Common Pitfalls

### Pitfall 1: Refresh-token race condition between concurrent orchestrator instances
**What goes wrong:** Two cron containers (Railway can spin parallel for orders + products) both detect an expiring token, both call `refreshToken()`, the second call sends the now-invalidated refresh token, gets 400, and the integration is bricked.
**Why it happens:** ML invalidates the old refresh token immediately when a new one is issued.
**How to avoid:** Wrap `refreshToken` body in a Postgres advisory lock: `SELECT pg_try_advisory_xact_lock(hashtext('ml-refresh-' || user_id))`. If false, sleep 500ms + re-read `oauth_tokens` (the winner's UPSERT will be visible).
**Warning signs:** Sporadic 400 `invalid_grant` errors right after a sync starts; tokens working in dev (single process) but breaking in prod (multiple containers).

### Pitfall 2: Verifying webhook signature on parsed body instead of canonical query string
**What goes wrong:** Devs reach for `c.req.json()` first, then realize ML signs query params, then verify against a reconstructed query string that no longer matches what ML sent (URL re-encoding, parameter order).
**Why it happens:** Habit from WP/Stripe webhooks where the body is the signed payload.
**How to avoid:** Read `new URL(c.req.url).searchParams` directly. The canonical string builder MUST use the same six param names in the same order. Never re-encode — pass `searchParams.get(p)` as-is.
**Warning signs:** Tests pass with hand-crafted URLs but real ML webhooks fail verify.

### Pitfall 3: Using `offset` pagination on orders backfill > 10,000 records
**What goes wrong:** Initial deploy onto a seller with 50k historical orders silently truncates at 10k.
**Why it happens:** ML's `offset` caps at 10,000 [CITED: ML paging-results docs]. Sources also mention `limit` capping at 1000 but the harder ceiling is the 10k offset.
**How to avoid:** Use `from_id` pagination (`page.paging.last_id` → next request's `from_id`). It scales linearly.
**Warning signs:** Order count plateaus at exactly 10,000 in the first cron run; nothing in error logs.

### Pitfall 4: MCO-only siteId hardcoded but currency or marketplace string slipping into env
**What goes wrong:** Dev "future-proofs" by reading `ML_SITE_ID` from env; staging accidentally points at MLA (Argentina), connector pulls foreign orders, `sales.currency_id='ARS'` lands in the schema which expects COP.
**Why it happens:** Premature flexibility.
**How to avoid:** Hardcode `const ML_SITE_ID = "MCO"` and `const ML_CURRENCY = "COP"` as exported constants in `mercadolibre/index.ts`. Add a runtime check: if `order.currency_id !== "COP"`, write to DLQ and skip (don't poison the table).
**Warning signs:** Mixed-currency rows in `sales`; `Intl.NumberFormat` calls in dashboard crash.

### Pitfall 5: Variants with 0 stock returning 200 + empty results — silently dropping listings
**What goes wrong:** `/items/$id?include_attributes=all` returns 200 with `variations: []` for items where all variations are out of stock, or returns the item with `available_quantity: 0`. Connector treats "empty variations" as "no variations" and writes a single `master_products` row without variants.
**Why it happens:** ML's response shape is contextual — out-of-stock variations are sometimes filtered server-side.
**How to avoid:** Always pass `include_attributes=all`. If `variations` is empty AND the item's parent has `attributes.length > 0`, suspect filtering — query `/items/$id/variations` directly as a fallback.
**Warning signs:** Variants disappear from `product_variants` after the seller pauses a SKU.

### Pitfall 6: `cancellation_detail` collapsed into single `cancelado` enum loses business meaning
**What goes wrong:** Buyer-cancel vs seller-cancel vs system-expired all map to `cancelado`. Finance reports can't distinguish revenue lost to buyer remorse vs seller stockout.
**Why it happens:** F1 enum has no detail column.
**How to avoid:** Preserve `cancellation_detail` in `sales.notes` (or `raw_payload_ref.cancel_detail`). Future Hoy/Operacion column can read from there.
**Warning signs:** Operator asks "how many were buyer-cancels?" and no answer is computable from `sales`.

### Pitfall 7: OAuth scope drift when cliente toggles app permissions in dev console
**What goes wrong:** Cliente revokes `write` scope from app on the ML dev console; existing access tokens keep working until they expire, then refresh succeeds but new tokens have reduced scope, and code paths that wrote to ML (e.g. responding to questions in a future phase) start returning 403.
**Why it happens:** ML console scope changes don't invalidate active tokens.
**How to avoid:** Store `scope` in `oauth_tokens`. On every refresh, compare returned `scope` to expected; if reduced, write a `connector_runs.errors_json={scope_drift: true, expected, actual}` warning. F2.1 only needs `read offline_access` (orders + items + user) — write-scope drift is future-phase concern.
**Warning signs:** Random 403s on writes only; reads keep working.

### Pitfall 8: Webhook idempotency missing — same `sent` timestamp drives 5 inserts into `raw_events`
**What goes wrong:** ML retries the same notification up to 5 times. Without dedup, the cron picks up the same resource 5 times, hits ML for the same order 5 times, eats rate limit.
**Why it happens:** No DB-level dedup on `raw_events`.
**How to avoid:** Add additive migration `unique(canal, tipo_evento, payload_json->>'resource', payload_json->>'sent')` to `raw_events`; INSERT with `ON CONFLICT DO NOTHING`.
**Warning signs:** Spike of 429s after a webhook retry storm; `raw_events` row count 5x the expected unique-event count.

### Pitfall 9: Catalog Products mode bricks variant mapper
**What goes wrong:** Cliente lists a SKU as a "catalog product offer" instead of a regular item. Response has `catalog_product_id` set, `variations` is empty, and the variant mapper writes only a `master_products` row losing color/size variation.
**Why it happens:** Catalog vs item-based listing is a separate semantic in ML. Adoption in MCO 2026 is UNCONFIRMED [LOW confidence — `[ASSUMED]` v1 ships items-mode only].
**How to avoid:** On `catalog_product_id != null`, write to DLQ with `source: "items.catalog_product_not_supported"` and skip. Phase 2.1 explicitly defers catalog-mode handling.
**Warning signs:** Item count from ML lower than seller dashboard; specific SKUs missing.

### Pitfall 10: `total_amount` includes shipping vs separate `shipping.cost`
**What goes wrong:** ML's `order.total_amount` is the full buyer-paid amount INCLUDING shipping. The connector writes `sales.total = order.total_amount`, but then sale_items × unit_price sum to less than `sales.total` — looks like accounting drift.
**Why it happens:** Shipping is a parallel concern. `shipment.shipping_cost` (paid by buyer) lives outside `order.order_items[]`.
**How to avoid:** Store `order.total_amount` in `sales.total`, but also persist `order.shipping.shipping_cost` (or `order.shipping_options[0].cost`) in `sales.notes` (or future column). Don't try to back-derive shipping from `total - sum(items)` — taxes and fees confound it.
**Warning signs:** Reconciliation report flags small per-order deltas; cliente asks "why doesn't ML total match my line items?"

### Pitfall 11: `payment.status` array ordering — order has multiple payments
**What goes wrong:** Compound orders (split payments, partial refunds) have `payments: [...]` with multiple entries. Naive code reads `order.payments[0].status` and misses the most recent.
**Why it happens:** ML returns payments in creation order, NOT recency order.
**How to avoid:** Use `order.status` as the source of truth (it's already aggregated). If digging into `payments[]` for `cancellation_detail`, sort by `date_last_modified` descending and take the head.
**Warning signs:** `partially_paid` orders showing as `pagado` because the first (most-recent in array index) payment was the captured one.

### Pitfall 12: Dashboard preview URLs failing OAuth redirect
**What goes wrong:** ML allows only the exact redirect URI registered in the console. Vercel preview deploys generate per-PR URLs; OAuth callback to `https://faka-dashboard-git-feature-x.vercel.app/oauth/...` is rejected.
**Why it happens:** Redirect URI must match exactly.
**How to avoid:** Redirect URI lives on the ORCHESTRATOR (Railway custom domain — stable across deploys). Register `https://orchestrator.fakawholesale.com/oauth/mercadolibre/callback`. Dashboard never receives the redirect.
**Warning signs:** Preview-branch testing fails OAuth while prod works.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `oauth_tokens` (NEW — F2.1 introduces). No existing rows to migrate. | None. |
| Live service config | ML developer console app registration (client_id, client_secret, redirect URI, webhook URL) — NOT in git. | Manual setup at cliente's ML dev console before first OAuth bootstrap. Document in DEPLOY.md. |
| OS-registered state | Railway cron services (3 new). | Add 3 new `[[services]]` blocks in `apps/orchestrator/railway.toml`. |
| Secrets/env vars | `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_WEBHOOK_SECRET` (Railway only) | Add to Railway env. NEVER on Vercel. |
| Build artifacts | None — no pre-built artifacts carry phase-specific strings. | None. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node `crypto` (built-in) | webhook verify, advisory lock hashing | ✓ | built-in | — |
| `undici` | api-client, oauth | needs install | `^8.2.0` [VERIFIED npm] | — |
| `p-retry` | api-client retry | ✓ | `^7.0.0` [VERIFIED orchestrator/package.json] | — |
| `ML_CLIENT_ID` | OAuth bootstrap + refresh | depends on cliente provisioning | — | **Degraded:** all ML syncs no-op, healthCheck returns `ok:false`, webhook returns 503. |
| `ML_CLIENT_SECRET` | Same | depends on cliente | — | Same. |
| `ML_REDIRECT_URI` | OAuth bootstrap (must match registered URI exactly) | depends | — | Same — degraded. |
| `ML_WEBHOOK_SECRET` | Webhook signature verify | depends | — | **Degraded:** webhook returns 503; pull cron remains functional iff token already cached. |
| Railway custom domain on orchestrator | Stable HTTPS redirect URI | Likely available (F1 deploy already uses Railway) — verify at plan-time | — | If not configured, use Railway's default `*.up.railway.app` URL (still HTTPS, still stable per service). |

**Degraded mode design (mirrors F2 WP pattern):** `config.ts` reads env, returns `{ ok: false, missing: [...] }` if any of the four ML env vars is unset. Connector factory returns a no-op connector whose `healthCheck` returns `{ ok: false, last_error: "not configured", missing: [...] }`. All three crons exit 0 (NOT 1 — silences Railway alarms during pre-OAuth period) after writing `connector_runs.status="failed", errors_json={reason:"not_configured"}`. Webhook handler returns 503 immediately on missing `ML_WEBHOOK_SECRET`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | OAuth 2.0 authorization_code grant; redirect URI exact-match; state parameter for CSRF on authorize call. |
| V3 Session Management | partial | Tokens stored server-side only; no browser session. CSRF on OAuth via random `state` query param verified on callback. |
| V4 Access Control | yes | RLS on `oauth_tokens` — service-role only, NO authenticated policy. Dashboard never reads tokens. 4-role matrix unchanged. |
| V5 Input Validation | yes | Zod on every ML API response (`MLOrderSchema`, `MLItemSchema`, `MLTokenResponseSchema`). Reject + DLQ on parse failure. |
| V6 Cryptography | yes | `crypto.createHmac('sha256')` for webhook verify. `crypto.timingSafeEqual` for comparison. NEVER hand-roll. |
| V8 Data Protection | yes | `oauth_tokens.access_token` + `refresh_token` are sensitive — never log, never serialize to telemetry. Consider Supabase column-level encryption later (defer). |
| V9 Communication | yes | HTTPS-only for `api.mercadolibre.com` (undici default). Reject http:// redirect URIs at config time. |
| V13 API + Web Service | yes | Webhook 401 on invalid signature (no body read before verify); 503 on degraded mode (not 500 — distinguishes config from bug). |
| V14 Configuration | yes | All ML env vars are orchestrator-only. CC-11 eslint rule extended to catch `NEXT_PUBLIC_ML_*`. |

### Known Threat Patterns for ML connector

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged webhook (attacker hits public URL) | Spoofing | HMAC signature verify (Pattern 2 above) BEFORE reading body. |
| Stolen access token | Information disclosure | Short TTL (6h); cron-driven refresh; revoke + re-auth procedure documented in DEPLOY.md. |
| Refresh-token replay (attacker captures old refresh token) | Spoofing/Replay | ML's single-use rotation already mitigates — but advisory lock prevents racing legitimate refreshes from invalidating each other (Pitfall 1). |
| Mass-fetch DoS via offset injection | DoS | All paginate calls use `from_id` (not user-controlled offsets). |
| Cross-app secret leakage | Information disclosure | `ML_CLIENT_SECRET` is Railway-only; CC-11 grep gate prevents Vercel leak. |
| Token brick via dropped UPSERT mid-refresh | Tampering | UPSERT replaces both tokens in one statement (atomic). Postgres transaction guarantees. |
| `state` param CSRF on OAuth callback | CSRF | Generate random `state` on authorize, store in short-TTL Supabase row (or signed cookie), verify on callback. |
| Service-role key leak in error logs | Information disclosure | Existing F1 logger already redacts known secret env vars; ensure `oauth_tokens` rows never serialize to logs. |
| App-secret rotation | All | Procedure: rotate in ML console → update Railway env → next refresh issues tokens with new secret (old tokens keep working until they expire). Documented in DEPLOY.md. |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `offset` pagination on `/orders/search` | `from_id` with `paging.last_id` | ML restricted `offset` to 10k cap; documented best practice | All F2.1 paginators use `from_id`. |
| Polling for new orders only | Polling + webhook hybrid + 5-min overlap window | Standard ML pattern post-2020 | Webhook for latency, cron for completeness. |
| Storing only one refresh token | Single-use rotation with atomic UPSERT | ML 2021+ rotates on every refresh | Code MUST replace both tokens atomically. |
| `mercadolibre-nodejs-sdk` v3 | Hand-rolled undici client | SDK abandoned ~2020 | Direct REST + zod parse. |

**Deprecated/outdated:**
- `mercadolibre-nodejs-sdk@3.0.1` — last published 5+ years ago [VERIFIED npm], no TypeScript, no rotating-refresh support.
- Trusting webhook body for state — always re-fetch.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Canonical signed-query-params ordering is `topic;user_id;application_id;attempts;sent;received` | Pattern 2, Code Examples | If ML uses a different canonical form, every webhook fails verify. **Verify against the live ML dev console at implementation time.** |
| A2 | Catalog Products mode is not yet widely adopted in MCO 2026 | Pitfall 9, Out of Scope | If significant % of cliente listings are catalog-mode, variant mapper drops them to DLQ — silent gap. Add a metrics counter on `catalog_product_id != null` in W4 and revisit. |
| A3 | Rate limit is 1500 req/min per seller (search) OR 50 req/sec per app (other source) | Standard Stack, Pitfall 8 | Both bounds are reported across sources. Treat the lower (50/sec ≈ 3000/min) as the budget; `p-retry` handles 429 with exponential backoff regardless. |
| A4 | Refresh token TTL is 6 months | Pattern 1 | If shorter (e.g. 30d), the 5h refresh cron is sufficient as long as it runs; only matters if a seller's integration is dormant for >TTL. |
| A5 | `cancellation_detail` field name (vs `cancel_detail`) | State Mapping, Pitfall 6 | Field name divergence is a small fix at implementation; doesn't affect data flow. Both names appear in search results. |
| A6 | Railway supports one `[services.cron]` per service (= 3 service blocks for 3 crons) | Architecture, railway.toml | If Railway supports multiple cron schedules per service, simpler config; if it doesn't, 3 services is correct. F1 railway.toml shows single-schedule pattern. |

## Open Decisions (planner must commit)

1. **Catalog Products vs Items mode** → **Recommend: items-mode v1.** If A2 (low adoption) holds, defer catalog-mode to a follow-up phase. Add a `catalog_product_id != null` counter to W4 smoke metrics so we know if/when to revisit.
2. **Single ML user vs multi-account** → **Recommend: single user v1.** `oauth_tokens.unique (canal, user_id)` is multi-ready; v1 only writes one row. Connector reads "the one row" via `select * from oauth_tokens where canal='mercadolibre' limit 1`. Multi-account becomes a small refactor.
3. **OAuth bootstrap UX** → **Recommend: dashboard-side route at `/operacion/conectar-mercadolibre`.** Dashboard renders a "Connect Mercado Libre" button that opens ML's authorize URL in the same tab; ML redirects to the ORCHESTRATOR callback (which holds the secret); orchestrator 302s back to `/operacion/conectar-mercadolibre/ok` after token UPSERT. Operator never leaves dashboard.
4. **Shared webhook-verify abstraction** → **Recommend: defer to F3** if F2 Wave 2's `wordpress/webhook-verify.ts` has already landed (F2 commit `04697cb` says Wave 2 pending — check at plan-time). If not landed, introduce `packages/connectors/src/webhook-verify.ts` exposing `verifyHmac(secret, sigHex, canonical)` in F2.1 Wave 0 and refactor both WP + ML to use it.
5. **Pagination strategy** → **Recommend: `from_id` for orders, `search_type=scan` for items, both from day 1.** No date-partition fallback; `from_id` covers >10k case without complexity.

## Effort Estimate (median per Wave)

| Wave | Description | Effort |
|------|-------------|--------|
| W0 | Install undici; eslint regex extension for `NEXT_PUBLIC_ML_*`; (optional) shared `webhook-verify.ts` abstraction | 4-6h |
| W1 | Migration `20260615000001_oauth_tokens.sql` + RLS + types regen; state-mapper.ts + types.ts + tests | 8-10h |
| W2 | OAuth lifecycle (oauth.ts), api-client.ts, connector index.ts rewrite, variant-mapper.ts, healthCheck. Most novel logic. | 18-24h |
| W3 | Orchestrator routes (webhook, oauth callback) + 3 crons + railway.toml updates + degraded-mode wiring | 14-18h |
| W4 | Unit tests (state-mapper, oauth, webhook-verify, variant-mapper) + smoke run against ML sandbox + connect-flow E2E | 12-16h |
| W5 | DEPLOY.md updates (env vars, secret rotation, app-registration runbook), F2.1 deploy note | 4-6h |
| **Total** | | **60-80h** [matches CONTEXT.md estimate] |

**No Wave 4 Dashboard UI** (F2 already shipped `/hoy` + `/matching` which are channel-agnostic). The only dashboard touchpoint is the single `/operacion/conectar-mercadolibre` page, costed inside W3.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (F2 default — `[VERIFIED: packages/connectors/package.json devDependencies]`) |
| Config file | `packages/connectors/vitest.config.ts` (existing); orchestrator's `__tests__` directory is NEW |
| Quick run command | `pnpm --filter @faka/connectors test -- --run mercadolibre` |
| Full suite command | `pnpm -r test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ML-OAUTH-01 | code-exchange + refresh rotates BOTH tokens | unit (MSW) | `pnpm --filter @faka/connectors test -- mercadolibre-oauth` | ❌ Wave 1 |
| ML-OAUTH-02 | `oauth_tokens` RLS denies authenticated SELECT | integration | `pnpm --filter @faka/db test -- oauth-rls` | ❌ Wave 1 |
| ML-WEBHOOK-01 | valid sig 200; tampered 401; missing param 401; duplicate sent dedup | unit | `pnpm --filter @faka/orchestrator test -- mercadolibre-webhook` | ❌ Wave 3 |
| ML-ORDERS-01 | from_id pagination; status mapping; cascade trigger | unit | `pnpm --filter @faka/connectors test -- mercadolibre-orders` | ❌ Wave 2 |
| ML-ITEMS-01 | scroll_id pagination; variations → product_variants | unit | `pnpm --filter @faka/connectors test -- mercadolibre-items` | ❌ Wave 2 |
| ML-STATE-01 | each ML status → correct internal estado; unknown → `pendiente` | unit | `pnpm --filter @faka/connectors test -- state-mapper` | ❌ Wave 1 |
| ML-DEGRADED-01 | missing env → healthCheck `ok:false`; webhook 503; cron exits 0 | unit + smoke | `pnpm --filter @faka/connectors test -- mercadolibre-degraded` | ❌ Wave 3 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @faka/connectors test -- --run mercadolibre`
- **Per wave merge:** `pnpm -r test && pnpm -r lint && pnpm -r typecheck`
- **Phase gate:** Full suite green; smoke run against ML sandbox account passes connect-flow + 1 webhook + 1 cron pull.

### Wave 0 Gaps
- [ ] `apps/orchestrator/__tests__/` directory + vitest config (orchestrator currently has no test dir per PATTERNS.md §14)
- [ ] `packages/connectors/__tests__/__fixtures__/ml-order-paid.json`, `ml-order-cancelled-seller.json`, `ml-item-with-variations.json`, `ml-token-response.json` — minimal real-shape fixtures redacted of PII
- [ ] MSW handlers for `api.mercadolibre.com/oauth/token`, `/orders/search`, `/items?ids=...`

## Project Constraints (from CLAUDE.md)

> If CLAUDE.md was not present in the repo at research time, this section may be empty. Research assumed the CONTEXT.md anti-goals + F2 PATTERNS.md cross-cutting invariants serve as the authoritative constraint set for F2.1 in absence of a top-level CLAUDE.md.

- CC-11: No `NEXT_PUBLIC_ML_*` / `NEXT_PUBLIC_WORDPRESS_*` env vars. Orchestrator-only credentials. Grep gate in `packages/config/eslint.base.cjs` (extend regex).
- CC-12: Every new view declares `with (security_invoker = true)`. F2.1 adds NO views.
- CC-13: `raw_orders` / `raw_events` payloads immutable (append-only).
- CC-14: `messaging_log` stays empty in F2.1 (ML messages topic logged + dropped).
- F2-CASCADE-REUSE: F2.1 does not re-implement cascade; calls `runMatchCascade` from `@faka/connectors/matching` (F2 Wave 2 output).
- F2-LLM-ADAPTER: F2.1 does not import `@ai-sdk/*` directly.
- W1 invariant: `applyColumnMap` is CSV-only; `mercadolibre/*.ts` must not import it.
- W2 invariant: `kind:"channel", canal:"mercadolibre"` for all ML crons (never `cron-heartbeat`).

## Sources

### Primary (HIGH confidence)
- F1 codebase (verified file reads): `packages/connectors/src/retry.ts`, `apps/orchestrator/railway.toml`, `apps/orchestrator/package.json`, `packages/connectors/package.json`
- F2 PATTERNS.md + RESEARCH.md (same project)
- npm registry (verified versions): undici 8.2.0, p-retry 8.0.0, mercadolibre-nodejs-sdk 3.0.1, mercadolibre-node 1.0.6

### Secondary (MEDIUM confidence)
- [Mercado Libre — Authentication and Authorization](https://developers.mercadolibre.com.ar/en_us/authentication-and-authorization) — 6h access TTL, refresh rotation, code-exchange shape
- [Mercado Libre — Items & Searches](https://developers.mercadolibre.com.ar/en_us/items-and-searches) — `search_type=scan`, `scroll_id`, variations, `include_attributes=all`
- [Mercado Libre — Paging Results](https://global-selling.mercadolibre.com/devsite/paging-results-global-selling) — offset 10k cap, `from_id` strategy
- [Mercado Libre — Manage Sales](https://global-selling.mercadolibre.com/devsite/manage-sales-global-selling) — order statuses, cancellation reasons, `cancel_detail`
- [Mercado Libre — Variations](https://developers.mercadolibre.com.ar/en_us/variations) — `attribute_combinations`, mandatory fields
- [Rollout — Mercado Libre API essentials](https://rollout.com/integration-guides/mercado-libre/api-essentials) — rate limit context

### Tertiary (LOW confidence — flagged in Assumptions Log)
- [Hookray — Webhook signature verification 2026](https://hookray.com/blog/webhook-signature-verification-2026) — generic HMAC pattern
- [Rollout — Mercado Libre webhooks quick guide](https://rollout.com/integration-guides/mercado-libre/quick-guide-to-implementing-webhooks-in-mercado-libre) — webhook pattern context (third-party)
- Catalog Products MCO adoption — no first-party 2026 source found → A2 in Assumptions Log

## Metadata

**Confidence breakdown:**
- OAuth shape (endpoints, TTLs, rotation): HIGH (multiple sources agree + F2 pattern reuse)
- Pagination (`from_id`, `scroll_id`): HIGH (CITED ML paging docs)
- Webhook signature canonical-string: MEDIUM ([ASSUMED A1] — canonical ordering verified against CONTEXT.md spec, not first-party ML doc; verify at impl time)
- Order status enum mapping: HIGH (CITED ML manage-sales docs)
- Rate limits: MEDIUM ([ASSUMED A3] — sources disagree on units; use lower bound as budget)
- Catalog Products MCO adoption: LOW ([ASSUMED A2] — defer with metric counter)
- Standard stack (undici, p-retry, zod): HIGH (verified npm + F1 lockfile)

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days — ML API surface stable; re-verify versions and canonical signature ordering at plan execution)
