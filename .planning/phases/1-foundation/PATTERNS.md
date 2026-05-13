# Phase 1: Foundation — Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** ~60 net-new files across `apps/` + `packages/` + `supabase/migrations/`
**Analogs found:** 6 / ~60 (greenfield project — most of Phase 1 is net-new by design)
**Read-only analysis:** No source files modified. This document is the only output.

---

## 0. TL;DR for the planner

Phase 0 produced **6 source artifacts** that constrain how Phase 1 is built:

| Existing artifact | What it gives F1 | F1 must… |
|---|---|---|
| `scripts/discovery/types.ts` | `CanonicalProduct`, `Channel`, `MatchMethod`, `MappingProfile`, `MatchResult`, `DiscoveryConfig` | **Elevate** these into `packages/schema` as the canonical Zod-validated shapes; production schema is a superset (adds DB ids, FKs, audit cols). Do NOT duplicate the types. |
| `scripts/discovery/llm-arbiter.ts` | Multi-provider env-driven resolver (`resolveLLMConfig`), dynamic-import per-provider adapter, JSON-mode prompt, cost estimator | **Reuse the resolver pattern verbatim** when F5 builds `packages/llm`. F1 does NOT need this yet (F1 has no IA features); document the contract so F5 doesn't re-derive. |
| `scripts/discovery/cascade.ts` + `normalize.ts` | 5-stage deterministic cascade algorithm + Spanish-aware `normalizeName`, `jaccard`, `normalizeBarcode` | Algorithm is **reference for F2**, not F1. F1 only creates the **tables** the cascade will populate (`master_products`, `product_mappings`). The Jaccard "embeddings proxy" stays in `scripts/discovery/` — production uses pgvector. |
| `scripts/discovery/load-csv.ts` | CSV → `CanonicalProduct[]` parser using `csv-parse/sync` + profile-driven `column_map` + `get`/`num` helpers | F1's `CSVConnector` in `packages/connectors/csv` follows the **same shape** (profile-driven, columnar map). Replace `csv-parse/sync` with streaming variant for >20MB files (deferred). The `get`/`num` value coercion helpers are directly portable. |
| `scripts/discovery/profiles/*.json` (5 files) | Pre-built mapping profiles for wp/ml/dropi/pos | **Seed data** for the `csv_mapping_profiles` table. The JSON shape `{channel, type, delimiter, column_map}` is the contract for the table's `column_map_json` column. Seeder migration inserts these rows verbatim. |
| `docs/sketches/csv-upload-wizard.html` | UX spec for the 3-step wizard + history table + reprocess action | F1's Next.js implementation in `apps/dashboard/app/(app)/operacion/upload/` must **match this flow** (step pills, dropzone, mapping table with auto-detected badges, dry-run summary, history table). The HTML is the design source of truth; Tailwind classes inform shadcn/ui composition. |

**Everything else in F1 is net-new.** There is no existing migration, no existing Next.js app, no existing Supabase config, no existing connector interface, no existing auth code, no existing RLS, no existing orchestrator.

---

## 1. Existing artifacts inventory

### 1.1 `scripts/discovery/` — Phase 0 TS scripts (will remain in place)

| File | Lines | Purpose | F1 fate |
|---|---:|---|---|
| `types.ts` | 79 | Canonical type definitions | **Elevate to `packages/schema`** (see §3.A) |
| `cascade.ts` | 99 | 5-stage deterministic matching cascade | **Stays in place**; F2 will reimplement as DB+pgvector |
| `normalize.ts` | 39 | `normalizeName`, `tokens`, `jaccard`, `normalizeBarcode`, `STOPWORDS` (es) | **Reused as reference**; helpers ported to `packages/schema/normalize.ts` or `packages/connectors/utils.ts` (TBD by planner). Production cascade in F2 imports these directly. |
| `llm-arbiter.ts` | 241 | Multi-provider LLM resolver + arbiter + cost estimator | **Reference for F5**; F1 doesn't need LLM. Document the resolver contract so F5 doesn't reinvent. |
| `load-csv.ts` | 95 | Profile-driven CSV loader (csv-parse/sync) | **Algorithm reused** in `packages/connectors/csv` — different I/O surface (Supabase Storage stream vs filesystem) but identical column-map semantics. |
| `match-explorer.ts` | 258 | CLI orchestrator for discovery report | Stays as Phase 0 tool. Not migrated. |
| `report.ts` | 85 | Markdown + JSON report writer | Stays as Phase 0 tool. Not migrated. |
| `package.json` | 29 | `@faka/discovery` workspace package, ESM, Node ≥22.7, deps on `csv-parse`, `ai`, `@ai-sdk/*`, `zod` | **Confirms pnpm workspace expectation** — F1's root `pnpm-workspace.yaml` adds `scripts/discovery` as an existing workspace. |
| `tsconfig.json` | 18 | ES2022 / ESNext / strict / `noUncheckedIndexedAccess` / `isolatedModules` | **Use as `packages/config/tsconfig.base.json` template** — exact same strictness flags. |
| `.env.example` | 62 | LLM provider env var documentation | **Source for `apps/orchestrator/.env.example`** LLM section in F5 (not F1). |
| `README.md` | 130 | Discovery tool docs | Stays. |
| `profiles/*.json` (5) | — | Per-channel mapping profile seeds | **Seeded into `csv_mapping_profiles` DB table** (see §3.E). |

### 1.2 `docs/` — Architectural contracts (read-only, no migration)

| File | Role in F1 |
|---|---|
| `PRD.md` (20KB) | Source of truth for the 5-layer schema (RAW/MASTER/FACTS/MARTS/INSIGHTS) — planner extracts table list from here |
| `AMENDMENT-csv-source.md` (ADR-001) | LOCKED schema for `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles`; CSVConnector contract |
| `ADR-002-role-matrix.md` | LOCKED role matrix → drives `*_view_admin`/`*_view_manager`/`*_view_analista` migrations |
| `ADR-003-whatsapp-strategy.md` | LOCKED → `messaging_log` empty table in F1; no WA Cloud API code |
| `ADR-004-mini-crm.md` | LOCKED → empty `customers`, `customer_external_links`, `customer_merge_log` tables in F1; `sales.customer_id` nullable from day one |
| `csv-templates/*.md` (5) | Per-channel column specs → inform `NormalizedProduct` and `NormalizedOrder` field sets in `packages/schema` |
| `sketches/csv-upload-wizard.html` (30KB) | **UX source of truth** for `apps/dashboard/app/(app)/operacion/upload/` — see §3.G excerpt |

