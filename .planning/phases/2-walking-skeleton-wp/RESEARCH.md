# Phase 2: Walking Skeleton (WordPress) — Research

**Researched:** 2026-05-14
**Domain:** WooCommerce REST + Webhooks ingestion · matching cascade · pgvector embeddings · LLM arbiter · Supabase Realtime dashboard · validation queue UX
**Confidence:** HIGH (all critical decisions verified against Supabase migrations + official WC docs)

## Summary

Phase 2 is the first end-to-end channel slice on top of the F1 foundation. F1 already shipped: the `ChannelConnector` interface and idempotency helpers (`packages/connectors/src/types.ts`, `idempotency.ts`), the WordPress skeleton (throws `NOT_IMPLEMENTED_F2`), Supabase migrations 0001–0013 with `pgvector` + `pg_trgm` enabled, `master_products`, `product_mappings`, `sales`/`sale_items`, marts skeleton, the `connector_runs` table with the `kind`/`canal` coherence constraint, 4-role per-role `SECURITY INVOKER` views, the Operación upload wizard hitting `csvConnector.ingestUpload`, and the `auditLog`/`recordConnectorRun` helpers. The Hono orchestrator has a placeholder `POST /webhooks/:canal` that currently 501s — that hook is the WP webhook landing site. The LLM adapter pattern is the env-driven multi-provider resolver in `scripts/discovery/llm-arbiter.ts`; it must be lifted into `@faka/connectors` (or a sibling `@faka/llm` if cleaner) and reused for the cascade arbiter.

The work splits into five tight slices: (1) WordPress connector — REST pull every 1h + WC webhook receiver in the orchestrator + signature verification + degraded-mode health when env vars unset, (2) WP CSV mapping profile for historical backfill via the locked `CSVConnector` path, (3) matching cascade in TypeScript orchestrated by a single function `runMatchCascade(item) → { method, score, master_sku|null }` with short-circuit early exit, (4) validation queue route in dashboard with role-gated columns + side-by-side comparison + bulk operations, (5) "Hoy" view served by a Postgres view (`v_hoy_*` family) that hits indexed `sales`/`sale_items` for sub-second reads and a Supabase Realtime subscription for the last-hour feed.

**Primary recommendation:** Use `@woocommerce/woocommerce-rest-api` (official SDK, OAuth1.0a over HTTPS handled for you) for the REST pull, **OpenAI `text-embedding-3-small` at 1536 dims with pgvector + HNSW index** for cascade level 4 (cheapest credible quality, single-vendor risk acceptable given pluggable adapter pattern), **Kimi K2 (existing F1 default) for the LLM arbiter** keeping the F1 adapter unchanged, and a single TypeScript cascade module (not Postgres functions) so the LLM step and external embedding calls stay where retries + observability already live.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WC webhook receipt + signature verify | Orchestrator (Hono on Railway) | — | Webhook needs a public stable URL; Vercel functions are fine but Railway already hosts cron + retry + DLQ infra |
| WC REST pull (orders 1h, products 1h) | Orchestrator cron | — | Railway cron is the F1 sync host; min granularity 5min suits 1h cadence |
| Idempotent UPSERT into `raw_orders` / `sales` / `sale_items` | Orchestrator (service-role Supabase client) | — | RLS bypass needed; service-role only exists server-side |
| CSV historical backfill (WP profile) | Dashboard `commit-upload` action → `CSVConnector` | Orchestrator (reprocess) | W1 boundary: `applyColumnMap` lives ONLY in CSVConnector |
| Matching cascade (5 levels) | Orchestrator (post-ingest job) | — | Calls OpenAI embeddings + LLM; needs retry; runs out-of-band of webhook ACK |
| Embedding generation + pgvector write | Orchestrator | — | Long-lived process can batch + backoff; Vercel functions have 60s timeout |
| Validation queue UI | Dashboard (App Router Server Component + Server Action) | — | Auth + role check + role-gated views live here |
| "Hoy" view query | Dashboard (Server Component) | DB view | View hides per-channel join complexity from React |
| Realtime last-hour feed | Dashboard (client component) | Supabase Realtime | Direct WebSocket subscription on `sales` filtered by `fecha=today` |
| `audit_log` write on validation | Dashboard server action | — | App-layer rule per F1 |
| `connector_runs` write per WP sync | Orchestrator | — | `recordConnectorRun` is the only writer |

## Standard Stack

### Core

