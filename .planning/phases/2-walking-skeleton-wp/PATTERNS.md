# Phase 2: Walking Skeleton (WordPress) — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** ~30 new file targets across 10 areas
**Analogs found:** 9 strong / 10 (matching cascade has no analog — design from scratch)

This document maps every new file Phase 2 will create to its closest existing analog in the F1 codebase. The planner consumes this to write per-plan action lists; every action should reference an analog (`<file>:<line-range>`) and the specific pattern to copy.

---

## File Classification

| New file / module | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `packages/connectors/src/wordpress/index.ts` (rewrite skeleton) | connector | pull + push | `packages/connectors/src/csv/index.ts` | exact (role) |
| `packages/connectors/src/wordpress/{client,fetch-orders,fetch-products,normalize-order,normalize-product,webhook-verify,webhook-dedupe,config}.ts` | service modules | request-response + transform | `packages/connectors/src/csv/{column-map,dry-run,auto-detect}.ts` | role-match |
| `apps/orchestrator/src/routes/webhooks-wordpress.ts` | controller (Hono handler) | event-driven (webhook) | `apps/orchestrator/src/server.ts:52-54` (stub) + full file pattern | partial |
| `apps/orchestrator/src/jobs/sync-wp-{orders,products}.ts`, `re-cascade-unmatched.ts`, `reembed-products.ts` | cron job | batch | `apps/orchestrator/src/cron.ts:1-55` | role-match (heartbeat only) |
| `packages/connectors/src/matching/{cascade,level-1..5,thresholds,types}.ts` | service | transform + CRUD | **NO ANALOG** — `scripts/discovery/cascade.ts` is the only reference, but in scripts/ not packages/ | none |
| `packages/llm/src/{resolve-config,arbiter,prompts}.ts` (new workspace pkg) | service (LLM adapter) | request-response | `scripts/discovery/llm-arbiter.ts:1-247` | exact (lift verbatim) |
| `packages/db/supabase/migrations/20260601000001_product_embeddings.sql` | migration | DDL | `20260513000004_master_layer.sql:17-45` (table+index style) | exact |
| `packages/db/supabase/migrations/20260601000002_hoy_views.sql` | migration | DDL (views) | `20260513000011_role_views.sql:20-66` (security_invoker views) | exact |
| `packages/db/supabase/migrations/20260601000003_wp_csv_profiles.sql` OR seed.sql extension | seed | INSERT | `packages/db/supabase/seed.sql:15-42` (WP products profile already there!) | exact |
| `apps/dashboard/app/(app)/matching/page.tsx` | page (Server Component) | CRUD list | `apps/dashboard/app/(app)/operacion/historial/page.tsx:44-183` | exact |
| `apps/dashboard/app/(app)/matching/[mappingId]/page.tsx` | page (detail) | request-response | `apps/dashboard/app/(app)/operacion/upload/page.tsx:25-82` | role-match |
| `apps/dashboard/app/(app)/matching/_actions/{validate-mapping,reject-mapping,bulk-validate}.ts` | Server Action | CRUD | `apps/dashboard/app/(app)/operacion/upload/_actions/commit-upload.ts:41-228` | exact (auth+audit+errors+finally pattern) |
| `apps/dashboard/app/(app)/matching/_components/*.tsx` (row actions, modal) | client component | event-driven | `apps/dashboard/app/(app)/operacion/historial/_components/history-row-actions.tsx:1-48` | exact |
| `apps/dashboard/app/(app)/hoy/page.tsx` | page (Server Component) | CRUD read | `apps/dashboard/app/(app)/operacion/page.tsx:1-90` + historial page for fetch+render | role-match |
| `apps/dashboard/app/(app)/hoy/_components/{totals-card,per-channel-chart,top-products-table}.tsx` | server components | request-response | historial page data-fetch+render pattern | role-match |
| `apps/dashboard/app/(app)/hoy/_components/live-feed.tsx` | client component (Realtime) | streaming (WS) | **NO ANALOG** — RESEARCH §3.5 code example is the spec | none |

---

## Pattern Assignments

### 1. WordPress connector — `packages/connectors/src/wordpress/index.ts`

**Analog:** `packages/connectors/src/csv/index.ts` (the only real `ChannelConnector` impl in F1)

**What to copy (line ranges):**