### 1.3 `.planning/` — Planning artifacts (read-only)

`PROJECT.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `STATE.md`, `INGEST-CONFLICTS.md`, `intel/*.md`. Planner consumes these. **Do not modify from F1 implementation work.**

### 1.4 Root files

- `.gitignore` — already excludes `scratch/`, `node_modules/`, `.env`, `.next/`, `dist/`. F1 inherits.
- `skills-lock.json` — agent runtime, untouched.
- No `package.json` at root yet — F1 creates it.
- No `pnpm-workspace.yaml` yet — F1 creates it.
- No `turbo.json` yet — F1 creates it.

---

## 2. Project conventions established by Phase 0

These are **inferred contracts** the F1 implementation must respect to avoid drift:

| Convention | Source | F1 must… |
|---|---|---|
| TypeScript strict mode incl. `noUncheckedIndexedAccess` | `scripts/discovery/tsconfig.json:7` | Inherit identical strictness in `packages/config/tsconfig.base.json` |
| ESM modules (`"type": "module"`) | `scripts/discovery/package.json:5` | All packages use ESM; `.js` extensions in TS imports where needed |
| Node ≥22.7 | `scripts/discovery/package.json:13` | Engines field in root `package.json` matches |
| Zod for runtime validation | `scripts/discovery/package.json:22` (dep already present) | Reuse zod ^3.24 in `packages/schema` |
| Vercel AI SDK family (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`) | `scripts/discovery/package.json:17-21` | F5 uses the same; not pulled into F1 packages |
| Resolver pattern: CLI flag → `LLM_PROVIDER` env → autodetect by API-key presence | `llm-arbiter.ts:41-62` | F5 `packages/llm` re-uses verbatim |
| Channel enum: `wordpress \| mercadolibre \| dropi \| pos \| pos1 \| pos2 \| whatsapp` | `types.ts:1` | F1 schema migrations use this enum; **add `falabella`** per FND-04 (skeleton, disabled) |
| Match method taxonomy | `types.ts:20-29` | F1 `product_mappings` table has `match_method` column with this enum |
| Mapping profile JSON shape `{channel, type, delimiter?, column_map: Record<string,string>, defaults?}` | `profiles/_template.json` | F1 `csv_mapping_profiles.column_map_json` stores this exact shape; seeder reads the JSONs verbatim |
| Filename convention `<canal>-<tipo>-<YYYY-MM-DD>.csv` | `csv-templates/README.md:13` | Dashboard upload wizard validates against this pattern (warning, not block) |
| UTF-8, comma delimiter, ISO-8601 dates, `.` decimals, COP currency, empty cells (not `null`/`N/A`) | `csv-templates/README.md:5-12` | `CSVConnector` parser respects these defaults; mapping profile can override delimiter |
| Spanish stopword list for normalization | `normalize.ts:15-19` | F2 cascade reuses; F1 doesn't touch |
| Repo layout: `scratch/` for local-only data (gitignored) | `.gitignore:48` + discovery README | F1 keeps `scratch/` reserved for raw CSVs from clients during dev |

---

## 3. File-by-file mapping for Phase 1

Each table maps a proposed F1 file to its analog (or marks net-new). The **monorepo structure** below comes from `CONTEXT.md` §"Monorepo structure". Files are grouped by package to make planner partitioning straightforward.

### 3.A `packages/schema/` — Zod schemas (shared types)

**Role:** model / utility (validation). **Data flow:** transform.

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `packages/schema/src/canonical-product.ts` | **evolves `scripts/discovery/types.ts:3-18`** | `types.ts` | Take the `CanonicalProduct` shape verbatim; wrap in a zod schema; export `CanonicalProduct = z.infer<typeof CanonicalProductSchema>`. Add nullable `master_sku?`, `master_product_id?` (UUID) — DB-side identifiers not present in Phase 0. |
| `packages/schema/src/channel.ts` | **evolves `types.ts:1`** | `types.ts` | Add `falabella` to the union (FND-04 requires skeleton). Export as `z.enum([...])`. |
| `packages/schema/src/match-method.ts` | **evolves `types.ts:20-29`** | `types.ts` | Verbatim port of the 9 method names; this becomes the `match_method` Postgres enum + zod enum. |
| `packages/schema/src/mapping-profile.ts` | **evolves `types.ts:39-45` + `profiles/_template.json`** | both | `MappingProfile` schema with `channel`, `type ∈ {products, orders, order_items, inventory}` (extend the discovery `'products' \| 'orders' \| 'order_items'` to include `inventory` per CSV template README) and `column_map: Record<string,string>`. Production-mode adds `id: uuid`, `version: int`, `created_by: uuid`, `is_active: boolean`. |
| `packages/schema/src/normalized-order.ts` | **net-new, informed by `docs/csv-templates/*.md`** | wp/ml/dropi/pos/whatsapp templates | Union of all per-channel order columns → canonical `NormalizedOrder`. Fields: `external_order_id`, `canal`, `order_date`, `order_time?`, `customer_phone?`, `customer_email?`, `customer_name?`, `customer_doc?`, `status`, `subtotal`, `discount?`, `tax?`, `shipping_cost?`, `commission?`, `total`, `currency`, `payment_method?`, `delivery_method?`, `seller?` (WA), `products_text?` (WA fallback when no items rows), `raw_row: Record<string,unknown>`. |
| `packages/schema/src/normalized-order-item.ts` | **net-new, informed by `docs/csv-templates/*.md`** | all templates | `external_order_id`, `external_product_id`, `external_sku?`, `product_name`, `quantity`, `unit_price`, `unit_cost?`, `line_discount?`, `line_total`. |
| `packages/schema/src/normalized-product.ts` | **evolves `CanonicalProduct`** | `types.ts` | Same shape as canonical product but oriented toward what `ChannelConnector.normalizeProduct()` returns. Difference: nullable `external_id` allowed only for synthetic rows; mandatory `channel` + `name`; price/cost optional. |
| `packages/schema/src/customer-hint.ts` | **net-new, ADR-004 §"hooks"** | `ADR-004-mini-crm.md` + `CONTEXT.md` §"Specific Ideas" | New type referenced by `ChannelConnector.extractCustomerHint?(order): CustomerHint \| null`. Fields: `phone?`, `email?`, `document_id?`, `displayed_name?`, `source: 'order_payload' \| 'csv_row' \| 'manual'`. Empty stub for F1; F4 wires real logic. |
| `packages/schema/src/normalize.ts` | **evolves `scripts/discovery/normalize.ts`** | `normalize.ts` | Port `normalizeName`, `normalizeBarcode` (8+ digits rule) into the shared package so both `CSVConnector` and future F2 cascade share them. `jaccard` and `tokens`/`contentTokens` stay only if reused by F1; otherwise leave in `scripts/discovery/`. |
| `packages/schema/src/audit-event.ts` | **net-new, ADR-002 §"audit_log"** | `ADR-002:43` | Schema for audit_log rows: `user_id`, `role_at_time`, `action`, `target_table`, `target_id`, `payload_json`, `at`. |
| `packages/schema/src/index.ts` | **net-new** | barrel | Re-exports. |
| `packages/schema/package.json` | **net-new** | `scripts/discovery/package.json` template | Same ESM + Node 22.7 conventions; only deps: `zod ^3.24`. |
| `packages/schema/tsconfig.json` | **net-new** | `scripts/discovery/tsconfig.json` | Extends `packages/config/tsconfig.base.json`. |

**DO NOT copy:** the `DiscoveryConfig` and `DiscoveryReport` types from `types.ts:47-78` — those are CLI-tool concerns, not production schema. They stay in `scripts/discovery/`.

### 3.B `packages/db/` — Supabase migrations + generated types

**Role:** migration / model. **Data flow:** CRUD.

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `packages/db/supabase/config.toml` | **net-new** | Supabase docs | Standard `supabase init` output, edited to enable Auth + Storage. |
| `packages/db/supabase/migrations/0001_extensions.sql` | **net-new** | PRD §"capa MASTER" | `create extension pgcrypto`, `create extension pg_trgm` (for fuzzy match in F2), `create extension vector` (pgvector, ready for F2 embeddings). |
| `packages/db/supabase/migrations/0002_enums.sql` | **evolves `types.ts:1,20-29`** | `types.ts` | `create type channel as enum (...)` — copy `Channel` union; add `falabella`. `create type match_method as enum (...)` — copy `MatchMethod` verbatim. `create type csv_upload_status as enum ('uploaded','validating','processed','failed')` per `AMENDMENT-csv-source.md:42`. `create type user_role as enum ('super_admin','admin','manager','analista')` per ADR-002. |
| `packages/db/supabase/migrations/0003_raw_layer.sql` | **net-new, but `raw_csv_*` schema dictated by `AMENDMENT-csv-source.md:30-61`** | AMENDMENT | Create `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles`, `raw_orders`, `raw_products`, `raw_events`. The CSV tables' columns are **prescribed verbatim** in the amendment — do NOT redesign. `csv_mapping_profiles.column_map_json jsonb` stores the same shape as `scripts/discovery/profiles/*.json`. |
| `packages/db/supabase/migrations/0004_master_layer.sql` | **net-new, but `customers*` from ADR-004** | ADR-004 | `master_products` (PK uuid, name, brand?, category?, barcode?, supplier_code?, master_sku, attributes_json, created_at, updated_at). `product_mappings` (master_product_id FK, canal, external_id, external_sku?, match_method, score, validated_by?, validated_at?, created_at). `product_variants`, `master_categories`, `category_mappings`. **`customers`, `customer_external_links`, `customer_merge_log`** copied verbatim from ADR-004:17-42 (empty stubs). |
| `packages/db/supabase/migrations/0005_facts_layer.sql` | **net-new** | PRD §"capa FACTS" + ADR-004 | `sales` (PK uuid, canal, external_order_id, customer_id uuid NULL FK customers, ...), `sale_items` (sale_id FK, master_sku NULL FK master_products, master_product_id NULL, quantity, unit_price, unit_cost?, line_total), `inventory_snapshots`. **Idempotency unique constraint** `(canal, external_order_id)` per CONSTR-idempotency-key. |
| `packages/db/supabase/migrations/0006_marts_skeleton.sql` | **net-new** | PRD §"capa MARTS" | Empty mart tables / materialized views as defined in PRD — scaffolding only, populated in F2+. |
| `packages/db/supabase/migrations/0007_insights_layer.sql` | **net-new** | PRD §"capa INSIGHTS" + ADR-003 | `ai_insights`, `ai_conversations`. **`messaging_log`** empty per ADR-003 (cols: `id, direction, channel, recipient, template_name, payload_json, status, sent_at, error?`). |
| `packages/db/supabase/migrations/0008_observability.sql` | **net-new** | CONTEXT §"FND-08" + CONSTR-connector-observability + CONSTR-audit-log | `connector_runs` (id, canal, run_started_at, run_completed_at?, status enum, items_processed, items_failed, retry_count, dlq_payload_json?, error?). `audit_log` per ADR-002:43 schema (`user_id, role_at_time, action, target_table, target_id, payload_json, at`). |
| `packages/db/supabase/migrations/0009_rls_policies.sql` | **net-new** | ADR-002 §"row-level RLS" + CONSTR-rls-required | Enable RLS on every user-readable table; baseline policy "authenticated users may select if `auth.uid()` exists" — refined per-role in next migration. |
| `packages/db/supabase/migrations/0010_role_views.sql` | **net-new, but pattern from ADR-002:31-39** | ADR-002 + CONTEXT §"Vista pattern" | For each user-facing table that has $ or customer columns, create `<table>_view_admin`, `<table>_view_manager` (drops customer cols), `<table>_view_analista` (drops $ and customer cols). `SECURITY INVOKER` views. `GRANT SELECT ON <view> TO <role>`. Pattern excerpt below. |
| `packages/db/supabase/migrations/0011_auth_hook.sql` | **net-new** | Supabase Auth Hook docs + CONTEXT §"JWT custom claim" | Create the `custom_access_token` hook function that injects `role` claim into JWT, reading from a `user_roles` table populated by the seeder. |
| `packages/db/supabase/seeds/seed_mapping_profiles.sql` | **net-new, but data from `scripts/discovery/profiles/*.json`** | profiles | Insert one row per existing JSON file into `csv_mapping_profiles`. Use the JSON content verbatim for `column_map_json`. `version=1`, `is_active=true`. |
| `packages/db/supabase/seeds/seed_super_admin.ts` | **net-new** | ADR-002:47 + CONTEXT §"Seeders" | Node script (or supabase-cli function) that creates the auth user with email `nicolasperezmontoya@gmail.com`, assigns `role=super_admin` in `user_roles` table. Idempotent. |
| `packages/db/src/client.ts` | **net-new** | Supabase JS docs | `createServerClient` / `createBrowserClient` factories using `@supabase/ssr` for Next.js. |
| `packages/db/src/admin-client.ts` | **net-new** | Supabase docs | Service-role client for orchestrator (Railway only); reads `SUPABASE_SERVICE_ROLE_KEY` from env. |
| `packages/db/types/database.ts` | **generated, net-new** | `supabase gen types typescript` | Auto-generated post-migration; CI gate that it stays in sync. |
| `packages/db/package.json` | **net-new** | `scripts/discovery/package.json` template | Workspace package, deps: `@supabase/supabase-js`, `@supabase/ssr`. Dev: `supabase` CLI. |

**DO NOT recreate:** Mapping profile JSON shape — re-use the contract from `profiles/_template.json:5-21`. The seeder reads the existing JSON files literally; no re-typing of column names.

### 3.C `packages/connectors/` — `ChannelConnector` interface + skeletons + `CSVConnector`

**Role:** service. **Data flow:** transform + file-I/O (CSV) / request-response (future API connectors).

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `packages/connectors/src/types.ts` | **net-new, ADR-001 §"Conector CSV genérico" + CONTEXT §"ChannelConnector interface contract"** | `AMENDMENT-csv-source.md:65-72` + CONTEXT | Define `interface ChannelConnector` with methods: `name: string`, `type: 'csv' \| 'api' \| 'scraper' \| 'webhook'`, `fetchOrders(opts): AsyncIterable<NormalizedOrder>`, `fetchProducts(opts): AsyncIterable<NormalizedProduct>`, `fetchInventory?(opts)`, `normalizeOrder(raw): NormalizedOrder`, `normalizeProduct(raw): NormalizedProduct`, `healthCheck(): Promise<HealthStatus>`, **`extractCustomerHint?(order: NormalizedOrder): CustomerHint \| null`** (ADR-004 hook). Define `interface IngestResult { uploadId?: string; ordersInserted: number; productsInserted: number; rowsSkipped: number; errors: IngestError[] }`. |
| `packages/connectors/src/csv/index.ts` | **evolves `scripts/discovery/load-csv.ts`** | `load-csv.ts` | `class CSVConnector implements ChannelConnector` with `ingestUpload(uploadId: string): Promise<IngestResult>`. Reads `raw_csv_uploads` row → fetches blob from Storage → streams via csv-parse → applies linked `csv_mapping_profile.column_map_json` → emits `NormalizedOrder` / `NormalizedProduct` → inserts into `raw_orders` / `raw_products`. Algorithm mirrors `loadProductsCSV()` but with DB I/O instead of filesystem. |
| `packages/connectors/src/csv/parse-row.ts` | **evolves `scripts/discovery/load-csv.ts:27-39`** | `load-csv.ts` | Port the `get()` and `num()` helpers verbatim. Add `parseDate(value, format='iso')` for date columns per CSV template spec. |
| `packages/connectors/src/csv/dry-run.ts` | **net-new** | `docs/sketches/csv-upload-wizard.html:283-374` (Step 3 panel) | Validate a CSV against a mapping profile without persisting. Returns `{ rowsValid, rowsWarning, rowsError, errors: Array<{row,reason}>, projected: {newMasterSkus, autoMatches, llmCandidates, validationQueue} }`. The projections are estimated counts — F1 returns placeholders; F2 wires real cascade calls. |
| `packages/connectors/src/csv/auto-detect.ts` | **net-new** | `csv-upload-wizard.html:202-256` (Step 2 mapping table with "auto" badges) | Given first N rows + channel, suggest a column_map by fuzzy-matching headers against existing profile templates. Returns `{ field, sourceColumn, confidence: 'high' \| 'mid' \| 'none' }[]`. |
| `packages/connectors/src/skeletons/wordpress.ts` | **net-new (skeleton)** | `docs/csv-templates/wordpress.md` | `class WordPressConnector implements ChannelConnector` — all methods throw `NotImplementedError('F2')`. Imports the WP CSV template field set as a type. |
| `packages/connectors/src/skeletons/mercadolibre.ts` | **net-new (skeleton)** | `csv-templates/mercadolibre.md` | Same pattern. Throws `NotImplementedError('F4')`. |
| `packages/connectors/src/skeletons/dropi.ts` | **net-new (skeleton)** | `csv-templates/dropi.md` | Throws `NotImplementedError('F4')`. CSV fallback path delegates to `CSVConnector`. |
| `packages/connectors/src/skeletons/pos.ts` | **net-new (skeleton)** | `csv-templates/pos.md` | Throws `NotImplementedError('F3')`. |
| `packages/connectors/src/skeletons/whatsapp.ts` | **net-new (skeleton)** | `csv-templates/whatsapp.md` + ADR-003 | Throws `NotImplementedError('F3 for form, F5.5 for Cloud API')`. |
| `packages/connectors/src/skeletons/falabella.ts` | **net-new (skeleton, disabled per FND-04)** | FND-04 in REQUIREMENTS | Throws `NotImplementedError('F6')`; `healthCheck()` returns `{ status: 'disabled' }`. |
| `packages/connectors/src/idempotency.ts` | **net-new** | CONSTR-idempotency-key + REQUIREMENTS:25 | Helper `idempotencyKey(canal, externalOrderId): string` — used by orchestrator on insert. DB-side enforced by unique constraint in `sales` (migration 0005). |
| `packages/connectors/src/retry.ts` | **net-new** | CONSTR-retry-policy + CONTEXT §"FND-08" | `withRetry(fn, {maxAttempts: 3, backoff: 'exponential'})` + DLQ writer (writes failed payload to `connector_runs.dlq_payload_json`). |
| `packages/connectors/src/observability.ts` | **net-new** | CONSTR-connector-observability | Wrapper that writes a `connector_runs` row per `fetchOrders()` / `fetchProducts()` invocation: started/completed timestamps, item counts, retry count, error. |
| `packages/connectors/__tests__/csv.spec.ts` | **net-new** | — | Integration test: load fixture CSV → assert `raw_csv_uploads` + `raw_csv_rows` populated. **Fixtures reuse files from `scripts/discovery/profiles/*.json` + small CSVs in `__fixtures__/`.** |
| `packages/connectors/__tests__/interface.spec.ts` | **net-new** | — | Compile-time check that all 7 skeletons implement `ChannelConnector` (type-level test). |
| `packages/connectors/package.json` | **net-new** | `scripts/discovery/package.json` template | Deps: `csv-parse ^5.6` (same version as discovery), `@faka/schema`, `@faka/db`. |

**DO NOT copy:**
- The `loadChannel(inputDir, profilesDir, channel)` filesystem-walking pattern from `load-csv.ts:83-95` — production reads from Supabase Storage, not local dirs.
- The `Jaccard` proxy from `cascade.ts:69-86` — this is explicitly labeled "proxy for embeddings" in `scripts/discovery/README.md:122` and must NOT become production cascade logic. F2 will use pgvector + real embeddings.
- The hard-coded `CHANNELS_TO_LOAD` array from `match-explorer.ts:30` — production reads enabled channels from a config table or env.

### 3.D `packages/auth/` — Supabase Auth helpers + role middleware

**Role:** middleware / utility. **Data flow:** request-response.

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `packages/auth/src/middleware.ts` | **net-new** | Supabase SSR docs + CONTEXT §"JWT custom claim" + ADR-002 | Next.js middleware function that: (a) reads session cookie, (b) verifies JWT, (c) extracts `role` claim, (d) attaches to request context, (e) redirects unauthenticated to `/login`. |
| `packages/auth/src/require-role.ts` | **net-new** | ADR-002 matrix:14-28 | Higher-order helper `requireRole(['super_admin','admin'], handler)` for Server Actions and route handlers. Returns 403 if role not allowed. |
| `packages/auth/src/role-matrix.ts` | **net-new** | ADR-002:14-28 | TypeScript representation of the role-capability matrix (used by UI to hide/show buttons; **NOT** the security boundary — DB views are the boundary). Shape: `Record<Capability, UserRole[]>`. |
| `packages/auth/src/jwt-claims.ts` | **net-new** | Supabase Auth Hook docs | Type `JwtClaims = { sub, email, role: UserRole, exp, ... }`. Helper `parseClaims(token)`. |
| `packages/auth/src/sign-in.ts` | **net-new** | Supabase Auth docs + CONTEXT §"Auth flow" | Email + password only for v1. Server Action wrapper around `supabase.auth.signInWithPassword`. |
| `packages/auth/src/sign-out.ts` | **net-new** | Supabase docs | Trivial. |
| `packages/auth/__tests__/middleware.spec.ts` | **net-new** | — | Mock JWT scenarios per role. |
| `packages/auth/package.json` | **net-new** | template | Deps: `@supabase/ssr`, `@supabase/supabase-js`, `@faka/schema`. |

### 3.E `packages/ui/` — shadcn/ui components shared

**Role:** component. **Data flow:** transform (presentation).

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `packages/ui/src/components/stepper.tsx` | **net-new, design from `csv-upload-wizard.html:71-86`** | sketch | Re-create the `<ol>` with step pills (active/done/upcoming states). Use shadcn token colors instead of inline hex (`slate-900`, `green-600`, `slate-200` → CSS vars). |
| `packages/ui/src/components/dropzone.tsx` | **net-new, design from sketch:170-176** | sketch | Drag-and-drop file uploader. shadcn pattern. |
| `packages/ui/src/components/mapping-table.tsx` | **net-new, design from sketch:212-256** | sketch | Renders `[canonical_field] ← [source_column_select]` rows with auto/warn/manual badges. |
| `packages/ui/src/components/badge.tsx` | **shadcn primitive** | shadcn registry | Standard, with custom variants `ok`, `warn`, `err`, `info` matching sketch:21-24. |
| `packages/ui/src/components/data-table.tsx` | **shadcn primitive** | shadcn registry | Used by upload history table (sketch:400-460) and later phases. |
| `packages/ui/src/components/{button,select,toggle,card,table}.tsx` | **shadcn primitives** | shadcn registry | Standard install. |
| `packages/ui/styles/globals.css` | **net-new** | Tailwind + shadcn | Tailwind base + design tokens. |
| `packages/ui/package.json` | **net-new** | template | Deps: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tailwindcss`. Shadcn primitives copy-pasted (not a dependency). |

### 3.F `packages/config/` — Shared tsconfig, eslint, prettier

**Role:** config. **Data flow:** N/A.

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `packages/config/tsconfig.base.json` | **evolves `scripts/discovery/tsconfig.json`** | `tsconfig.json` | Same compiler options (ES2022, ESNext, strict, noUncheckedIndexedAccess, noImplicitOverride, esModuleInterop, skipLibCheck, resolveJsonModule, allowSyntheticDefaultImports, forceConsistentCasingInFileNames, isolatedModules). Other packages extend it. |
| `packages/config/tsconfig.nextjs.json` | **net-new** | Next.js docs | Extends base; adds `jsx: preserve`, `lib: [dom, dom.iterable, esnext]`, `incremental: true`. |
| `packages/config/eslint.base.cjs` | **net-new** | Next.js + TS lint preset | `@typescript-eslint/recommended-type-checked`, `eslint-config-next`, custom rule against `any`. |
| `packages/config/prettier.config.cjs` | **net-new** | preference | 2-space indent, no semicolons (or with — planner picks; Phase 0 doesn't constrain). |
| `packages/config/package.json` | **net-new** | template | Re-exports config files; no runtime code. |

### 3.G `apps/dashboard/` — Next.js 14 App Router dashboard (Vercel)

**Role:** route / component / provider. **Data flow:** request-response + file-I/O (upload).

The CSV upload wizard pages are the **largest concrete UI work in F1**. The HTML sketch is the design spec.

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `apps/dashboard/app/layout.tsx` | **net-new** | sketch:28-58 (app shell sidebar + topbar) | Root layout: sidebar (Hoy/Productos/Canales/Inteligencia/Operación), topbar with user email + avatar. Only "Operación" link active in F1; others render placeholders. |
| `apps/dashboard/app/(auth)/login/page.tsx` | **net-new** | Supabase auth docs | Email + password form. Uses `packages/auth/sign-in`. |
| `apps/dashboard/middleware.ts` | **net-new** | Next.js middleware docs + `packages/auth/middleware` | Wraps every `/app/*` route with auth check + role propagation. |
| `apps/dashboard/app/(app)/operacion/page.tsx` | **net-new** | sketch overall | Landing for "Operación" — entry to upload wizard + history. |
| `apps/dashboard/app/(app)/operacion/upload/page.tsx` | **net-new, design from sketch:58-374** | sketch | Wizard host. Wizard state lives in URL params per CONTEXT §"Wizard UI": `?step=1\|2\|3&upload=u_xyz&profile=p_abc`. |
| `apps/dashboard/app/(app)/operacion/upload/_components/step-source.tsx` | **net-new, design from sketch:88-162** | sketch | Step 1: channel grid + type radios + profile select. |
| `apps/dashboard/app/(app)/operacion/upload/_components/step-mapping.tsx` | **net-new, design from sketch:164-280** | sketch | Step 2: dropzone + preview table + mapping table + save-as-new-version toggle. |
| `apps/dashboard/app/(app)/operacion/upload/_components/step-validate.tsx` | **net-new, design from sketch:282-374** | sketch | Step 3: 3-stat header (valid/warning/error) + impact projection + error list + confirm button. |
| `apps/dashboard/app/(app)/operacion/upload/_actions/upload-csv.ts` | **net-new** | CONTEXT §"Wizard implementation" | Server Action receiving multipart. Streams to Supabase Storage; creates `raw_csv_uploads` row; inserts `raw_csv_rows`. Calls `CSVConnector.ingestUpload(uploadId)` (inline for F1; Edge Function deferred). |
| `apps/dashboard/app/(app)/operacion/upload/_actions/dry-run.ts` | **net-new** | sketch step 3 | Server Action that runs `CSVConnector.dryRun(uploadId, profileId)` and returns the projection JSON. |
| `apps/dashboard/app/(app)/operacion/upload/_actions/reprocess.ts` | **net-new** | FND-07 + sketch:417-460 | Re-runs `CSVConnector.ingestUpload(uploadId)` with a (possibly new) profile version. Writes `audit_log` entry. |
| `apps/dashboard/app/(app)/operacion/historial/page.tsx` | **net-new, design from sketch:393-460** | sketch | Server component listing `raw_csv_uploads` rows with status + reprocess actions. Uses `@faka/ui/data-table`. |
| `apps/dashboard/app/(app)/operacion/historial/_actions/list.ts` | **net-new** | — | Server action: `SELECT * FROM raw_csv_uploads ORDER BY uploaded_at DESC LIMIT 50`. Filtered by RLS based on role. |
| `apps/dashboard/lib/supabase/server.ts` | **net-new** | `@faka/db` + Supabase SSR | Re-exports `packages/db/client.createServerClient`. |
| `apps/dashboard/lib/supabase/browser.ts` | **net-new** | `@faka/db` | Re-exports browser client. |
| `apps/dashboard/app/api/health/route.ts` | **net-new** | — | `GET /api/health` returning `{ status: 'ok', migrations: 'in-sync' }`. Sanity for deploys. |
| `apps/dashboard/next.config.mjs` | **net-new** | Next.js docs | Standard; `transpilePackages: ['@faka/ui', '@faka/auth', '@faka/connectors', '@faka/schema', '@faka/db']`. |
| `apps/dashboard/tailwind.config.ts` | **net-new** | shadcn docs | Content paths include `packages/ui/**`. Tokens match sketch. |
| `apps/dashboard/package.json` | **net-new** | template | Deps: next ^14, react ^18, `@faka/*` workspace deps. |
| `apps/dashboard/tsconfig.json` | **net-new** | extends `packages/config/tsconfig.nextjs.json` | |

**Sketch excerpt for §3.G** (the source of truth — planner should reference these line ranges):

```html
<!-- csv-upload-wizard.html:71-86 — Stepper component spec -->
<ol class="flex items-center gap-3 mb-8 text-sm">
  <li class="flex items-center gap-2">
    <span class="step-pill w-7 h-7 rounded-full grid place-items-center text-xs font-bold"
          data-state="active" data-step="1">1</span>
    <span class="font-medium">Fuente</span>
  </li>
  <li class="text-slate-300">───────</li>
  <!-- steps 2, 3 ... -->
</ol>
```

```html
<!-- csv-upload-wizard.html:212-256 — Mapping table with auto-detect badges -->
<div class="grid grid-cols-12 gap-3 px-3 py-3 items-center text-sm">
  <div class="col-span-4 font-medium text-slate-700">external_id <span class="text-red-500">*</span></div>
  <div class="col-span-1 text-slate-400">←</div>
  <div class="col-span-5"><select ...><option>Item ID</option></select></div>
  <div class="col-span-2"><span class="badge-ok px-2 py-0.5 rounded-full text-xs">auto</span></div>
</div>
```

```html
<!-- csv-upload-wizard.html:393-460 — History table layout -->
<table class="w-full text-sm">
  <thead class="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
    <tr>
      <th>Cuándo</th><th>Canal</th><th>Tipo</th><th>Archivo</th>
      <th>Filas</th><th>Estado</th><th></th>
    </tr>
  </thead>
  <!-- rows with status badges + Reprocesar button -->
</table>
```

### 3.H `apps/orchestrator/` — Node/TS service (Railway)

**Role:** service / controller. **Data flow:** event-driven + batch.

For F1, the orchestrator is **mostly skeleton** — only the CSV ingestion path needs to actually run, and even that can be invoked synchronously from the dashboard Server Action. The orchestrator is the future home for scheduled connector runs (F2+).

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `apps/orchestrator/src/index.ts` | **net-new** | Node + Express/Fastify | HTTP entry. Endpoints: `POST /ingest/csv/:uploadId` (called from dashboard if we move ingest off-thread), `GET /healthz`. |
| `apps/orchestrator/src/scheduler.ts` | **net-new (skeleton)** | — | Cron-like scheduler for F2+. F1: empty class with `register(connector, intervalMs)` no-op. |
| `apps/orchestrator/src/registry.ts` | **net-new** | `packages/connectors/types` | Reads enabled connectors from env/config and instantiates them. F1: only `CSVConnector` is registered; skeletons listed but inactive. |
| `apps/orchestrator/src/queue.ts` | **net-new** | CONSTR-retry-policy | DLQ + retry wrapper. Wraps `packages/connectors/retry.ts` for orchestrator-level batch operations. |
| `apps/orchestrator/src/log.ts` | **net-new** | — | Structured JSON logger (pino or similar). Writes to stdout (Railway captures). |
| `apps/orchestrator/Dockerfile` | **net-new** | Railway docs | Multi-stage; final image runs `node dist/index.js`. |
| `apps/orchestrator/package.json` | **net-new** | template | Deps: `fastify` (or express), `@faka/*` workspace deps. |
| `apps/orchestrator/tsconfig.json` | **net-new** | extends `packages/config/tsconfig.base.json` | |
| `apps/orchestrator/.env.example` | **net-new, partly evolves `scripts/discovery/.env.example`** | discovery .env | Has DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL. **LLM section is empty in F1** (added in F5 mirroring `scripts/discovery/.env.example:16-58`). |

### 3.I Root files

| File | Status | Source / consults | Notes |
|---|---|---|---|
| `package.json` (root) | **net-new** | pnpm workspaces docs | `private: true`, scripts: `build`, `dev`, `lint`, `test`, `migrate`. Uses Turbo. |
| `pnpm-workspace.yaml` | **net-new** | pnpm docs | `packages: ['apps/*', 'packages/*', 'scripts/*']` — **includes the existing `scripts/discovery` package**. |
| `turbo.json` | **net-new** | Turbo docs | Pipelines for build/test/lint with cache + outputs. |
| `.npmrc` | **net-new** | pnpm | `node-linker=isolated`, `strict-peer-dependencies=true`. |
| `.nvmrc` | **net-new** | — | `22.7` (matches discovery package engines). |
| `README.md` (root) | **net-new** | — | Quickstart pointing to `scripts/discovery/README.md` for Phase 0 and to the dashboard for F1. |

---

## 4. Shared / cross-cutting patterns

### 4.A Authentication / RLS pattern
**Source:** `ADR-002-role-matrix.md` §2:31-39 (the implementation pattern) + Supabase Auth Hook docs.
**Apply to:** Every dashboard route + every orchestrator endpoint that mutates user-scoped data.

```sql
-- pattern for role-scoped view (illustrative; concrete tables in migration 0010)
create view sales_view_manager as
select sale_id, canal, external_order_id, order_date, status,
       subtotal, total, currency, payment_method   -- $ visible
       -- customer columns DROPPED
from sales;

grant select on sales_view_manager to authenticated;
-- combined with RLS on base table sales
```

```typescript
// pattern for Server Action gate (illustrative; consumed via packages/auth/require-role)
export const reprocessUpload = requireRole(['super_admin', 'admin', 'manager'],
  async (uploadId: string) => {
    // ... reprocess logic
  });
```

### 4.B Error handling pattern
**Source:** `scripts/discovery/llm-arbiter.ts:141-148` (graceful degradation pattern) + `match-explorer.ts:103-105` (channel-skip logging).
**Apply to:** Every connector method, every Server Action, every orchestrator handler.

```typescript
// excerpt from llm-arbiter.ts:141-147 — return error as a structured value, not throw
try { /* ... */ }
catch (err) {
  return {
    isMatch: false,
    confidence: 0,
    rationale: `LLM error (${cfg.provider}:${cfg.model}): ${(err as Error).message}`,
  };
}
```

F1 production pattern adapts this to: every `ChannelConnector` method returns `Result<T, IngestError>` — never throws — so the orchestrator can write a `connector_runs` row with the error payload and the DLQ can capture it.

### 4.C Validation pattern
**Source:** zod (already in `scripts/discovery/package.json:22`).
**Apply to:** Every Server Action input, every `/api/*` route handler, every CSV row before insertion.

```typescript
// pattern: schema-first validation at boundaries
import { NormalizedOrderSchema } from '@faka/schema';

const parsed = NormalizedOrderSchema.safeParse(input);
if (!parsed.success) return { ok: false, errors: parsed.error.flatten() };
// proceed with parsed.data (typed as NormalizedOrder)
```

### 4.D Profile-driven CSV ingestion pattern
**Source:** `scripts/discovery/load-csv.ts:41-81` — this exact algorithm is the reference; the F1 implementation in `packages/connectors/csv/index.ts` is a DB-aware reimplementation.

```typescript
// excerpt from scripts/discovery/load-csv.ts:54-79
const map = profile.column_map;
for (const row of rows) {
  const external_id = get(row, map.external_id);
  const name = get(row, map.name);
  if (!external_id || !name) continue;
  out.push({
    channel: profile.channel,
    external_id,
    sku: get(row, map.sku),
    name,
    // ...
    barcode: normalizeBarcode(get(row, map.barcode)),
    raw_row: row,
  });
}
```

F1 version differs only in: (a) iterates streamed rows from Supabase Storage instead of `readFileSync`; (b) inserts into `raw_csv_rows` instead of accumulating in memory; (c) profile loaded from `csv_mapping_profiles` table instead of filesystem JSON.

### 4.E Observability pattern (connector_runs)
**Source:** `match-explorer.ts:84,92,99-105,131,146,151,225-229` (pattern of logging structured progress).
**Apply to:** Every connector invocation in the orchestrator.

The discovery script logs to stdout. Production version writes a `connector_runs` row with structured metadata. The **shape of what to log** is the carryover:
- Channel name + run start/end timestamps
- Items processed / items skipped / items errored
- Final status (`ok` / `partial` / `failed`)
- Error payload on failure

---

## 5. Anti-duplication callouts — DO NOT recreate

These are existing decisions / artifacts that F1 must respect rather than re-derive. Each is a frequent failure mode for an agent that doesn't read Phase 0.

### 5.1 LLM adapter pattern
- **Reference:** `scripts/discovery/llm-arbiter.ts:1-241` (entire file).
- **F1 action:** None — F1 has no LLM features. `apps/orchestrator/.env.example` LLM block is added empty in F1, populated in F5.
- **F5 directive:** `packages/llm` MUST follow the same env-driven resolution order (`CLI > LLM_PROVIDER env > autodetect by API key`), the same `LLMProvider` enum (`gateway|anthropic|openai|google|moonshot|compatible|none`), the same default-model map, and the same dynamic-import-per-provider adapter strategy. Vercel AI Gateway is the recommended default per the existing `.env.example:27-30`.
- **DO NOT** reinvent provider resolution or write provider-specific top-level imports — the discovery script's structure is the canonical pattern.

### 5.2 `CanonicalProduct` type
- **Reference:** `scripts/discovery/types.ts:3-18`.
- **F1 action:** Move (don't copy) the shape into `packages/schema/src/canonical-product.ts` as a zod schema. The discovery script imports from `@faka/schema` thereafter so there's a single source of truth.
- **DO NOT** define a parallel `MasterProduct` type in `packages/db` with the same fields — the DB row type is **generated** by `supabase gen types`, and application code uses the zod schema from `@faka/schema` for in-memory representations.

### 5.3 Mapping profile JSON schema
- **Reference:** `scripts/discovery/profiles/_template.json:5-21` + `types.ts:39-45`.
- **F1 action:** Use the existing JSON shape verbatim for the `csv_mapping_profiles.column_map_json` column. Seeder reads `profiles/*.json` and inserts them directly. `packages/schema/src/mapping-profile.ts` wraps the same shape in zod.
- **DO NOT** propose a different column-map shape (e.g., array of `{from, to}` pairs). The discovery profiles already exist in production-shaped JSON.

### 5.4 Channel enum
- **Reference:** `scripts/discovery/types.ts:1`.
- **F1 action:** Add `'falabella'` to the union (FND-04 skeleton). Otherwise keep `wordpress | mercadolibre | dropi | pos | pos1 | pos2 | whatsapp`.
- **DO NOT** rename `pos1`/`pos2` or split them into a separate `pos_location` enum. Discovery treats them as channels for matching purposes; production keeps the same convention.

### 5.5 Cascade matching algorithm
- **Reference:** `scripts/discovery/cascade.ts:38-89` + `normalize.ts`.
- **F1 action:** **None.** F1 only creates `master_products`, `product_mappings`, the `match_method` enum, and the `validation_queue` table (if planner chooses to add it now). The algorithm itself is F2 work.
- **F2 directive:** Reimplement at the DB layer using pgvector for stage 5 (`embeddings_high`/`embeddings_mid`), and use the existing `normalize.ts` helpers for stages 1-4 deterministic matches. The Jaccard proxy in `cascade.ts` is **explicitly labeled a proxy** (see `README.md:122`) and must NOT become production logic.
- **DO NOT** port `cascade.ts` to F1.

### 5.6 Spanish-aware normalization helpers
- **Reference:** `scripts/discovery/normalize.ts:1-39`.
- **F1 action:** Port `normalizeName` and `normalizeBarcode` to `packages/schema/src/normalize.ts` (or `packages/connectors/utils.ts` — planner's call). Discovery script then imports from the shared location.
- **DO NOT** rewrite the regex chains or the stopword list. The Spanish stopwords (`el, la, los, ...pro, plus, premium...`) are tuned for the catalog domain.

### 5.7 Wizard UX
- **Reference:** `docs/sketches/csv-upload-wizard.html` (entire file).
- **F1 action:** Decompose the HTML into Next.js + shadcn components, matching the **3-step flow + history table + reprocess actions**. The HTML's Tailwind classes inform color tokens; replace inline `slate-900` etc. with shadcn theme vars.
- **DO NOT** redesign the wizard flow. Number of steps, step labels (Fuente / Mapeo de columnas / Validar y confirmar), the badges semantics (auto/68% vacío/auto…), and the impact-projection panel are fixed.

### 5.8 CSV template column specs
- **Reference:** `docs/csv-templates/{wordpress,mercadolibre,dropi,pos,whatsapp}.md`.
- **F1 action:** `NormalizedOrder` + `NormalizedOrderItem` + `NormalizedProduct` schemas in `packages/schema` MUST be a **superset union** of these per-channel field sets. Required fields per channel inform `.optional()` in zod.
- **DO NOT** invent additional channel-specific normalized types. One normalized type per kind (order/item/product) covers all channels via optional fields.

### 5.9 Idempotency key formula
- **Reference:** REQUIREMENTS.md FND-08 + CONSTR-idempotency-key + CONTEXT decision matrix.
- **F1 action:** `(canal, external_order_id)` unique constraint at the DB layer in `sales` migration. Application-layer helper in `packages/connectors/idempotency.ts` returns the same composite key for upsert use.
- **DO NOT** include `master_sku` or `order_date` in the idempotency key. Two different days with the same `external_order_id` = same row updated, not new row.

### 5.10 The `scratch/raw-csvs/` directory layout
- **Reference:** `scripts/discovery/README.md:14-28` + `.gitignore:48`.
- **F1 action:** Continue to treat `/scratch/` as gitignored local dev space. Production CSVs upload to Supabase Storage, never to `scratch/`.
- **DO NOT** check raw CSV files into the repo. They're sensitive customer data.

---

## 6. Net-new files with no analog

The bulk of F1 has no existing analog because the project is greenfield. These are files the planner must design from scratch using **canonical references** (PRD, ADRs, CONTEXT) rather than copying any existing code.

| Area | Files | Primary reference |
|---|---|---|
| Schema migrations | `0001`–`0011` (11 files) | PRD + 4 ADRs + REQUIREMENTS FND-02/03/08 |
| RLS + role views | `0009`, `0010` | ADR-002 §2 |
| Supabase Auth hook (custom claim) | `0011` | Supabase Auth Hooks docs + CONTEXT JWT decision |
| `ChannelConnector` interface | `packages/connectors/src/types.ts` | ADR-001 + CONTEXT contract spec + ADR-004 hook |
| Next.js 14 App Router shell | all `apps/dashboard/app/**` | sketch + Next docs |
| 3-step wizard implementation | `apps/dashboard/app/(app)/operacion/upload/**` | sketch (exact UI source) |
| Server Actions for upload / dry-run / reprocess | `apps/dashboard/app/(app)/operacion/upload/_actions/**` | FND-06, FND-07 + sketch step 3 |
| History table view | `apps/dashboard/app/(app)/operacion/historial/**` | sketch:393-460 |
| Orchestrator HTTP service skeleton | `apps/orchestrator/src/**` | FND-08 + Railway docs |
| Connector registry + scheduler stub | `apps/orchestrator/src/{registry,scheduler}.ts` | FND-04 |
| Retry + DLQ + observability helpers | `packages/connectors/{retry,observability}.ts` | CONSTR-retry-policy, CONSTR-connector-observability |
| Auth middleware + role gate | `packages/auth/src/{middleware,require-role}.ts` | ADR-002 + Supabase SSR docs |
| shadcn/ui components | `packages/ui/src/components/**` | shadcn registry + sketch |
| Monorepo plumbing | root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.nvmrc` | pnpm + Turbo docs |
| Integration tests | `packages/connectors/__tests__/csv.spec.ts` | FND-06 success criterion + CONTEXT testing |
| Seeder for Super Admin | `packages/db/supabase/seeds/seed_super_admin.ts` | ADR-002:47 |
| CI: `supabase db reset` validation | `.github/workflows/db.yml` (or similar) | CONTEXT testing |

For each row, planner consults the listed reference document(s) directly. **No existing file in the repo can serve as a code template** for any of the rows above (only the docs/contracts inform them).

---

## 7. Metadata

**Analog search scope:** `/home/mandark/faka/scripts/`, `/home/mandark/faka/docs/`, `/home/mandark/faka/.planning/`. The root has no other source directories yet.
**Files scanned:** 26 (all of `scripts/discovery/`, all 5 ADRs/AMENDMENT, PRD, all 5 CSV templates, the wizard sketch, CONTEXT.md, REQUIREMENTS.md excerpt).
**Files extracted as analogs:** 6 (types.ts, cascade.ts, normalize.ts, llm-arbiter.ts, load-csv.ts, tsconfig.json) + 5 mapping profile JSONs + 1 wizard sketch.
**Pattern extraction date:** 2026-05-13.
**Read-only constraint:** Honored. No source code modified. Only this file written.