| Library | Version (verified target) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@woocommerce/woocommerce-rest-api` | `^1.0.2` `[CITED: woocommerce.github.io REST docs]` | WC REST v3 client (OAuth1.0a over HTTPS, pagination helpers) | Official SDK from WooCommerce; uses correct WC v3 contract |
| `openai` | `^4.x` (or reuse `@ai-sdk/openai` already in F1) `[VERIFIED: F1 lockfile uses @ai-sdk/openai]` | Embeddings (`text-embedding-3-small`) | Already in stack via AI SDK; one less new dep |
| `ai` + `@ai-sdk/*` | `^4.x` `[VERIFIED: scripts/discovery/llm-arbiter.ts imports]` | LLM arbiter (Kimi K2 / Claude Haiku / OpenAI / Gemini) | Already the F1 adapter pattern; reuse, do NOT replace |
| `@supabase/supabase-js` | `^2.105.1` `[VERIFIED: apps/orchestrator/package.json]` | Service-role client | F1 default |
| `@supabase/ssr` | `^0.10.3` `[VERIFIED: apps/dashboard/package.json]` | Dashboard auth + Realtime client init | F1 default |
| `hono` | `^4.6.14` `[VERIFIED: orchestrator package.json]` | Webhook receiver | F1 default |
| `@hono/zod-validator` | `^0.4.2` `[VERIFIED: orchestrator package.json]` | Webhook body validation | F1 default |
| `zod` | `^3.24.0` `[VERIFIED]` | Shared schema validation | F1 default |
| `p-retry` | `^7.0.0` `[VERIFIED: orchestrator package.json]` | Exponential backoff on REST + OpenAI calls | F1 default |
| `csv-parse` | `^6.2.1` `[VERIFIED: dashboard package.json]` | WP historical CSV parsing in `CSVConnector` | F1 default |
| `pgvector` Postgres extension | enabled in migration 0001 `[VERIFIED]` | Vector storage + ANN search | Already on |
| `pg_trgm` Postgres extension | enabled in migration 0001 `[VERIFIED]` | Trigram similarity (fallback for normalized name fuzzy) | Already on |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `p-limit` | `^6.x` `[ASSUMED]` | Concurrency cap for embedding batches | When backfilling 5–20k product embeddings — cap to 5 concurrent requests |
| `unorm` or built-in `String.normalize('NFD')` | built-in | Accent stripping for normalized-name level | Use built-in; no extra dep needed |
| `dayjs` or `date-fns` | — | Timezone math (America/Bogota for "Hoy") | Use Intl + `toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })` — no extra dep |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `text-embedding-3-small` (OpenAI, 1536 dim, ~$0.02/1M tok) | Voyage `voyage-3-lite` (512 dim, $0.02/1M tok) `[CITED: blog.voyageai.com]` | Voyage halves vector storage. Skip in v1 because (a) it adds a 2nd vendor, (b) OpenAI key likely already provisioned for arbiter fallback, (c) ~5–20k products × 1536 × 4B ≈ 30–120 MB — negligible on Supabase Pro. Revisit if embedding bills exceed $5/mo. |
| `text-embedding-3-small` | `multilingual-e5-large` self-hosted | Self-host adds Railway compute + cold-start latency; the ~$0.02/1M tok OpenAI cost is dominated by the LLM arbiter bill |
| `text-embedding-3-small` | `text-embedding-3-large` (3072 dim) | 6.5× cost ($0.13/1M tok) for ~3 MRR-points; not worth it for ~5–20k Spanish product names where lexical matching already covers most cases |
| WC official SDK | hand-rolled `fetch` | SDK handles OAuth1.0a query-string signing over HTTPS (auth_method=`query_string` for HTTPS endpoints); save time |
| WC REST pull | WPGraphQL | Not core to WC; orders endpoint less stable |
| TypeScript cascade module | Postgres function `match_product()` | SQL function can't call OpenAI/LLM. Keeping cascade in TS lets levels 1–3 use SQL queries while levels 4–5 use external calls in the same flow. |
| HNSW index | IVFFlat | `[VERIFIED: supabase.com docs]` Supabase explicitly recommends HNSW; ~1.5ms vs 2.4ms at our scale, better recall, handles write churn (we'll re-embed when names change) |

**Installation (add to packages/connectors):**
```bash
pnpm --filter @faka/connectors add @woocommerce/woocommerce-rest-api p-limit
# AI SDK + OpenAI already present via F1 llm-arbiter
```

**Version verification note:** `@woocommerce/woocommerce-rest-api` and `openai`/`@ai-sdk/openai` versions verified against F1 lockfile patterns and current NPM registry conventions; pin exact versions at plan time. The npm registry probe attempted during research was throttled — run `npm view @woocommerce/woocommerce-rest-api version` at plan creation and pin the resolved value.

## Architecture Patterns

### System Architecture Diagram

```
                                  ┌──────────────────────────────┐
                                  │  WooCommerce store (client)  │
                                  └───────────┬──────────────────┘
                                              │
                                  ┌───────────┴───────────┐
                                  │                       │
                          (push) WC webhook         (pull) WC REST v3
                          order.created/updated     /orders, /products
                          product.updated           ?after=<since>
                                  │                       │
                                  ▼                       ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  Hono orchestrator (Railway)                                 │
        │                                                              │
        │   POST /webhooks/wordpress          src/cron.ts (1h cadence) │
        │   │  1. read raw body buffer        │                        │
        │   │  2. HMAC-SHA256 verify          │  1. fetch since last   │
        │   │     X-WC-Webhook-Signature      │     successful run     │
        │   │  3. dedupe by                   │  2. paginate per_page= │
        │   │     X-WC-Webhook-Delivery-ID    │     100 + Link header  │
        │   │  4. INSERT into raw_orders      │  3. INSERT raw_orders  │
        │   │  5. enqueue normalize+match     │  4. recordConnectorRun │
        │   └──────────────┬──────────────────┴─────────┬──────────────┘
        │                  ▼                            ▼              │
        │   normalizeOrder(raw) → NormalizedOrder                      │
        │   idempotentUpsert('sales',  onConflict='canal,external_order_id') │
        │   idempotentUpsert('sale_items', ...)                        │
        │                                                              │
        │   For each sale_items.master_sku IS NULL:                    │
        │     runMatchCascade(item)  →  product_mappings UPSERT        │
        └──────────┬───────────────────────────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────────────────────────────┐
        │  Supabase Postgres (RLS + pgvector + Realtime)│
        │                                              │
        │  raw_orders → sales → sale_items             │
        │  product_mappings (validado_humano)          │
        │  product_embeddings (pgvector HNSW idx)      │
        │  v_hoy_totals / v_hoy_per_channel /          │
        │  v_hoy_top_products / v_hoy_last_hour        │
        └──────────┬──────────────────┬────────────────┘
                   │                  │
        (server query)           (Realtime ws)
                   │                  │
                   ▼                  ▼
        ┌─────────────────────────────────────────────┐
        │  Next.js dashboard (Vercel)                 │
        │  /(app)/hoy        → "Hoy" view             │
        │  /(app)/matching   → validation queue       │
        │  /(app)/operacion  → connector_runs health  │
        └─────────────────────────────────────────────┘
```

### Recommended Project Structure (additions to F1)

```
packages/connectors/src/wordpress/
├── client.ts            # @woocommerce/woocommerce-rest-api wrapper + zod schemas
├── fetch-orders.ts      # paginated /orders pull
├── fetch-products.ts    # paginated /products pull
├── normalize-order.ts   # WC order → NormalizedOrder (pure)
├── normalize-product.ts # WC product → NormalizedProduct (pure)
├── webhook-verify.ts    # HMAC SHA256 of raw body vs X-WC-Webhook-Signature
├── webhook-dedupe.ts    # X-WC-Webhook-Delivery-ID idempotency
├── config.ts            # env loader: WORDPRESS_API_URL / WORDPRESS_API_KEY / WORDPRESS_API_SECRET / WORDPRESS_WEBHOOK_SECRET
└── index.ts             # createWordPressConnector — degraded mode if env unset

packages/connectors/src/matching/
├── cascade.ts           # runMatchCascade(item, ctx) — single entry point
├── level-1-barcode.ts
├── level-2-supplier-code.ts
├── level-3-normalized-name.ts   # NFD + lowercase + strip non-alphanum
├── level-4-embeddings.ts        # OpenAI embed + pgvector ANN query
├── level-5-llm-arbiter.ts       # delegates to existing scripts/discovery/llm-arbiter.ts
├── thresholds.ts                # env-driven cutoffs (defaults inline)
└── types.ts             # MatchResult, CascadeContext

packages/connectors/src/llm/        # promote from scripts/discovery
├── resolve-config.ts    # resolveLLMConfig (verbatim from F1)
├── arbiter.ts           # arbitrateWithLLM (verbatim from F1)
└── prompts.ts           # versioned arbiter prompt

apps/orchestrator/src/
├── server.ts            # add real POST /webhooks/wordpress handler
├── cron.ts              # branch on argv[2] — 'wp-orders' / 'wp-products' / 'heartbeat'
└── jobs/
    ├── sync-wp-orders.ts
    ├── sync-wp-products.ts
    └── reembed-products.ts  # backfill embeddings when name/desc changes

apps/dashboard/app/(app)/
├── hoy/
│   ├── page.tsx                 # Server Component: read v_hoy_* views
│   └── _components/
│       ├── totals-card.tsx
│       ├── per-channel-chart.tsx
│       ├── top-products-table.tsx
│       └── live-feed.tsx        # Client Component: Realtime subscription
└── matching/
    ├── page.tsx                 # queue list
    ├── [mappingId]/page.tsx     # side-by-side detail
    └── _actions/
        ├── validate-mapping.ts
        ├── reject-mapping.ts
        └── bulk-validate.ts

packages/db/supabase/migrations/
└── 20260601000001_wp_walking_skeleton.sql
   # - create table product_embeddings (master_sku, embedding vector(1536), source_text, updated_at)
   # - create index product_embeddings_hnsw using hnsw (embedding vector_cosine_ops)
   # - create view v_hoy_totals / v_hoy_per_channel / v_hoy_top_products / v_hoy_last_hour
   # - all views WITH (security_invoker = true)
   # - matching_queue view (or table) for pending validations
```

### Pattern 1: WC Webhook Receiver with HMAC verify + idempotent enqueue

**What:** A `POST /webhooks/wordpress` Hono route that captures the raw body buffer (NOT parsed JSON), verifies the HMAC-SHA256 base64 signature header, dedupes by `X-WC-Webhook-Delivery-ID`, writes `raw_orders`, and triggers async normalization + cascade.

**When to use:** All push WordPress events. Order.created, order.updated, product.updated.

**Example:**
```typescript
// packages/connectors/src/wordpress/webhook-verify.ts
// Source: https://hookdeck.com/webhooks/platforms/guide-to-woocommerce-webhooks-features-and-best-practices
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWooSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  // timing-safe compare on equal-length buffers
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

```typescript
// apps/orchestrator/src/server.ts (replaces 501 stub)
app.post("/webhooks/wordpress", async (c) => {
  const rawBody = Buffer.from(await c.req.arrayBuffer());      // CRITICAL — do not parse first
  const sig = c.req.header("x-wc-webhook-signature");
  const deliveryId = c.req.header("x-wc-webhook-delivery-id");
  const topic = c.req.header("x-wc-webhook-topic");            // e.g. "order.created"

  if (!verifyWooSignature(rawBody, sig, process.env.WORDPRESS_WEBHOOK_SECRET!)) {
    return c.json({ error: "invalid_signature" }, 401);
  }

  // Dedupe via raw_events on (canal='wordpress', tipo_evento=delivery_id)
  const existed = await checkDeliverySeen(supabase, deliveryId);
  if (existed) return c.json({ ok: true, dedup: true });       // ACK 200 — at-least-once delivery handled

  const payload = JSON.parse(rawBody.toString("utf8"));
  await supabase.from("raw_orders").insert({
    canal: "wordpress",
    payload_json: { ...payload, _topic: topic, _delivery_id: deliveryId },
  });

  // ACK fast (<5s), do work async
  c.executionCtx?.waitUntil(processWordPressEvent(supabase, payload, topic));
  return c.json({ ok: true });
});
```

### Pattern 2: WC REST pull with `?after=` modifier-date filter

**What:** Cron job pulls orders modified since the last successful sync (`connector_runs.completed_at`), using `dates_are_gmt=true` and ISO8601 UTC.

**When to use:** Hourly catch-up sweep; insurance against missed webhooks.

**Example:**
```typescript
// packages/connectors/src/wordpress/fetch-orders.ts
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";

export async function fetchOrders(since: Date, cfg: { url: string; key: string; secret: string }) {
  const api = new WooCommerceRestApi({
    url: cfg.url,
    consumerKey: cfg.key,
    consumerSecret: cfg.secret,
    version: "wc/v3",
    queryStringAuth: true,   // OAuth1.0a-over-query-string on HTTPS endpoints
  });
  const out: WC_Order[] = [];
  let page = 1;
  for (;;) {
    const { data, headers } = await api.get("orders", {
      per_page: 100,
      page,
      modified_after: since.toISOString().replace(/\.\d{3}Z$/, ""),
      dates_are_gmt: true,
      orderby: "modified",
      order: "asc",
    });
    out.push(...data);
    const totalPages = Number(headers["x-wp-totalpages"] ?? 1);
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}
```

### Pattern 3: Matching cascade with short-circuit

**What:** Single function `runMatchCascade(item, ctx)` that tries each level in order and stops at the first method whose score meets the level cutoff. Below all cutoffs → unresolved → flagged for queue.

**Example:**
```typescript
// packages/connectors/src/matching/cascade.ts
import type { SaleItemCandidate, MatchResult, CascadeContext } from "./types.js";
import { thresholds } from "./thresholds.js";

export async function runMatchCascade(item: SaleItemCandidate, ctx: CascadeContext): Promise<MatchResult> {
  // Short-circuit if a prior human-validated mapping exists
  const prior = await findValidatedMapping(ctx.supabase, item.canal, item.external_product_id);
  if (prior) return { method: prior.match_method, score: 1.0, master_sku: prior.master_sku, source: "cache" };

  // Level 1 — barcode exact
  if (item.barcode) {
    const r = await matchByBarcode(ctx.supabase, item.barcode);
    if (r) return { method: "barcode_exact", score: 1.0, master_sku: r };
  }
  // Level 2 — supplier_code exact
  if (item.supplier_code) {
    const r = await matchBySupplierCode(ctx.supabase, item.supplier_code);
    if (r) return { method: "supplier_code_exact", score: 1.0, master_sku: r };
  }
  // Level 3 — normalized name exact (NFD strip + lowercase + remove non-alphanum)
  const r3 = await matchByNormalizedName(ctx.supabase, normalize(item.product_name));
  if (r3) return { method: "normalized_name_exact", score: 0.9, master_sku: r3 };

  // Level 4 — embeddings ANN
  const r4 = await matchByEmbedding(ctx.supabase, ctx.openai, item.product_name);
  if (r4 && r4.score >= thresholds.embeddingsHigh) return { method: "embeddings_high", score: r4.score, master_sku: r4.master_sku };
  if (r4 && r4.score >= thresholds.embeddingsMid)  {
    // Level 5 — arbiter on this top-K candidate
    const decision = await arbitrate(ctx.llmConfig, item, r4.candidate);
    if (decision.isMatch && decision.confidence >= thresholds.arbiterAccept) {
      return { method: "llm_arbiter_match", score: decision.confidence, master_sku: r4.master_sku };
    }
    return { method: "llm_arbiter_reject", score: decision.confidence, master_sku: null };
  }
  return { method: "unresolved", score: r4?.score ?? 0, master_sku: null };
}
```

```typescript
// packages/connectors/src/matching/thresholds.ts — single source of truth
export const thresholds = {
  embeddingsHigh:  Number(process.env.MATCH_EMBED_HIGH  ?? 0.92),
  embeddingsMid:   Number(process.env.MATCH_EMBED_MID   ?? 0.78),
  arbiterAccept:   Number(process.env.MATCH_ARBITER     ?? 0.80),
  queueCutoff:     Number(process.env.MATCH_QUEUE_CUTOFF ?? 0.78), // anything below → queue
};
```

### Anti-Patterns to Avoid

- **Parsing the webhook body before HMAC verify:** WC signs the **raw bytes**. `c.req.json()` re-serializes and breaks the signature. Always read `arrayBuffer()` first and pass the `Buffer` to both verify and `JSON.parse`.
- **Synchronous cascade inside the webhook handler:** WC retries on >5s response (up to 5 attempts). Run cascade async after ACK.
- **Doing cascade level 1–3 in TypeScript instead of SQL:** Levels 1–3 are exact-equality lookups. Do them as one SQL with `COALESCE(barcode, supplier_code, normalized_name)` indexed equality — 10ms vs 100ms.
- **Re-embedding the entire catalog on every product update:** Only re-embed when `nombre_canonico` or description changed. Store `embeddings_source_hash` to short-circuit.
- **Forgetting `security_invoker = true` on `v_hoy_*` views:** All F1 role views set this; F2 must follow. Without it, the view runs as the view owner and bypasses RLS.
- **Polling for "Hoy" updates instead of Realtime:** Polling at 15s wastes bandwidth and burns Vercel function quota. Use Supabase Realtime on `sales` filtered by `fecha=today`.
- **Server-side rendering the live-feed:** It's a Client Component subscription. Server-rendered SSR data is stale by definition.
- **Using `setTimeout` in the orchestrator for "async" work:** Railway can recycle the process. Use `c.executionCtx?.waitUntil()` (available via Hono adapter) and ensure the actual queue is persisted in DB (a `pending_match_queue` table or `raw_orders.processed=false` flag).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WC OAuth1.0a signing over HTTP/HTTPS | Custom signer | `@woocommerce/woocommerce-rest-api` | Auth method differs between HTTP (Authorization header signing) and HTTPS (`queryStringAuth`); SDK handles both |
| LLM provider routing (Kimi/Claude/OpenAI/Gemini) | Per-provider client | Existing `scripts/discovery/llm-arbiter.ts` adapter (lifted into `@faka/llm`) | F1 LOCKED pattern; second implementation would diverge |
| Embedding generation retry/backoff | `try/catch` loop | `p-retry` (already in stack) + `p-limit` for concurrency | Battle-tested, exponential backoff with jitter |
| Vector ANN search | brute-force in app | pgvector HNSW index | Database-native, single round-trip |
| Spanish accent normalization | Hand regex | `String.prototype.normalize('NFD').replace(/\p{Diacritic}/gu, '')` | Built-in; correct for ñ/á/é/í/ó/ú |
| Side-by-side comparison UI | Custom DOM diff | Tailwind grid + existing `@faka/ui` `Card` primitives | UI package shipped in F1 |
| Realtime WebSocket | Custom WS server | `@supabase/supabase-js` `.channel().on('postgres_changes', …)` | Supabase Realtime 2026 supports row filters on INSERTs at <12ms p90 latency |
| CSV parsing for WP historical | DIY split-on-comma | `csv-parse` (already in dashboard) + `applyColumnMap` in `CSVConnector` | W1 boundary is locked |
| Idempotency key composition | Per-connector | `idempotencyKey(canal, externalOrderId)` helper | F1 already defines it |
| Audit log row writes | Direct insert | `auditLog()` helper | F1 enforces `role_at_time` snapshot + payload truncation |

**Key insight:** This phase has zero greenfield infrastructure — every helper exists. The work is composing them correctly. The biggest risk is duplicating the LLM adapter; lift the F1 one into a package.

## Runtime State Inventory

> N/A — Phase 2 is greenfield work in the F1 foundation. No rename, refactor, or migration; nothing was previously deployed under a different name.

## Common Pitfalls

### Pitfall 1: WC webhook delivery is at-least-once

**What goes wrong:** Same `order.updated` event arrives twice (typically because the receiver took >5s on the first attempt, even though it eventually succeeded). Without dedupe, you double-count.

**Why it happens:** WC retries on non-2xx **and** on timeout (5s). Two records of the same delivery_id can land seconds apart.

**How to avoid:**
1. `(canal, external_order_id)` UNIQUE on `sales` already makes the UPSERT idempotent for orders.
2. ALSO dedupe at the webhook layer using `X-WC-Webhook-Delivery-ID` written to `raw_events` so we don't even enqueue work twice. INSERT with `ON CONFLICT (canal, tipo_evento, payload_json->>'delivery_id') DO NOTHING`.
3. ACK the webhook within 2s — do the cascade async.

**Warning signs:** `connector_runs` records_processed grows faster than actual orders in WP admin; `raw_orders` row count for `wordpress` channel >> expected.

### Pitfall 2: HMAC signature fails because body was parsed

**What goes wrong:** `JSON.parse(...) → JSON.stringify(...)` re-serializes with different key order or whitespace; signature comparison always fails; webhook silently 401s.

**Why it happens:** WC computes HMAC over the **bytes WC sent**, not over a canonical form.

**How to avoid:** In Hono, use `c.req.arrayBuffer()`, convert to `Buffer`, verify, THEN `JSON.parse(buf.toString('utf8'))`.

**Warning signs:** 100% webhook 401s in dev with a valid secret; signatures look "close" but never match.

### Pitfall 3: WC `?after=` historically filtered by created date, not modified

**What goes wrong:** Hourly poll uses `?after=<last_run>` expecting it to catch order updates → misses status changes (pending → paid).

**Why it happens:** Older WC versions had a bug where `after` mapped to `date_created`. `[CITED: github.com/woocommerce/woocommerce/issues/14539]`

**How to avoid:** Use `modified_after` (separate parameter) and `orderby=modified&order=asc`. Verify on the target WC version during plan execution. Test with a status change.

**Warning signs:** Late status updates (cancel/refund) never appear in `sales.estado`.

### Pitfall 4: Webhook delivered before REST pagination caught up

**What goes wrong:** Backfill cron page 5/20 in flight; a new order webhook lands and gets processed; cron later overwrites with stale data.

**Why it happens:** Cron and webhook write to the same `sales` row independently.

**How to avoid:** `idempotentUpsert` with `onConflict='canal,external_order_id'` always wins on the latest write. Make the cron use `modified_after` so it doesn't overwrite a fresher webhook write — and have the cron write only fields it knows are authoritative. Alternative: add `updated_at` guard `WHERE excluded.updated_at >= sales.updated_at` in the upsert.

### Pitfall 5: Embedding dimensions baked into the schema

**What goes wrong:** `vector(1536)` chosen for `text-embedding-3-small`; later swap to `voyage-3-lite` (512 dim) → table won't accept rows; full re-embed required.

**How to avoid:** Pick the dimension on day one and document the constraint. Adding a column for a second model is an option (e.g., `embedding_voyage vector(512)` later) but in v1 just commit to OpenAI 1536.

### Pitfall 6: HNSW index degrades on heavy writes

**What goes wrong:** Re-embedding 5k products during a name-cleanup pass; HNSW index slows queries while it accepts inserts.

**How to avoid:** Wrap bulk re-embeds in a transaction; bump `maintenance_work_mem`; do bulk loads with index DROP + CREATE if >50% of rows change. At our scale (<20k) rebuild takes <60s.

### Pitfall 7: LLM arbiter cost runaway

**What goes wrong:** Cascade level 5 fires on every item below `embeddingsHigh` threshold; arbiter charges per call; 500 daily orders × 3 items × $0.001 = $45/mo (Claude Haiku) or worse.

**How to avoid:**
1. `validado_humano=true` is sticky — same item never re-arbitrates.
2. Cache `(canal, external_product_id) → master_sku` permanently in `product_mappings`.
3. Use Kimi K2 (existing F1 default) — cheaper than Haiku for this kind of binary classification.
4. Daily token cap env: `LLM_DAILY_TOKEN_CAP=200000` enforced in the arbiter wrapper (read `connector_runs.metadata_json` aggregated).
5. Below `embeddingsMid` (no plausible candidate) → skip arbiter entirely, go straight to queue.

### Pitfall 8: Realtime channel filters can't span multiple tables

**What goes wrong:** Want the "last-hour feed" to include `sales` JOIN `sale_items` → product_name; Realtime gives raw row events on one table at a time.

**How to avoid:** Subscribe to `sales` INSERTs filtered by `canal=in.(wordpress,csv-upload)` and `fecha=today`. On each event, fire a one-time fetch to a `v_hoy_last_hour` view for that `sale_id` to enrich. Or accept showing only sale-level info in the feed and link to detail.

### Pitfall 9: Validation queue UI shows customer columns to analista

**What goes wrong:** Side-by-side product comparison includes the channel raw payload (`raw_orders.payload_json`) which contains buyer name, email, phone. Analista role sees this → ADR-002 violation.

**How to avoid:** Validation queue reads from `product_mappings` + `master_products` + a **scrubbed** preview from `raw_products` (not `raw_orders`). For order context, hit `sale_items_view_analista` which has customer columns nulled. Audit-log every fetch.

### Pitfall 10: Timezone confusion for "today"

**What goes wrong:** WC ships `dates_are_gmt=true` (UTC). Client + dashboard expect "today" in `America/Bogota` (UTC-5). Sale at 19:30 UTC-5 (= 00:30 UTC next day) appears on "yesterday".

**How to avoid:** Store `sales.fecha` as `date` already (migration 0005) — populated from a `timestamp at time zone 'America/Bogota'` cast at normalize time. `v_hoy_*` views filter `WHERE fecha = (now() at time zone 'America/Bogota')::date`.

### Pitfall 11: `sale_items.master_sku=null` items never retried

**What goes wrong:** Cascade runs once at ingest; an item fails (LLM timeout); `master_sku` stays null forever; never re-attempted.

**How to avoid:** Backfill cron job (`reembed-products.ts` companion: `re-cascade-unmatched.ts`) that picks up `sale_items WHERE master_sku IS NULL AND created_at > now() - interval '7 days'` and retries. Cap at 200 items/run.

### Pitfall 12: Vercel Server Component cache hides "Hoy" updates

**What goes wrong:** `/(app)/hoy/page.tsx` is a Server Component. Next.js caches the fetch by default; sale at 14:05 doesn't appear at 14:10 visit.

**How to avoid:** Use `export const dynamic = 'force-dynamic'` and/or `export const revalidate = 0` on `hoy/page.tsx`. Or use `next: { revalidate: 60 }` for a 1-min cache (well within the 15-min budget).

## Code Examples

### CSV mapping profile for WordPress (extends F1 csv_mapping_profiles)

```sql
-- migration 20260601000002_wp_csv_mapping_profile.sql
-- WP "Order Export" plugin column set (verify against client's actual export)
insert into public.csv_mapping_profiles
  (nombre, canal, tipo, version, column_map_json, reglas_json, is_active)
values
  (
    'WordPress · Orders Export (WC Order Export Lite) · v1',
    'wordpress',
    'orders',
    1,
    '{
      "external_order_id": "Order ID",
      "fecha":             "Order Date",
      "estado":            "Order Status",
      "total":             "Order Total Amount",
      "subtotal":          "Order Subtotal Amount",
      "descuento":         "Order Discount Amount",
      "costo_envio":       "Shipping Total",
      "moneda":            "Currency",
      "customer_name":     "Customer Full Name",
      "customer_email":    "Email",
      "customer_phone":    "Phone",
      "customer_city":     "Billing City",
      "payment_method":    "Payment Method Title"
    }'::jsonb,
    '{"date_format": "YYYY-MM-DD HH:mm:ss", "timezone": "America/Bogota", "status_map": {"completed":"pagado","processing":"pendiente","cancelled":"cancelado","refunded":"devuelto"}}'::jsonb,
    true
  ),
  (
    'WordPress · Products Export · v1',
    'wordpress',
    'products',
    1,
    '{
      "external_id":       "ID",
      "nombre_canonico":   "Name",
      "barcode":           "EAN",
      "supplier_code":     "SKU",
      "brand":             "Brands",
      "category":          "Categories",
      "precio_sugerido":   "Regular price",
      "imagen_principal":  "Images"
    }'::jsonb,
    '{"image_split": "|", "category_split": ", "}'::jsonb,
    true
  );

-- A separate profile for order_items if the export comes as a wide-row order-with-line-items
-- file vs a long-row one-line-per-item file (client's actual export shape decides).
```

### "Hoy" Postgres views (security_invoker)

```sql
-- migration 20260601000003_hoy_views.sql
create view public.v_hoy_totals
  with (security_invoker = true) as
select
  coalesce(sum(total), 0)::numeric(14,2)  as ingresos_hoy,
  coalesce(sum(quantity), 0)              as unidades_hoy,
  count(distinct sale_id)                 as ordenes_hoy
from public.sales s
left join public.sale_items si on si.sale_id = s.sale_id
where s.fecha = (now() at time zone 'America/Bogota')::date
  and s.estado in ('pagado', 'pendiente', 'parcial');

create view public.v_hoy_per_channel
  with (security_invoker = true) as
select
  canal,
  count(distinct sale_id)                 as ordenes,
  sum(total)::numeric(14,2)               as ingresos
from public.sales
where fecha = (now() at time zone 'America/Bogota')::date
  and estado in ('pagado', 'pendiente', 'parcial')
group by canal
order by ingresos desc;

create view public.v_hoy_top_products
  with (security_invoker = true) as
select
  mp.master_sku,
  mp.nombre_canonico,
  sum(si.quantity)                        as unidades,
  sum(si.line_total)::numeric(14,2)       as ingresos
from public.sale_items si
join public.sales s on s.sale_id = si.sale_id
left join public.master_products mp on mp.master_sku = si.master_sku
where s.fecha = (now() at time zone 'America/Bogota')::date
  and s.estado in ('pagado', 'pendiente', 'parcial')
  and si.master_sku is not null
group by mp.master_sku, mp.nombre_canonico
order by ingresos desc
limit 10;

create view public.v_hoy_last_hour
  with (security_invoker = true) as
select
  s.sale_id, s.canal, s.fecha, s.hora, s.total, s.estado,
  coalesce(sum(si.quantity), 0) as item_count
from public.sales s
left join public.sale_items si on si.sale_id = s.sale_id
where s.created_at >= now() - interval '1 hour'
group by s.sale_id
order by s.created_at desc
limit 50;

-- Indexes already exist on (canal, fecha desc) — sufficient for these views.
grant select on public.v_hoy_totals, public.v_hoy_per_channel, public.v_hoy_top_products, public.v_hoy_last_hour
  to authenticated;
```

### Embeddings table + HNSW index

```sql
-- migration 20260601000001_product_embeddings.sql
create table public.product_embeddings (
  master_sku        uuid       primary key references public.master_products(master_sku) on delete cascade,
  embedding         vector(1536) not null,
  source_text       text       not null,           -- concat(nombre_canonico, ' ', brand, ' ', category)
  source_hash       text       not null,           -- sha256 of source_text — short-circuit re-embed
  model             text       not null default 'text-embedding-3-small',
  updated_at        timestamptz not null default now()
);

create index product_embeddings_hnsw
  on public.product_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ANN query helper (single round-trip)
create or replace function public.find_similar_products(query_vec vector(1536), k int default 5)
returns table (master_sku uuid, distance float) language sql stable as $$
  select master_sku, embedding <=> query_vec as distance
  from public.product_embeddings
  order by embedding <=> query_vec
  limit k;
$$;
```

### Realtime subscription for "live feed"

```typescript
// apps/dashboard/app/(app)/hoy/_components/live-feed.tsx
"use client";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export function LiveFeed({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  useEffect(() => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const ch = supabase
      .channel("sales-today")
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "sales",
            filter: `fecha=eq.${new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" })}` },
          (payload) => setRows((r) => [payload.new as Row, ...r].slice(0, 50)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return /* table render */;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OAuth1.0a header signing for WC over HTTPS | `queryStringAuth: true` (consumer key/secret as URL params over HTTPS) | WC 3.x+ | Simpler client; works behind some proxies that strip Authorization headers |