- **Factory + closure signature** (csv/index.ts:74-78): `export const createWordPressConnector: ConnectorFactory<WordPressConnectorConfig> = (config) => { const canal: Channel = "wordpress"; ... return connector as ChannelConnector; };` Identical shape — captures config in closure, hangs helper fns outside the returned object, returns the connector cast.
- **Helper-function partitioning** (csv/index.ts:80-279): pure helpers (`loadUpload`, `setStatus`, `streamRows`, `safeNormalizeOrder`, `upsertOrders`, `upsertProducts`, `markRowsProcessed`) hoisted OUTSIDE the returned connector object. WP version writes `loadConfig`, `fetchOrdersFromWC`, `verifyHmac`, `dedupeDelivery`, `upsertSales`, `upsertSaleItems` in the same shape — each takes `supabase` (or other deps) as first arg, no `this`.
- **`safeNormalize*` envelope** (csv/index.ts:148-182): every parse goes through a `safeParse → {data} | {_error}` discriminated union, then the outer flow accumulates errors instead of throwing. WP `normalize-order.ts` should mirror this so partial-batch failures don't break a sync.
- **Idempotent UPSERTs** (csv/index.ts:184-214): `supabase.from("sales").upsert(payload, { onConflict: "canal,external_order_id" })`. WP uses the IDENTICAL clause — that composite is the F1 invariant key from `idempotency.ts:13-18`.
- **`healthCheck` degraded-mode** (wordpress/index.ts:69-71 — keep current pattern): `return { ok: false, last_error: "not configured" }` when env vars missing. RESEARCH §Environment Availability mandates this for `WORDPRESS_API_URL/KEY/SECRET/WEBHOOK_SECRET`. Do NOT throw.
- **Connector contract surface** (csv/index.ts:281-381): the returned object exposes `name`, `canal`, `type`, `capabilities`, plus all five `fetchOrders/fetchProducts/normalizeOrder/normalizeProduct/healthCheck`. `extractCustomerHint` is optional (csv ships it at 346-377). WP should expose it too because WC orders carry `billing.email/phone`.

**What's different:**

- `type: "pull"` (not `"manual"` like CSV) since WP has REST sync + push webhook receipts.
- `fetchOrders`/`fetchProducts` are REAL (not the `return []` no-op in csv:292-304). They call the WC SDK via `@woocommerce/woocommerce-rest-api` (RESEARCH §Pattern 2). Pagination via `headers["x-wp-totalpages"]`.
- No `ingestUpload` method — that is CSV-specific. WP work is split between `fetchOrders` (cron) and the webhook route (orchestrator).
- WP has its own normalizer (`normalize-order.ts`) that does NOT call `applyColumnMap` — that helper is CSV-only per invariant W1.

### 2. WP webhook route — `apps/orchestrator/src/routes/webhooks-wordpress.ts`

**Analog:** `apps/orchestrator/src/server.ts` (full file is 66 lines, includes the stub at :52-54 you must replace)

**What to copy:**

- **App + Hono setup** (server.ts:1-7): same `import { Hono } from "hono"`, same `import { log, getSupabase }` from local lib. The new route file should `export function mountWordPressWebhook(app: Hono): void` and be called from `server.ts` after the existing routes; alternatively register inline in server.ts. Either way, signature/idiom matches.
- **Error envelope** (server.ts:39-46, 58-61): every catch produces `{ error, ...details }` JSON with HTTP status. Webhook errors → `c.json({ error: "invalid_signature" }, 401)` for verify failure, `c.json({ error: "internal_server_error" }, 500)` for unhandled.
- **Context construction** (server.ts:21-29): for any handler that needs to call a connector, build `ctx = { supabase, logger: { debug/info/warn/error: log.X } }` inline. Webhook handler does the same when it enqueues normalization work.
- **Replace the 501 stub** (server.ts:52-54): `app.post("/webhooks/:canal", c => c.json({ error: "NOT_IMPLEMENTED_F2", canal: c.req.param("canal") }, 501))` — Phase 2 replaces this with a dispatch on `:canal` OR mounts `/webhooks/wordpress` explicitly. RESEARCH §Pattern 1 shows the explicit-route variant; planner picks one. Recommend explicit `/webhooks/wordpress` so other channels (POS in F3) can keep the dispatcher pattern free.

**What's different:**

- Reads raw `c.req.arrayBuffer()` BEFORE any JSON parse (RESEARCH §Pitfall 2 — invariant W-new: signature is verified on bytes, never on parsed object).
- HMAC-SHA256 via `node:crypto`+`timingSafeEqual` (RESEARCH §Pattern 1 code excerpt:208-219).
- Dedupe by `X-WC-Webhook-Delivery-ID` written to `raw_events` (table from migration 0003:40-47).
- Persists raw payload to `raw_orders` then ACKs 200 — heavy lifting happens async (planner decides between `waitUntil` and a Postgres `processed=false` queue per RESEARCH Open Question §1; recommend the Postgres queue pattern for durability).

### 3. Matching cascade — `packages/connectors/src/matching/` (NO ANALOG)

**Analog:** none in `packages/`. Reference only is `scripts/discovery/cascade.ts` (not loaded — outside packages, will not be the runtime entry).