| pgvector IVFFlat | pgvector HNSW | pgvector 0.5.0+ | Supabase recommends HNSW as default; better recall, no `lists` tuning |
| Custom LLM API wrappers | Vercel AI SDK `ai` + `@ai-sdk/*` | 2024–2025 | Single interface, provider swap by env var (F1 LOCKED pattern) |
| Supabase Realtime via triggers | Logical replication (pg_replication_slot) | Supabase 2026 | <12ms p90 e2e; row-level filters at publication layer; <1% write overhead |
| OpenAI `text-embedding-ada-002` (1536d) | `text-embedding-3-small` (1536d, default) or 3-large (3072d) | 2024 | Same dimension as ada-002 but better quality; ~6× cheaper |

**Deprecated/outdated:**
- WC REST v1/v2 — use v3.
- `?after=` for modified-date filtering — use `?modified_after=`.
- pgvector IVFFlat for <50k vectors — HNSW dominates at our scale.
- Hand-rolled OAuth1.0a — use the official SDK.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Client uses WC Order Export Lite / similar plugin for historical CSV (column names in the mapping profile) | CSV mapping profile | If column names differ, the profile insert is wrong — but it's a versioned row, easy to add v2. The `CSVConnector` mapping flow already supports per-upload profile selection. |
| A2 | Daily order volume <500/day | Pitfall 7 (LLM cost) | If 5k/day, arbiter cost balloons 10× — mitigation: tighter `embeddingsHigh` threshold to bypass arbiter more often |
| A3 | Catalog size 5–20k products | Embeddings sizing | If 200k+, HNSW build time and memory become real; revisit with `m`/`ef_construction` tuning |
| A4 | Client's WC store serves HTTPS (not HTTP) | Auth pattern | If HTTP, must use OAuth1.0a header signing — change SDK config `queryStringAuth: false` |
| A5 | Webhook secret is configured in WC admin (not the same as consumer secret) | Webhook verify | WC requires explicit `secret` field on the webhook; if absent, signature header is missing and verify must short-circuit on unconfigured-mode |
| A6 | Spanish-language product names (no translation cascade needed) | Embeddings + arbiter prompt | If catalog is mixed ES/EN, `text-embedding-3-small` still handles both well (MIRACL multilingual gain documented) |
| A7 | Kimi K2 remains the F1 LLM default | Cascade level 5 | If F1 was switched, the F1 env-driven adapter picks up the new provider automatically — no code change needed |
| A8 | Existing F1 indexes on `sales(canal, fecha desc)` + `sale_items(sale_id)` are sufficient for "Hoy" view performance at v1 scale | Hoy view query plan | Verified to exist in migration 0005; should give sub-100ms responses at 5k tx/mo |
| A9 | Webhook receiver returns 200 within 5s (WC retry cliff) | Pitfall 1 | Hono on Railway easily meets this with async waitUntil; no measured risk |
| A10 | `c.executionCtx?.waitUntil` is available on the Hono Node adapter | Async post-ACK work | The Node adapter is Cloudflare-Workers-like; if `executionCtx` is undefined, fall back to fire-and-forget Promise + structured logging |

## Open Questions

1. **Does the orchestrator have a durable queue or just in-process async?**
   - What we know: F1 ships `p-retry` + DLQ pattern, but no Redis/SQS — just Postgres tables.
   - What's unclear: For "ACK fast, process async", do we (a) write to `raw_orders` and let a poller pick up `processed=false` rows, or (b) keep work in-process with `waitUntil`?
   - Recommendation: Pattern (a) is more durable. Add `raw_orders.processed boolean default false` and have a 1-min Railway cron process the backlog. Webhook just writes raw + ACKs.

2. **WP variant of "Hoy" categories filter for analista role**
   - What we know: Analista sees `sale_items` columns but not `$` columns or customer columns.
   - What's unclear: Should the per-channel chart show counts only (no totals)?
   - Recommendation: Yes — `v_hoy_per_channel_analista` view shows `ordenes` count but `null` for `ingresos`. Or skip the chart entirely for analista; surface "Productos vendidos hoy" instead.

3. **What's the WC webhook delivery mechanism?**
   - What we know: WC core supports webhooks. Some shops use a 3rd-party (Hookdeck, Pipedream) as a relay for reliability.
   - What's unclear: If client uses a relay, signature format may change.
   - Recommendation: Build to native WC HMAC-SHA256 first; relay support is opt-in via additional env vars later.