**What to copy from neighboring patterns (style only):**

- **Module layout** (csv/index.ts:1-19 doc block): every cascade file opens with a tight doc block explaining its place in the chain (W1-style boundary comments). Level files (`level-1-barcode.ts`...`level-5-llm-arbiter.ts`) each export ONE function with a strict signature `(item, ctx) => Promise<MatchResult | null>`.
- **Types-first approach** (csv/index.ts:40-72 interface block, types.ts:25-128 entire interface set): define `MatchResult`, `CascadeContext`, `SaleItemCandidate` in `matching/types.ts` first; every level imports from there. Don't inline shapes in level files.
- **Threshold constants in a single file** (RESEARCH §Pattern 3 thresholds.ts code): all env-driven cutoffs live in `matching/thresholds.ts`. Default values inline (`process.env.X ?? 0.92`) so it works in dev with no env.
- **Short-circuit + early return** (RESEARCH §Pattern 3 cascade.ts code): cascade.ts is a sequential `if (level1) return; if (level2) return; ...` chain. Verbatim from RESEARCH §3.3 code excerpt. The "validated mapping cache" check happens FIRST per RESEARCH (and matches the F1 `product_mappings.validado_humano=true` "learn once" rule from migration 0004:55-58).
- **Error propagation** (csv/index.ts:457-462): a level that throws must be caught at the cascade boundary; the cascade returns `{ method: "unresolved", score: 0, master_sku: null }` rather than letting an OpenAI 503 fail the whole sync. Match the F1 "audit failures must not block user mutations" stance from audit.ts:50-54.

**What's different:**

- Cascade is the FIRST module in `@faka/connectors` that calls external APIs (OpenAI embeddings + LLM arbiter). Wrap each external call in `p-retry` (already a dependency per RESEARCH §Standard Stack).
- Levels 1-3 are pure SQL via `supabase.from(...)`; levels 4-5 call external APIs. Keep the boundary in the level files so unit tests can mock at the right seam.
- Cascade writes to `product_mappings` via `idempotentUpsert(supabase, "product_mappings", row, { onConflict: "canal,external_id" })` — copy from csv/index.ts:259-263.

### 4. Embeddings migration — `packages/db/supabase/migrations/20260601000001_product_embeddings.sql`

**Analog:** `packages/db/supabase/migrations/20260513000004_master_layer.sql:17-45` (master_products table style); `20260513000003_raw_layer.sql:22-50` (raw_* tables, btree index style)

**What to copy:**

- **Top-of-file doc block** (master_layer.sql:1-11): `-- Migration NNNN — <name>. -- Phase 2 / Plan N.M. --` then 3-5 lines explaining purpose. Standard across F1.
- **Table column conventions** (master_layer.sql:17-35): `primary key default gen_random_uuid()` for UUID PKs (here master_sku is the PK + FK in one), `not null` explicit on every non-nullable column, `timestamptz not null default now()` for `created_at/updated_at`. RESEARCH §Embeddings table example matches this exactly.
- **FK pattern** (master_layer.sql:60-61): `references public.master_products (master_sku) on delete cascade`. Embeddings table uses identical clause — when a master product disappears, its embedding goes with it.
- **Partial-unique-index pattern** (master_layer.sql:37-43): for embeddings we instead use the HNSW vector index — `create index product_embeddings_hnsw on public.product_embeddings using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);` (RESEARCH §Code Examples).
- **SQL function pattern** (uses `language sql stable as $$ ... $$`): RESEARCH §Code Examples `find_similar_products` follows F1 helper-function shape; planner can add or skip — the ANN query works inline too.

**What's different:**

- pgvector `vector(1536)` type, never seen before in F1 schema. Verify migration 0001 has `create extension if not exists vector` (RESEARCH §Environment Availability confirms it).
- HNSW index syntax — unique to pgvector; no F1 analog.
- A separate concept (`source_hash`, `model` columns) for invalidating embeddings when source text changes (RESEARCH §Pitfall 5).

### 5. LLM arbiter package — `packages/llm/`

**Analog:** `scripts/discovery/llm-arbiter.ts:1-267` (lift verbatim)

**What to copy:**