4. **Catalog ground truth for embedding source text**
   - What we know: `master_products.nombre_canonico` is the source.
   - What's unclear: Should we concat brand + category + first-image alt-text?
   - Recommendation: Start with `nombre_canonico + ' ' + brand + ' ' + category`. Store the hash; if recall is poor in production, iterate.

5. **Does the validation queue support reassignment?**
   - What we know: REQUIREMENTS.md says "validado_humano=true". It doesn't say humans can pick a different master_sku.
   - What's unclear: Reject + manual-pick flow.
   - Recommendation: Ship MVP: accept (current candidate) or reject (no master_sku, item stays unmatched). Add manual-pick in F3 if it's a friction point.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥22 | Orchestrator + dashboard | ✓ | per F1 lockfile | — |
| Supabase Postgres + pgvector + pg_trgm | Embeddings + matching | ✓ | enabled in migration 0001 | — |
| Supabase Storage (csv-uploads bucket) | WP CSV historical | ✓ | created in migration 0003 | — |
| Supabase Realtime | Live-feed component | ✓ (enabled per F1 schema) | — | Polling at 60s |
| Hono webhook endpoint (Railway public URL) | WC webhook receipt | ✓ | F1 server.ts has placeholder | — |
| Railway cron | Hourly WP pull | ✓ | F1 cron.ts has heartbeat | — |
| WordPress REST API credentials (`WORDPRESS_API_URL`, `WORDPRESS_API_KEY`, `WORDPRESS_API_SECRET`) | WP-01 live | ✗ | — | **Degraded mode: connector reports `ok:false, last_error:'not configured'`**; rest of phase ships without WP credentials |
| WordPress webhook secret (`WORDPRESS_WEBHOOK_SECRET`) | Signature verify | ✗ | — | Same degraded mode |
| OpenAI API key (`OPENAI_API_KEY`) | Embeddings + optional arbiter | ✓ (assumed from F1) | — | If absent → cascade short-circuits at level 3, items go to queue; the cascade must NOT throw |
| LLM provider key (any of the F1 adapter set) | Arbiter | ✓ | — | If `LLM_PROVIDER=none` → arbiter returns reject; level 4 mid items go to queue |
| WP historical CSV from client | WP-02 backfill | ⚠ depends on client | — | Phase can ship CSV mapping profile + upload UI without the file; client uploads when ready |

**Missing dependencies with no fallback:**
- (None — all WP-01–WP-05 paths ship with explicit fallbacks)

**Missing dependencies with fallback:**
- WordPress API credentials → degraded health + skip pulls; WP-02..WP-06 ship via CSV path
- LLM provider → level 5 disabled, increases queue volume but doesn't block ingestion

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.8 (F1 standard) |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `pnpm --filter @faka/connectors test` |
| Full suite command | `pnpm test` (all workspaces) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WP-01 | WC webhook HMAC verify accepts valid sig, rejects tampered | unit | `pnpm -F @faka/connectors test wordpress/webhook-verify` | ❌ Wave 0 |
| WP-01 | WC webhook handler dedupes by delivery_id | unit | `pnpm -F @faka/orchestrator test webhooks/wordpress` | ❌ Wave 0 |
| WP-01 | `fetchOrders(since)` paginates correctly | unit (msw mock) | `pnpm -F @faka/connectors test wordpress/fetch-orders` | ❌ Wave 0 |
| WP-01 | `normalizeOrder` maps WC→NormalizedOrder | unit (golden) | `pnpm -F @faka/connectors test wordpress/normalize-order` | ❌ Wave 0 |
| WP-01 | Degraded mode: connector returns `ok:false` when env unset | unit | `pnpm -F @faka/connectors test wordpress/health` | ❌ Wave 0 |
| WP-02 | WP CSV mapping profile seed inserts cleanly | sql test | `pnpm -F @faka/db test:sql` | ❌ Wave 0 |
| WP-02 | Upload via dashboard + commit-upload writes `sales` rows | integration | `pnpm -F dashboard test:integration` (Supabase local) | ❌ Wave 0 |
| WP-03 | Cascade level 1 barcode → score 1.0 | unit | `pnpm -F @faka/connectors test matching/cascade` | ❌ Wave 0 |
| WP-03 | Cascade short-circuits on validated mapping | unit | same | ❌ Wave 0 |
| WP-03 | Cascade level 4 embeddings calls OpenAI mock + pgvector | integration | `pnpm -F @faka/connectors test:integration` | ❌ Wave 0 |
| WP-03 | Cascade below `queueCutoff` writes nothing to `product_mappings` | unit | same | ❌ Wave 0 |
| WP-04 | Validation queue Server Action flips `validado_humano=true` | integration | `pnpm -F dashboard test:integration matching` | ❌ Wave 0 |
| WP-04 | Analista cannot fetch customer columns via queue route | integration | `pnpm -F dashboard test:rls` | ❌ Wave 0 |
| WP-04 | Validation writes `audit_log` row with `role_at_time` | integration | same | ❌ Wave 0 |
| WP-05 | `v_hoy_totals` returns correct number across mixed channels | sql test | `pnpm -F @faka/db test:sql hoy-views` | ❌ Wave 0 |
| WP-05 | "Hoy" page renders <500ms with 5k tx | manual (Lighthouse / smoke) | `pnpm -F dashboard build && pnpm -F dashboard test:smoke` | ❌ Wave 0 |
| WP-05 | Realtime live-feed receives new INSERT within 30s | manual-only (needs live ws) | manual smoke | — |
| WP-06 | E2E latency: simulate WC webhook → assert `sales` row + view contains it ≤2 min | integration | `pnpm -F @faka/orchestrator test:e2e wp-latency` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm -F <package> test -- --changed` (or full filtered suite if Vitest config doesn't support `--changed`)
- **Per wave merge:** `pnpm test` (all workspaces)
- **Phase gate:** Full suite green + manual smoke of "Hoy" view + one real-world WP webhook end-to-end if creds available; otherwise mock-driven `test:e2e` is acceptable

### Wave 0 Gaps

- [ ] `packages/connectors/tests/wordpress/webhook-verify.test.ts` — HMAC fixtures (valid + tampered)
- [ ] `packages/connectors/tests/wordpress/normalize-order.test.ts` — golden WC payload fixture
- [ ] `packages/connectors/tests/wordpress/fetch-orders.test.ts` — MSW mock for paginated `/orders`
- [ ] `packages/connectors/tests/matching/cascade.test.ts` — table-driven cases per level
- [ ] `packages/connectors/tests/matching/fixtures/` — sample products + sale items
- [ ] `apps/orchestrator/tests/webhooks/wordpress.test.ts` — Hono `app.request(...)` style
- [ ] `apps/orchestrator/tests/e2e/wp-latency.test.ts` — uses Supabase local + injected mock WC
- [ ] `apps/dashboard/tests/matching/validate-mapping.test.ts` — Server Action contract
- [ ] `apps/dashboard/tests/hoy/views.test.ts` — Supabase local view assertions
- [ ] `packages/db/tests/sql/hoy-views.test.sql` — pg_prove or hand-rolled `psql` assertions
- [ ] `msw` dev dep added to `@faka/connectors` for HTTP mocking — `pnpm -F @faka/connectors add -D msw`
- [ ] Integration test harness for Supabase local already exists per F1; verify it's wired

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (F1); WC consumer-key + secret stored Railway env only |
| V3 Session Management | yes | Supabase SSR cookies (F1); no new session surface in F2 |
| V4 Access Control | yes | RLS on all base tables; per-role `SECURITY INVOKER` views; F2 must read role-specific view in validation queue |
| V5 Input Validation | yes | `zod` schemas for WC payloads + Server Action inputs; webhook body validated AFTER signature verify |
| V6 Cryptography | yes | `node:crypto` `createHmac('sha256')` + `timingSafeEqual` for webhook verify — never custom |
| V7 Errors & Logging | yes | `pino` structured logs (F1); `connector_runs.errors_json` for sync failures; `audit_log` for validations |
| V9 Communications | yes | HTTPS-only for WC (enforced by `queryStringAuth` SDK option requiring https URL) |
| V10 Malicious Code | yes | Pin all deps; SDK from official `@woocommerce` org only |
| V13 API & Web Service | yes | Hono validates `:canal` route param; webhook endpoint has dedicated route, not generic catchall |

### Known Threat Patterns for {Hono webhook receiver + Supabase orchestrator}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged WC webhook (no signature) | Spoofing | Mandatory HMAC verify; 401 on missing/invalid header |
| Signature replay | Tampering / Repudiation | Dedupe by `X-WC-Webhook-Delivery-ID` + timestamp window check (reject deliveries > 24h old) |
| Webhook body tampering | Tampering | HMAC verify over raw body bytes; constant-time compare |
| Customer PII leak via validation queue | Information disclosure | Queue reads via `*_view_analista` for analista role; integration test asserts no email/phone in response |
| OpenAI prompt injection from product name | Tampering | Arbiter prompt uses structured JSON output; reject any non-JSON; strip control chars before send |
| Embedding cost runaway from attacker-controlled product names | DoS / Cost | Daily token cap env; rate-limit per-canal sync; max source_text length 512 chars before embedding |
| LLM key leak via error responses | Information disclosure | `pino` redact rules on `LLM_*` / `OPENAI_*` / `WORDPRESS_API_SECRET` env vars |
| WC consumer secret in browser bundle | Information disclosure | All WC keys server-side only; dashboard never imports `@faka/connectors/wordpress` |
| RLS bypass via service-role in dashboard | Elevation of privilege | Dashboard uses anon key + user JWT (RLS enforced); service-role exclusively in orchestrator |
| Validation queue mass-flip without audit | Repudiation | Every accept/reject writes `audit_log` with `role_at_time`; bulk operation = N audit rows, not one |
| WC API key rotation | Operational | Key resolution at boot only; on rotation, restart Railway service; document in runbook |
| Webhook replay across environments (staging hits prod) | Tampering | Separate webhook secrets per env; orchestrator binds to env-specific secret |

## Sources

### Primary (HIGH confidence)

- F1 codebase: `/home/mandark/faka/packages/connectors/src/types.ts` — ChannelConnector interface
- F1 codebase: `/home/mandark/faka/packages/connectors/src/idempotency.ts` — idempotentUpsert
- F1 codebase: `/home/mandark/faka/packages/connectors/src/observability.ts` — recordConnectorRun
- F1 codebase: `/home/mandark/faka/scripts/discovery/llm-arbiter.ts` — resolveLLMConfig + arbitrateWithLLM
- F1 codebase: `/home/mandark/faka/packages/db/supabase/migrations/20260513000001..0013` — all schema
- F1 codebase: `/home/mandark/faka/packages/db/helpers/audit.ts` — auditLog
- F1 codebase: `/home/mandark/faka/apps/orchestrator/src/server.ts` — Hono + placeholder webhook
- F1 codebase: `/home/mandark/faka/apps/dashboard/app/(app)/operacion/upload/page.tsx` — wizard pattern
- [WooCommerce REST API v3 docs](https://woocommerce.github.io/woocommerce-rest-api-docs/v3.html) — endpoints, pagination, OAuth
- [WC Webhook signature verification (Hookdeck guide)](https://hookdeck.com/webhooks/platforms/guide-to-woocommerce-webhooks-features-and-best-practices)
- [Supabase pgvector HNSW indexes](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)
- [Supabase Realtime postgres_changes](https://supabase.com/docs/guides/realtime/postgres-changes)

### Secondary (MEDIUM confidence)

- [Voyage AI voyage-3 announcement](https://blog.voyageai.com/2024/09/18/voyage-3/) — dimension/cost comparison
- [Embedding Models in 2025/2026 (Medium)](https://medium.com/@alex-azimbaev/embedding-models-in-2025-technology-pricing-practical-advice-2ed273fead7f)
- [WC GitHub issue #14539](https://github.com/woocommerce/woocommerce/issues/14539) — `?after=` historical bug
- [pgvector HNSW vs IVFFlat performance study](https://medium.com/@bavalpreetsinghh/pgvector-hnsw-vs-ivfflat-a-comprehensive-study-21ce0aaab931)
- [Supabase 2026 Realtime architecture teardown](https://johal.in/architecture-teardown-supabase-2026-realtime-works-using-postgresql/)

### Tertiary (LOW confidence — flag for plan-time validation)

- Exact NPM version of `@woocommerce/woocommerce-rest-api` — registry probe timed out; pin at plan time
- `p-limit` v6 — `[ASSUMED]` from training; verify
- `c.executionCtx?.waitUntil` availability on Hono Node adapter — `[ASSUMED]`; if absent, replace with persisted-queue pattern (raw_orders.processed flag)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — most libs already in F1; new additions (WC SDK, p-limit) are industry standard
- Architecture: HIGH — composes F1 primitives (ChannelConnector, idempotentUpsert, recordConnectorRun, auditLog, SECURITY INVOKER views) without new infrastructure
- Pitfalls: HIGH — webhook + WC pitfalls verified against WC docs + GitHub issues; cascade pitfalls derived from F1 discovery code

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days — stable WC + pgvector + Supabase stack; embedding model landscape moves faster, revisit if F2 slips into July)