- **Entire `resolveLLMConfig` + provider table** (llm-arbiter.ts:1-98): copy verbatim. The env-driven, autodetect-ordered, CLI-override-first config resolver is the F1 LOCKED pattern (RESEARCH §Don't Hand-Roll). The match cascade level 5 imports `resolveLLMConfig` and `arbitrateWithLLM` from `@faka/llm`.
- **`arbitrateWithLLM`** (llm-arbiter.ts:128-167): the `try/catch → return { isMatch:false, confidence:0, rationale:err }` pattern is exactly how external-call failures degrade — copy verbatim.
- **`buildModel` switch** (llm-arbiter.ts:169-208): keep the dynamic `await import("@ai-sdk/X")` pattern so missing providers don't crash bundling.
- **JSON extraction** (llm-arbiter.ts:210-225): `extractJSON` handles fenced ```json blocks, then bare braces — keep verbatim. WC product names are noisy and the arbiter sometimes wraps output in fences.
- **`promoteToMatch`, `summarizeConfig`, `estimateCallCost`** (llm-arbiter.ts:227-267): all useful for the cascade + the dashboard health view. Lift unchanged.

**What's different (packaging changes only):**

- **New workspace package boundary**: `packages/llm/package.json` with name `@faka/llm`, exports the three files. Mirror `packages/connectors/package.json` layout (read that file when packaging).
- **Imports of `CanonicalProduct` and `MatchResult`** (llm-arbiter.ts:1): currently `import type { CanonicalProduct, MatchResult } from "./types.js"` — those types live in `scripts/discovery/types.ts`. When packaging, EITHER move those types into `@faka/llm/src/types.ts` (preferred — keep the arbiter self-contained), OR redefine the minimal subset (`anchor.name`, `anchor.brand`, etc.) the arbiter actually reads. The cascade in `@faka/connectors/matching` should then import from `@faka/llm` without circular deps.
- **Cost estimate prices** (llm-arbiter.ts:255-264): re-verify at packaging — the 2026 prices may have moved.
- **Spanish system prompt** (llm-arbiter.ts:100-110): unchanged; matches the F1 "Colombia retail" arbiter contract.

### 6. Validation queue UI — `apps/dashboard/app/(app)/matching/`

**Analogs:**
- List page: `apps/dashboard/app/(app)/operacion/historial/page.tsx:1-183` (list view with row actions)
- Detail page wrapper: `apps/dashboard/app/(app)/operacion/upload/page.tsx:25-82` (URL-driven step pattern; matching detail uses `[mappingId]/page.tsx` instead of `?step=`)
- Server Action: `apps/dashboard/app/(app)/operacion/upload/_actions/commit-upload.ts:1-228` (auth + try/catch/finally + audit + connector_runs)
- Row actions (client): `apps/dashboard/app/(app)/operacion/historial/_components/history-row-actions.tsx:1-48`

**What to copy:**

- **Page header pattern** (historial/page.tsx:67-84): `<header className="mb-6 flex items-center justify-between">` with `<h1>` + descriptor `<p>` + right-aligned action link. Validation queue uses the same.
- **DataTable usage** (historial/page.tsx:104-180): `DataTable<Row>` from `@faka/ui` with `rows`, `keyFn`, `columns`. Each column has `header`, `cell: (row) => ReactNode`, optional `className`/`thClassName`. Validation queue columns: candidate name, master candidate name, score, method, channel, side-by-side button, accept/reject. Use the same `Badge` variants for match_method (info/warn/err).
- **List Server Action** (historial/_actions/list.ts:21-60): pattern is `"use server"; export async function listX(limit=50): Promise<Row[]>` reading from a `view_*` (when role-restricted) or base table. For validation queue read `product_mappings` JOIN `master_products` JOIN `sales`-via-`sale_items` for context; PLUS the role-gated view per RESEARCH §Pitfall 9 (`*_view_analista` returns nulled customer columns from migration 0011:49-66).
- **Server Action skeleton** (commit-upload.ts:41-228): the canonical 7-step shape for every new Server Action — (1) `createClient()`, (2) `requireRole(supabase, [...])` in a `try/catch ForbiddenError`, (3) the work, (4) `auditLog(supabase, {user_id, role_at_time, action, target_table, target_id, payload_json})` (commit-upload.ts:185-196), (5) `return { ok, ... }` or `{ ok: false, error }`, (6) `finally` that writes `recordConnectorRun` IF the action represents a connector run, (7) `revalidatePath` (reprocess.ts:291). For `validate-mapping.ts`, skip step 6 (validation is not a "run"). For `bulk-validate.ts`, write ONE audit row per mapping (RESEARCH §Security: "bulk operation = N audit rows, not one").
- **Role-gating** (commit-upload.ts:48): `requireRole(supabase, ["super_admin", "admin", "manager"])` — Analista is excluded from validating mappings (queue is read-only for them per ADR-002, F1 role matrix).
- **Row actions client component** (history-row-actions.tsx:1-48): same `"use client"` + Button + modal-open state pattern for "Accept", "Reject", "Open side-by-side" buttons. The row-actions component should accept a callback to a Server Action; on click it calls the action and `router.refresh()` or relies on `revalidatePath`.
- **`createClient` from `@/lib/supabase/server`** (commit-upload.ts:25): always this import in Server Components/Actions. The browser variant `createBrowserClient` only appears in `live-feed.tsx` for Realtime.

**What's different:**

- No CSV-specific concerns (no Storage, no `raw_csv_rows` writes, no `applyColumnMap`).
- Reads role-gated view (`sale_items_view_analista` etc.) when surfacing context; never reads `raw_orders.payload_json` directly (RESEARCH §Pitfall 9 — that would expose customer PII to Analista).
- No `connector_runs` write — validation is an app-layer event, not a sync run.
- The detail page (`[mappingId]/page.tsx`) is a parameterized dynamic route — not in F1 yet. Same `searchParams`-less data-fetch pattern as historial; replace `searchParams` with `params: { mappingId: string }`.

### 7. "Hoy" view — `apps/dashboard/app/(app)/hoy/`

**Analogs:**
- Page shell + role-header read: `apps/dashboard/app/(app)/operacion/page.tsx:15-90`
- Server data fetch + render: `apps/dashboard/app/(app)/operacion/historial/page.tsx:44-77`
- Layout/role flow: `apps/dashboard/app/layout.tsx:25-96` (READS `headers().get("x-user-role")` — invariant W5)

**What to copy:**

- **Server Component page entry** (operacion/page.tsx:15): `export default function HoyPage()` with no auth call inside — middleware already gated and the layout already reads the role from `x-user-role`. Just `const role = headers().get("x-user-role") as UserRole | null` (operacion/page.tsx:16).
- **Header + grid layout** (operacion/page.tsx:18-87): `<div><header className="mb-6">...</header><div className="grid grid-cols-1 md:grid-cols-2 gap-4">...</div></div>`. Hoy uses the same shell with 4 sub-components inside the grid.
- **`createClient` + data fetch** (historial/page.tsx:49-63): `const supabase = createClient(); const { data, error } = await supabase.from("v_hoy_totals").select("*").single();` etc. Each sub-component is a server component that takes its row(s) as props from the parent page — DO NOT re-fetch in children.
- **Card components** (operacion/page.tsx:29-83): every panel wrapped in `<Card><CardHeader><CardTitle/><CardDescription/></CardHeader><CardContent>...</CardContent></Card>` from `@faka/ui`. Totals card matches operacion's card pattern exactly.
- **`export const dynamic = 'force-dynamic'`** (RESEARCH §Pitfall 12): Hoy must opt out of Next.js fetch cache. F1 pages don't set this yet (they're cache-friendly), so this is a NEW pattern Phase 2 introduces; doc it in the file's top comment.
- **Live feed client component** (RESEARCH §Code Examples live-feed.tsx, NO F1 analog): `"use client"` boundary, `createBrowserClient` from `@supabase/ssr`, `.channel("sales-today").on("postgres_changes", { event: "INSERT", schema: "public", table: "sales", filter: \`fecha=eq.${today}\` }, ...)`. Initial rows passed as props (server-rendered), then mutate via state.

**What's different:**

- Reads VIEWS (`v_hoy_*`), not base tables. This is a NEW class of view (non-role-gated `v_*` prefix vs the F1 `*_view_<role>` suffix). RESEARCH §Code Examples shows the SQL.
- One Client Component (`live-feed.tsx`) — the rest are Server Components. F1's only Client Components today are `history-row-actions.tsx`, `step-source/mapping/validate.tsx`, `reprocess-modal.tsx`.
- Realtime subscription is a Phase-2-first pattern; `live-feed.tsx` has no analog.

### 8. Postgres views — `packages/db/supabase/migrations/20260601000002_hoy_views.sql`

**Analog:** `packages/db/supabase/migrations/20260513000011_role_views.sql:20-66` (19 existing `security_invoker` views demonstrate the canonical pattern)

**What to copy:**

- **Mandatory `with (security_invoker = true)`** (role_views.sql:20-21, repeated 19 times): EVERY view in this migration must include this clause on its own line. This is invariant CC-12 and the file's leading comment (role_views.sql:3-5) is the authoritative source: "RESEARCH Pitfall 1 — MANDATORY: every view has `with (security_invoker = true)`. Without it, SECURITY DEFINER semantics bypass RLS on the base table".
- **GRANT pattern** (role_views.sql granting block at end; RESEARCH §Code Examples line `grant select on public.v_hoy_totals, ... to authenticated;`): one `grant select` at the bottom listing every new view. Migration 0012 (grants_on_views) is the F1 home for these — planner decides whether to put grants inline or extend 0012's pattern.
- **Hoy timezone filter** (RESEARCH §Code Examples): `where s.fecha = (now() at time zone 'America/Bogota')::date` — `sales.fecha` is already a `date` (per migration 0005), so the cast is comparing two dates in the same TZ. Matches F1 §Pitfall 10 mitigation.
- **Status filter** (RESEARCH §Code Examples): `and s.estado in ('pagado', 'pendiente', 'parcial')` — never include cancelado/devuelto in the day's totals.
- **Aggregation idiom** (no F1 analog yet — these are the first aggregate views): `coalesce(sum(total), 0)::numeric(14,2)` so an empty day shows zeros, not nulls. Follow column types from `sales.total numeric(14,2)` (migration 0005).
- **Top-of-file doc block** (role_views.sql:1-14): keep the same shape — name the phase/plan, restate the security invariant, point at the ADR.

**What's different:**

- These views are NOT per-role (no `_view_admin`/`_view_manager`/`_view_analista` suffix). RESEARCH Open Question §2 flagged a possible `v_hoy_per_channel_analista` variant; planner decides. If split-by-role, follow the F1 19-view convention; if not, document why ($-aware aggregates are role-aware by NOT exposing $ to Analista's grant — alternatively, make the per-channel chart show only counts).
- Aggregating across `sales` + `sale_items` JOINs — F1 role views are mostly column-projections from a single table.

### 9. WP CSV mapping profile — extend `packages/db/supabase/seed.sql`

**Analog:** `packages/db/supabase/seed.sql:15-42` (WP products profile already there + 4 other channels at lines 48-152)

**What to copy:**

- **Insert with `$$..$$::jsonb`** (seed.sql:21-39): dollar-quoted JSON literal so embedded double quotes don't need escaping. Apply to BOTH the orders profile and the products profile (extending the existing `WordPress · Export productos · v1` entry if needed).
- **Idempotent `on conflict do nothing`** (seed.sql:42, repeated on every insert): the unique constraint `(canal, tipo, nombre, version)` (migration 0003:71) makes the seed re-runnable.
- **Naming convention** (seed.sql:21): `'<Channel> · <Description> · v<N>'` — keep verbatim: `'WordPress · Orders Export (WC Order Export Lite) · v1'`.
- **`reglas_json` for transformations** (seed.sql:35,67,99,127): use the existing column for `date_format`, `timezone`, `status_map`, `image_split`. RESEARCH §Code Examples WP CSV mapping shows the exact shape.
- **`version: 1, is_active: true`** (seed.sql:40-41): same defaults.

**What's different:**

- Adds an `'orders'` tipo profile for WordPress (F1's WP profile is `'products'` only). RESEARCH §Code Examples gives the column_map and reglas_json verbatim.
- May supersede or extend the existing F1 WP-products profile (seed.sql:15-42) — that profile maps `external_id, sku, name, description, category, brand, price, barcode, supplier_code, image_url, status`. RESEARCH §Code Examples adds nothing missing; planner verifies the F1 profile is still correct for the client's actual WC export and adds a v2 row if not.

### 10. Roles — every new UI page + Server Action

**Analog:** every existing dashboard page reads `x-user-role` header (W5 invariant):
- Layout: `apps/dashboard/app/layout.tsx:30-32`
- Operacion page: `apps/dashboard/app/(app)/operacion/page.tsx:15-16`
- Server Action role gate: `apps/dashboard/app/(app)/operacion/upload/_actions/commit-upload.ts:46-52`
- The helper: `packages/auth/src/require-role.ts:35-49`

**What to copy:**

- **Pages (Server Components)**: `const role = headers().get("x-user-role") as UserRole | null` (layout.tsx:31, operacion/page.tsx:16). Never call `supabase.auth.getUser()` from a page render. The middleware already extracted the role and set the header (W5).
- **Server Actions**: WRAP every action body in `try { const ctx = await requireRole(supabase, [allowedRoles]); ... } catch (err) { if (err instanceof ForbiddenError) return { ok: false, error: "forbidden" }; return { ok: false, error: "auth_failed" }; }` — verbatim from commit-upload.ts:46-52. Use `ctx.user.id` and `ctx.role` downstream (specifically in `auditLog({ user_id: ctx.user.id, role_at_time: ctx.role })`).
- **Allowed roles per Phase 2 surface**:
  - `/matching` page + actions: `["super_admin", "admin", "manager"]` (Analista cannot validate — read-only catalog access only).
  - `/hoy` page: all 4 roles, but Analista sees nulled $ columns (already enforced by views).
  - Webhook route: NO role gate — only HMAC signature; service-role context.
  - Cron job: NO role gate — service-role context.

**What's different:**

- Webhook + cron skip `requireRole` entirely (no human user in the request); they use `getSupabase()` from `apps/orchestrator/src/lib/supabase.js` which returns a service-role client.

---

## Shared Patterns

### Authentication & Role-gating
**Source:** `packages/auth/src/require-role.ts:35-49` + `apps/dashboard/middleware.ts:1-13`
**Apply to:** every new Server Action in `apps/dashboard/app/(app)/matching/_actions/*.ts` and any data action in `hoy/`.
Pattern: `await requireRole(supabase, [...allowed])` inside `try/catch (ForbiddenError)`; return `{ ok:false, error:"forbidden" }` on mismatch. Layout reads `x-user-role` header (W5) — pages do the same.

### Error Handling Envelope (Server Actions)
**Source:** `apps/dashboard/app/(app)/operacion/upload/_actions/commit-upload.ts:41-228`
**Apply to:** every new Server Action.
Pattern: `Promise<{ ok: true, ...data } | { ok: false, error: string }>` return type. Outer `try/catch` wraps the whole body. `finally` writes `recordConnectorRun` IF the action represents a connector run. `revalidatePath(...)` in `finally` for list pages (reprocess.ts:291).

### Idempotent UPSERT
**Source:** `packages/connectors/src/idempotency.ts:35-55` + usage in `csv/index.ts:211-214, 259-263`
**Apply to:** every WP order write, every cascade `product_mappings` write.
Pattern: `supabase.from("sales").upsert(rows, { onConflict: "canal,external_order_id" })` for orders; `{ onConflict: "canal,external_id" }` for product_mappings. Composite keys are the F1 invariant.

### Audit Logging
**Source:** `packages/db/helpers/audit.ts:37-55` + usage in `commit-upload.ts:185-196`
**Apply to:** every validation action (accept, reject, bulk).
Pattern: `await auditLog(supabase, { user_id: ctx.user.id, role_at_time: ctx.role, action, target_table, target_id, payload_json })`. Bulk = N audit rows (RESEARCH §Security). Audit failures NEVER throw (audit.ts:50-54).

### connector_runs Write
**Source:** `packages/connectors/src/observability.ts:31-75` + cron.ts:30-44 + commit-upload.ts:209-227
**Apply to:** every WP sync (orders/products cron + webhook batch), every cascade run.
Pattern: write ONCE at end of run in `finally`. `kind:"channel", canal:"wordpress"` for syncs; `kind:"cron-heartbeat", canal:null` ONLY for the existing heartbeat (W2 invariant — never use `cron-heartbeat` for the WP cron jobs). Cron sync jobs use `kind:"channel"`.

### Hono Handler Shape
**Source:** `apps/orchestrator/src/server.ts:18-50` + the existing 501 stub at :52-54
**Apply to:** the new webhook route.
Pattern: build `ctx` inline from `getSupabase()` + `log.*` adapters; wrap handler body in `try/catch`; return `c.json({error}, status)` envelope on failure; `c.json({ok:true})` on success.

### Migration File Header
**Source:** every existing migration's leading comment block (e.g. master_layer.sql:1-11, role_views.sql:1-14)
**Apply to:** all three new migrations (`product_embeddings`, `hoy_views`, `wp_csv_profiles`).
Pattern: `-- Migration NNNN — <Name>. -- Phase 2 / Plan W.X.Y. -- -- <3-5 lines of purpose + invariants this file maintains>`.

### View security_invoker
**Source:** `packages/db/supabase/migrations/20260513000011_role_views.sql:20-21` (and every other view in that file)
**Apply to:** all 4 new `v_hoy_*` views.
Pattern: every `create view` clause includes `with (security_invoker = true)` BEFORE the `as select`. Invariant CC-12.

### Channel enum boundary
**Source:** `packages/db/supabase/migrations/20260513000002_enums.sql:15-25`, `observability.ts:36-45`
**Apply to:** every new WP sync entry-point.
Pattern: `cron-heartbeat` is in `connector_run_kind` ONLY (not `channel`). The WP cron jobs use `kind:"channel", canal:"wordpress"` — never `kind:"cron-heartbeat"`. Invariant W2.

### Server vs Browser Supabase Client
**Source:** `commit-upload.ts:25` (`createClient` from `@/lib/supabase/server`) vs RESEARCH §Code Examples live-feed.tsx (`createBrowserClient` from `@supabase/ssr`)
**Apply to:** every new dashboard file.
Pattern: Server Components + Server Actions → `@/lib/supabase/server`. Client Components needing Realtime → `@supabase/ssr` `createBrowserClient` with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (never `*_SERVICE_ROLE_KEY` in browser — invariant CC-11).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/connectors/src/matching/cascade.ts` + level files | service | transform+CRUD | Matching cascade is new infra in F2 (F1 has only `scripts/discovery/cascade.ts` outside the runtime); design from RESEARCH §Pattern 3 |
| `apps/dashboard/app/(app)/hoy/_components/live-feed.tsx` | client component | streaming (WS) | F1 has no Realtime client; design from RESEARCH §Code Examples |
| `apps/orchestrator/src/routes/webhooks-wordpress.ts` | controller | event-driven | F1 has only the 501 stub; design from RESEARCH §Pattern 1 — but Hono+ctx+error envelope from `server.ts` is the style guide |
| `packages/db/supabase/migrations/20260601000001_product_embeddings.sql` (pgvector + HNSW parts) | migration | DDL | F1 has no vector tables yet; table/index/FK style copied from master_layer.sql but the HNSW syntax has no analog |
| `packages/llm/` workspace package | package | — | Adapter exists in `scripts/discovery/llm-arbiter.ts`; the WORKSPACE PACKAGING is new — copy `packages/connectors/package.json` layout when creating |

---

## Invariants to preserve

These cross-phase invariants must NOT be broken by Phase 2. Every plan reviewer's checklist should grep for them.

- **W1 — `applyColumnMap` is CSV-only.** It lives in `packages/connectors/src/csv/column-map.ts` and is imported only inside `packages/connectors/src/csv/index.ts:38`. The WP REST normalization writes its OWN normalizer (`wordpress/normalize-order.ts`); it MAPS WC JSON shape → `NormalizedOrder` directly and does NOT go through `applyColumnMap`. Grep: `applyColumnMap` count outside `packages/connectors/src/csv/` must remain 0. (Source comment: csv/index.ts:7-19, commit-upload.ts:11-17.)
- **W2 — `cron-heartbeat` stays out of the `channel` enum.** It lives in `connector_run_kind` (enums.sql:60-62). The WP cron jobs (`sync-wp-orders`, `sync-wp-products`, `re-cascade-unmatched`, `reembed-products`) write `recordConnectorRun({ kind: "channel", canal: "wordpress", ... })`. Only the existing heartbeat (`apps/orchestrator/src/cron.ts:30-44`) uses `kind:"cron-heartbeat", canal:null`. Source enforcement: `observability.ts:36-45`.
- **W5 — `layout.tsx` reads role from `x-user-role` header, not `getUser()`.** `apps/dashboard/app/layout.tsx:30-32`. The middleware (`apps/dashboard/middleware.ts:1-13` → `@faka/auth/middleware`) sets this header on every request. New pages MUST read `headers().get("x-user-role")` (operacion/page.tsx:16 is the analog). Calling `supabase.auth.getUser()` from a page renders is a regression. Server Actions DO call `requireRole(supabase, ...)` because the action runs in a fresh request — both paths are correct in their context.
- **CC-11 — No `NEXT_PUBLIC_*SERVICE/SECRET/PRIVATE` envs.** Browser bundles must never reference service-role or webhook secrets. The Realtime live-feed (RESEARCH §Code Examples) reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` only. `WORDPRESS_API_SECRET` and `WORDPRESS_WEBHOOK_SECRET` are orchestrator-only.
- **CC-12 — Every new view declares `with (security_invoker = true)`.** All 4 `v_hoy_*` views in migration 20260601000002 MUST include this clause. Source: every view in `20260513000011_role_views.sql:20-178`. The view in role_views.sql:1-14 doc block is the authoritative warning. Grep: `create view` in the new file with NO `security_invoker` clause = block merge.
- **CC-13 — Storage payloads immutable.** WP CSV historical backfill goes through the same path as other CSV uploads (`commit-upload.ts:91-100`); the Storage bytes are written ONCE and never updated (reprocess re-downloads, see reprocess.ts:130-140). WP webhook payloads go to `raw_orders.payload_json` and `raw_events.payload_json` — also append-only. No `UPDATE raw_orders SET payload_json = ...` ever.
- **CC-14 — `messaging_log` stays empty in Phase 2.** That table (added by F1 for F5.5 WhatsApp Cloud API) gets no inserts from WP. The WP webhook handler must NOT route to `messaging_log` for any payload type; "order" topics go to `raw_orders`, anything else is logged/dropped.

---

## Metadata

**Analog search scope:** `/home/mandark/faka/packages/connectors/**`, `/home/mandark/faka/packages/db/supabase/migrations/**`, `/home/mandark/faka/packages/db/helpers/**`, `/home/mandark/faka/packages/auth/src/**`, `/home/mandark/faka/apps/orchestrator/src/**`, `/home/mandark/faka/apps/dashboard/app/**`, `/home/mandark/faka/scripts/discovery/llm-arbiter.ts`, `/home/mandark/faka/packages/db/supabase/seed.sql`
**Files Read in full:** 13 (csv/index.ts, server.ts, wordpress/index.ts, types.ts, idempotency.ts, observability.ts, audit.ts, llm-arbiter.ts, require-role.ts, three migrations, three dashboard pages, two Server Actions, layout, middleware, history-row-actions)
**Strong analogs found:** 9 of 10 phase-2 areas
**Pattern extraction date:** 2026-05-14
