# Phase 1 Plan — Foundation

**Generated:** 2026-05-13
**Goal:** Stand up the full technical foundation — repo, Supabase 5-layer schema (incl. LOCKED CSV tables from ADR-001 + Mini-CRM stubs from ADR-004 + `messaging_log` stub from ADR-003), auth + RLS column-level (ADR-002 LOCKED 4-role matrix), Railway orchestrator skeleton, end-to-end CSV upload through the Operación-view wizard.
**Total estimated effort:** 88h (median of RESEARCH §"Complexity per Success Criterion" 76–96h range) / 22 days at 4h/day.
**Requirements covered:** FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08.
**Phase boundary:** see CONTEXT.md "Phase Boundary". Out-of-scope items enumerated at end of this file.

---

## Execution waves

```mermaid
graph TD
  W0[Wave 0: Monorepo bootstrap<br/>1.0.1 → 1.0.2 → 1.0.3]
  W1[Wave 1: DB schema + auth + RLS + types + seed<br/>1.1.1 → 1.1.2 → 1.1.3 ║ 1.1.4 → 1.1.5 → 1.1.6 → 1.1.7]
  W2[Wave 2: Connectors<br/>1.2.1 → ║ 1.2.2 (6 skeletons) ║ 1.2.3 (CSVConnector real) ║ → 1.2.4 (helpers) → 1.2.5 (tests)]
  W3[Wave 3: Dashboard<br/>1.3.1 → 1.3.2 → 1.3.3 → 1.3.4 → 1.3.5 → 1.3.6]
  W4[Wave 4: Orchestrator<br/>1.4.1 ║ 1.4.2 ║ 1.4.3 → 1.4.4a (infra-orch) → 1.4.4b (vercel+smoke)]
  W0 --> W1
  W0 --> W2
  W1 --> W2
  W1 --> W3
  W2 --> W3
  W1 --> W4
  W2 --> W4
```

| Wave | Plans | Parallelizable? | Hours subtotal |
|---|---|---|---|
| 0 — Monorepo bootstrap | 1.0.1–1.0.3 (serial) | No | ~8h |
| 1 — DB schema + auth | 1.1.1–1.1.7 | Migrations 1.1.1→1.1.4 are serial (layer order); 1.1.5/1.1.6/1.1.7 build on top | ~20h |
| 2 — Connectors | 1.2.1 (interface) → 1.2.2 (6 skeletons) ║ 1.2.3 (CSVConnector real) parallel after interface → 1.2.4 (helpers) → 1.2.5 (tests) | Yes between 1.2.2 and 1.2.3 (and inside 1.2.2 across the 6 skeleton files) | ~14h |
| 3 — Dashboard | 1.3.1 → 1.3.2 → 1.3.3 → 1.3.4 → 1.3.5 → 1.3.6 | Mostly serial (wizard steps share state) | ~28h |
| 4 — Orchestrator | 1.4.1 (Hono server) ║ 1.4.2 (cron) ║ 1.4.3 (retry+DLQ+observability helpers) → 1.4.4a (Railway/Docker infra) → 1.4.4b (Vercel link + smoke) | Yes between 1.4.1/1.4.2/1.4.3; 1.4.4a can ship in parallel with Wave 3 | ~14h |

Total: **88h** (within 76–96h range).

Cross-wave parallelism: once W0 closes, **W1 and W2 can run in parallel up to the point where W2's `CSVConnector` real impl (1.2.3) needs migrations 0003 + 0008** (raw_csv tables + connector_runs). Plan 1.2.3 is gated on Wave 1 completing migration 0003 + 0008 specifically (see depends_on annotations). W3 cannot start until W1 + W2 are both done. W4 cannot start until W1 (migrations) + W2's 1.2.1 (interface) are done. Plan 1.4.4a (Dockerfile + railway.toml + DEPLOY.md) can ship in parallel with Wave 3 once W4's 1.4.1 and 1.4.2 are done; 1.4.4b (Vercel link + smoke test) waits on Wave 3's 1.3.6.

---

## Wave 0 — Monorepo bootstrap

> Foundational tooling. No parallelism inside this wave (each task depends on the previous). All later waves depend on Wave 0 finishing.

### Plan 1.0.1 — pnpm workspaces + Turborepo + root config
- **Task:** Initialize root `package.json` with `pnpm-workspace.yaml` covering `apps/*`, `packages/*`, `scripts/discovery`; install `turbo` and `typescript` as root dev deps; create `turbo.json` with `build/lint/test/dev/db:types/db:migrate` pipelines per RESEARCH §1; create `.npmrc` (`node-linker=isolated`, `strict-peer-dependencies=true`), `.nvmrc` (`22.7`), root `tsconfig.json` extending `packages/config/tsconfig.base.json`. Enable Corepack and pin `pnpm@11.1.1`. Create `.env.example` at repo root per RESEARCH §10 with `SUPABASE_*`, `PORT`, `LOG_LEVEL`, channel placeholders, future LLM keys, and `INITIAL_SUPER_ADMIN_PASSWORD`. Update root `.gitignore` to add `.next/`, `dist/`, `.turbo/`, `node_modules/`, `.env`. Create `README.md` at root with quickstart + pointer to `scripts/discovery/README.md` for Phase 0.
- **Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.nvmrc`, `tsconfig.json`, `.env.example`, `.gitignore` (modify existing), `README.md`.
- **References:** RESEARCH §1 (pnpm + Turborepo skeleton), RESEARCH §10 (`.env.example` layout), PATTERNS §3.I (root files), PATTERNS §2 (Node ≥22.7 + ESM + strict TS conventions from `scripts/discovery/package.json`).
- **Anti-duplication note:** PATTERNS §1.3 — `scripts/discovery` is an existing workspace; `pnpm-workspace.yaml` MUST register it. Do NOT regenerate or move the existing discovery package.
- **Effort:** 3h
- **Verifies:** `pnpm install --frozen-lockfile` succeeds; `pnpm -r exec node -v` prints 22.7+; `pnpm turbo run build --dry=json` lists the configured pipelines without error; `pnpm --filter @faka/discovery run -- node -e 'process.exit(0)'` finds the existing discovery package; `grep -v '^#' .env.example | grep -c SUPABASE_SERVICE_ROLE_KEY` returns ≥1.
- **FND:** FND-01.

### Plan 1.0.2 — Shared TS / lint / prettier config package + base tsconfigs
- **Task:** Create `packages/config/` workspace exporting `tsconfig.base.json` (verbatim flags from RESEARCH §1: `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `skipLibCheck`, `esModuleInterop`, `resolveJsonModule`, `forceConsistentCasingInFileNames`, `incremental`, `declaration`, `lib: [ES2022, DOM]`), `tsconfig.nextjs.json` (adds `jsx: preserve`, `plugins: [{ name: "next" }]`), `eslint.base.cjs` (`@typescript-eslint/recommended-type-checked` + `eslint-config-next` + custom rule banning `any` + custom rule banning `NEXT_PUBLIC_*` env vars whose names contain `SERVICE|SECRET|PRIVATE` per RESEARCH §10 / Pitfall 5), and `prettier.config.cjs`. Add `vitest.config.ts` at repo root with workspace inheritance.
- **Files:** `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/tsconfig.nextjs.json`, `packages/config/eslint.base.cjs`, `packages/config/prettier.config.cjs`, `vitest.config.ts`.
- **References:** RESEARCH §1 (tsconfig snippet), RESEARCH §10 + Pitfall 5 (lint rule for `NEXT_PUBLIC_*` + service-role naming), PATTERNS §3.F (config package), PATTERNS §2 (strictness lineage from `scripts/discovery/tsconfig.json`).
- **Anti-duplication note:** PATTERNS §2 — exactly match the strictness flags already present in `scripts/discovery/tsconfig.json` (including `noUncheckedIndexedAccess` and `isolatedModules`). Do NOT loosen anything.
- **Effort:** 2h
- **Verifies:** `pnpm --filter @faka/config exec tsc -p tsconfig.base.json --noEmit --listFiles` succeeds; `pnpm exec eslint --print-config packages/config/eslint.base.cjs | grep -c '@typescript-eslint'` ≥ 1; `pnpm vitest --version` prints 4.x; running a deliberate test file with `process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` triggers the eslint custom rule (regex sanity-check the rule file: `grep -E 'SERVICE|SECRET|PRIVATE' packages/config/eslint.base.cjs`).
- **FND:** FND-01.

### Plan 1.0.3 — GitHub Actions CI skeleton + Supabase CLI installed in CI
- **Task:** Create `.github/workflows/ci.yml` with two jobs: (a) `lint-test` runs `pnpm install`, `pnpm -r run lint`, `pnpm -r run test` (no DB) on every push + PR; (b) `db-integration` uses `supabase/setup-cli@v1`, runs `supabase start`, `supabase db reset`, `pnpm --filter @faka/db run types`, asserts no diff with `git diff --exit-code packages/db/types/database.ts`, then `pnpm -r run test:integration` (configured in next waves), then `supabase stop`. Add GitHub Secrets schema (a `SECRETS.md` in `.github/` documenting required secrets: `SUPABASE_ACCESS_TOKEN` only — no project keys yet; staging projects added in 1.4.4b). The workflow MUST NOT call `supabase db push` from CI — only `db reset` against local stack (per RESEARCH §10 Open Question 1 — RESOLVED).
- **Files:** `.github/workflows/ci.yml`, `.github/SECRETS.md`.
- **References:** RESEARCH §2 (CI workflow essentials), RESEARCH §9 (testing strategy), RESEARCH §10 (no `db push` from CI ever).
- **Anti-duplication note:** Don't write a separate `lint.yml` and `test.yml` — single file with two jobs to keep status checks consolidated.
- **Effort:** 3h
- **Verifies:** `act -l` (if available, else manual GitHub UI on a draft PR) lists both jobs; the workflow file passes `yamllint`; `grep -c 'supabase db push' .github/workflows/ci.yml` returns 0 (the forbidden command is absent); a deliberately added trailing-whitespace lint violation on a feature branch turns the lint job red.
- **FND:** FND-01.

---

## Wave 1 — DB schema + auth + RLS + types generation + seed

> Builds the Supabase project skeleton, the 13 migrations covering every table from the 5 layers + ADR stubs, RLS + per-role SECURITY INVOKER views, the `custom_access_token` Auth Hook function, and the seeder for `csv_mapping_profiles` + initial Super Admin. Migrations are ordered to respect FK dependencies; per-layer migrations (1.1.1–1.1.4) must run sequentially because FACTS references MASTER (e.g., `sales.customer_id → customers.customer_id`) and MARTS references FACTS. Plans 1.1.5/1.1.6/1.1.7 layer atop after 1.1.4.
>
> **Migration numbering:** post-revision, the migration stream is contiguous (0001–0013). Migrations 0009/0010/0011/0012 were renumbered down by 2 (formerly 0011/0012/0013/0014); the original `cron-heartbeat` enum-extension migration (formerly 0016) was DROPPED — replaced by a `kind` column added inside migration 0008 (observability) per W2 fix. The additive `superseded_at` migration (formerly 0015) is now 0013.

### Plan 1.1.1 — Supabase project skeleton + extensions + enums + RAW layer (incl. CSV tables)
- **Task:** Initialize Supabase project in `packages/db/`. Create `packages/db/package.json` (per RESEARCH §2 — `name=@faka/db`, scripts `types`, `types:remote`, `db:reset`, `db:migrate`; deps `@supabase/supabase-js@2.105.4`, `@supabase/ssr@0.10.3`; devDep `supabase` CLI). Run `supabase init` to scaffold `supabase/config.toml` + `supabase/migrations/`. Enable Auth + Storage in `config.toml`. Create migration `20260513000001_init_extensions_and_schemas.sql` (`create extension pgcrypto`, `pg_trgm`, `vector`). Create migration `20260513000002_enums.sql` with `channel` enum (per PATTERNS §5.4 / `scripts/discovery/types.ts:1` — `wordpress | mercadolibre | dropi | pos | pos1 | pos2 | whatsapp | csv-upload | falabella`), `match_method` enum (verbatim 9 names from `scripts/discovery/types.ts:20-29`), `csv_upload_status` enum (`uploaded | validating | processed | failed` per AMENDMENT-csv-source.md), `user_role` enum (`super_admin | admin | manager | analista` per ADR-002), **and `connector_run_kind` enum (`channel | cron-heartbeat`)** (per W2 fix — kept separate from `channel` enum so the real-channel contract stays clean; consumed by `connector_runs.kind` in migration 0008). Create migration `20260513000003_raw_layer.sql` with `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles` (column shapes prescribed verbatim from `docs/AMENDMENT-csv-source.md:30-61`), plus `raw_orders`, `raw_products`, `raw_events`. Configure Supabase Storage bucket `csv-uploads` (private) in `config.toml`.
- **Files:** `packages/db/package.json`, `packages/db/supabase/config.toml`, `packages/db/supabase/migrations/20260513000001_init_extensions_and_schemas.sql`, `packages/db/supabase/migrations/20260513000002_enums.sql`, `packages/db/supabase/migrations/20260513000003_raw_layer.sql`, `packages/db/index.ts`.
- **References:** RESEARCH §2 (migration workflow + directory layout), PATTERNS §3.B (table-by-table inventory), PATTERNS §5.4 (channel enum + Falabella addition), `docs/AMENDMENT-csv-source.md:30-61` (raw_csv_* schema LOCKED).
- **Anti-duplication note:** PATTERNS §5.3 — `csv_mapping_profiles.column_map_json` MUST be a `jsonb` column accepting the **exact shape** of `scripts/discovery/profiles/_template.json:5-21`. Do NOT redesign the column-map shape into separate rows or different field names. PATTERNS §5.4 — the `channel` enum stays real-channels-only; non-channel run categories live in the separate `connector_run_kind` enum.
- **Effort:** 4h
- **Verifies:** `pnpm --filter @faka/db exec supabase start` succeeds (local Docker); `pnpm --filter @faka/db exec supabase db reset` applies all three migrations with zero errors; `psql $(pnpm --filter @faka/db exec supabase status -o env | grep DB_URL | cut -d= -f2-) -c "\d raw_csv_uploads"` shows the prescribed columns; `psql ... -c "select unnest(enum_range(null::channel))"` returns 9 channel values including `falabella` and `csv-upload` — and `cron-heartbeat` is NOT present; `psql ... -c "select unnest(enum_range(null::connector_run_kind))"` returns `channel` and `cron-heartbeat`; `pnpm --filter @faka/db run types` produces `packages/db/types/database.ts` and `git diff --exit-code packages/db/types/database.ts` is clean.
- **FND:** FND-02 (raw layer + CSV tables locked).

### Plan 1.1.2 — MASTER layer migration (incl. ADR-004 Mini-CRM stubs)
- **Task:** Create migration `20260513000004_master_layer.sql` defining `master_products` (PK `master_sku uuid`, `name`, `brand?`, `category?`, `barcode?`, `supplier_code?`, `attributes_json jsonb`, `created_at`, `updated_at`); `product_mappings` (`master_sku FK`, `canal channel`, `external_id text`, `external_sku?`, `match_method match_method`, `score numeric`, `validado_humano boolean default false`, `validated_by uuid? FK auth.users`, `validated_at timestamptz?`, `created_at`, unique constraint `(canal, external_id)`); `product_variants`, `master_categories` (jerárquica, parent_id self-FK), `category_mappings`. **ADR-004 LOCKED stubs (empty tables, no data, no logic):** `customers` (columns verbatim from `docs/ADR-004-mini-crm.md:17-31` — `customer_id`, `displayed_name`, `phone`, `email`, `document_id`, `first_purchase_at`, `last_purchase_at`, `total_purchases`, `total_spent`, `channels_purchased text[]`, `tags text[]`, `notes`, `created_at`, `updated_at`); `customer_external_links` (verbatim from `docs/ADR-004-mini-crm.md:32-39`); `customer_merge_log` (verbatim from `docs/ADR-004-mini-crm.md:40-42`). Add indexes for phone, email, document_id on `customers` (per ADR-004 matching cascade in F4).
- **Files:** `packages/db/supabase/migrations/20260513000004_master_layer.sql`.
- **References:** PATTERNS §3.B (master layer table list), `docs/ADR-004-mini-crm.md:17-42` (verbatim Mini-CRM schema), PRD §"capa MASTER", PATTERNS §5.5 (NO cascade logic — tables only).
- **Anti-duplication note:** PATTERNS §5.5 — DO NOT implement the matching cascade. F1 creates tables; the cascade (5 stages from `scripts/discovery/cascade.ts:38-89` + `normalize.ts`) is F2 work. PATTERNS §5.2 — DO NOT define a parallel `MasterProduct` TS type; that comes from `supabase gen types` in 1.1.7.
- **Effort:** 3h
- **Verifies:** `pnpm --filter @faka/db exec supabase db reset` applies migration 0004 clean; `psql ... -c "select count(*) from information_schema.columns where table_name='customers'"` returns 14 columns matching ADR-004; `psql ... -c "\d master_products"` shows `master_sku uuid` PK; `psql ... -c "select constraint_name from information_schema.table_constraints where table_name='product_mappings' and constraint_type='UNIQUE'"` returns the `(canal, external_id)` constraint.
- **FND:** FND-02.

### Plan 1.1.3 — FACTS layer (incl. idempotency unique constraint + customer_id FK)
- **Task:** Create migration `20260513000005_facts_layer.sql` with `sales` (PK `sale_id uuid`, `canal channel`, `external_order_id text`, `fecha date`, `hora time?`, `customer_id uuid? FK customers(customer_id)` per ADR-004 nullable from day one, `subtotal numeric(14,2)`, `descuento numeric(14,2)`, `total numeric(14,2)`, `costo_envio numeric(14,2)`, `moneda text default 'COP'`, `estado text`, `punto_venta_id text`, `created_at`, **`unique (canal, external_order_id)`** per CONSTR-idempotency-key / FND-08 / PATTERNS §5.9); `sale_items` (`sale_id FK`, `master_sku uuid? FK master_products` nullable, `quantity int`, `unit_price numeric`, `unit_cost numeric?`, `line_discount numeric?`, `line_total numeric`); `inventory_snapshots` (`master_sku FK`, `canal`, `cantidad`, `captured_at`). Add btree index on `(canal, fecha)` and `(customer_id)`.
- **Files:** `packages/db/supabase/migrations/20260513000005_facts_layer.sql`.
- **References:** RESEARCH §3 (sales table excerpt), PATTERNS §5.9 (idempotency = (canal, external_order_id) only — no master_sku or date), CONSTR-idempotency-key.
- **Anti-duplication note:** PATTERNS §5.9 — DO NOT include `master_sku` or `order_date` in the idempotency unique constraint. The composite is exactly `(canal, external_order_id)`.
- **Effort:** 2h
- **Verifies:** Migration applies clean; `psql ... -c "select pg_get_constraintdef(oid) from pg_constraint where conname like 'sales%key'"` shows `UNIQUE (canal, external_order_id)`; `psql ... -c "select column_name, is_nullable from information_schema.columns where table_name='sales' and column_name='customer_id'"` returns `YES` (nullable per ADR-004).
- **FND:** FND-02, FND-08 (idempotency DB constraint).

### Plan 1.1.4 — MARTS skeleton + INSIGHTS layer (incl. ADR-003 messaging_log) + observability tables
- **Task:** Three migrations.
  - `20260513000006_marts_skeleton.sql`: empty mart tables/views named per PRD §"capa MARTS" (`mart_top_products_by_window`, `mart_channel_performance`, `mart_product_velocity`, `mart_dead_stock`, `mart_days_of_inventory`, `mart_cannibalization`). Each is a `create table` with FK structure but zero rows (F2+ populates). Add `refreshed_at timestamptz` to each.
  - `20260513000007_insights_layer.sql`: `ai_insights` (id, type, severity, suggested_action, payload_json, created_at, dismissed_at?, dismissed_by?); `ai_conversations` (id, user_id FK auth.users, started_at, messages_json, ended_at?); **`messaging_log`** EMPTY table per ADR-003 LOCKED: cols `id uuid pk`, `direction text check (direction in ('inbound','outbound'))`, `channel text`, `recipient text`, `template_name text?`, `payload_json jsonb`, `status text`, `sent_at timestamptz?`, `error text?`, `created_at timestamptz default now()`.
  - `20260513000008_observability.sql`: `connector_runs` (`id uuid pk`, **`kind connector_run_kind not null default 'channel'`** per W2 fix — distinguishes real-channel runs from cron heartbeats; `canal channel null` (nullable: required when `kind='channel'`, NULL when `kind='cron-heartbeat'`; CHECK `(kind = 'channel' AND canal IS NOT NULL) OR (kind = 'cron-heartbeat' AND canal IS NULL)`), `started_at timestamptz`, `completed_at timestamptz?`, `status text check (status in ('succeeded','partial','failed','running'))`, `records_processed int default 0`, `records_failed int default 0`, `retry_count int default 0`, `errors_json jsonb?`, `duration_ms int?`); `audit_log` (verbatim from `docs/ADR-002-role-matrix.md:43`: `user_id uuid`, `role_at_time user_role`, `action text`, `target_table text`, `target_id text`, `payload_json jsonb`, `at timestamptz default now()`); `dead_letter_queue` (`id uuid pk`, `canal channel`, `payload_json jsonb`, `error text`, `attempts int`, `last_attempted_at timestamptz`, `created_at timestamptz`).
- **Files:** `packages/db/supabase/migrations/20260513000006_marts_skeleton.sql`, `packages/db/supabase/migrations/20260513000007_insights_layer.sql`, `packages/db/supabase/migrations/20260513000008_observability.sql`.
- **References:** PRD §"capa MARTS", ADR-003 (`messaging_log` empty + columns), ADR-002:43 (audit_log schema), PATTERNS §3.B (insights + observability), RESEARCH §7 (DLQ table-based).
- **Anti-duplication note:** ADR-003 — `messaging_log` is EMPTY in F1; do NOT populate, do NOT add seed rows. ADR-002:43 — `audit_log` columns are exact; do NOT add fields like `ip_address` or `user_agent` (defer to post-F4). W2 fix — `connector_runs.kind` column is the *only* place non-channel run categorization lives; do NOT add `cron-heartbeat` to the `channel` enum or to `scripts/discovery/types.ts` re-export.
- **Effort:** 3h
- **Verifies:** All three migrations apply; `psql ... -c "select count(*) from messaging_log"` returns 0; `psql ... -c "\d audit_log"` shows exactly 7 columns matching ADR-002:43; `psql ... -c "\d connector_runs"` shows status check constraint covering the 4 statuses AND the `kind` column referencing `connector_run_kind`; `psql ... -c "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'connector_runs'::regclass and contype = 'c'"` includes the kind/canal coherence CHECK.
- **FND:** FND-02, FND-08 (audit_log, connector_runs).

### Plan 1.1.5 — Profiles table + custom_access_token Auth Hook (ADR-002 JWT claim)
- **Task:** Create migration `20260513000009_profiles_and_role_hook.sql` (renumbered from 0011 to keep migration numbering contiguous per W8 fix) per RESEARCH §4 verbatim:
  - `create table public.profiles (user_id uuid pk references auth.users(id) on delete cascade, email text not null, role public.user_role not null default 'analista', display_name text?, created_at, updated_at)`.
  - RLS on `profiles`: `profiles_self_read` (`user_id = auth.uid()`); `profiles_admin_write` (super_admin via JWT claim).
  - `create or replace function public.custom_access_token_hook(event jsonb)` — exact body from RESEARCH §4 (reads `profiles.role`, defaults to `analista`, writes claim into both `claims.role` and `claims.app_metadata.role`).
  - **`grant execute on function public.custom_access_token_hook to supabase_auth_admin`** (per Pitfall 2 — without this, login fails cryptically).
  - `revoke execute ... from authenticated, anon, public`.
  - `grant select on public.profiles to supabase_auth_admin`.
  - Enable the hook in `supabase/config.toml`: `[auth.hook.custom_access_token] enabled = true; uri = "pg-functions://postgres/public/custom_access_token_hook"`.
- **Files:** `packages/db/supabase/migrations/20260513000009_profiles_and_role_hook.sql`, `packages/db/supabase/config.toml` (modify — enable hook).
- **References:** RESEARCH §4 (function body + GRANT pattern + config.toml hook block), `[VERIFIED: supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook]`, ADR-002 (4 roles + JWT claim propagation), RESEARCH Pitfall 2 (GRANT to supabase_auth_admin mandatory).
- **Anti-duplication note:** RESEARCH §4 — DO NOT store role in `auth.users.app_metadata` as the source of truth (rejected pattern). The hook copies from `public.profiles.role` into the JWT claim on every refresh.
- **Effort:** 3h
- **Verifies:** Migration applies; `psql ... -c "\df custom_access_token_hook"` shows function; `psql ... -c "select has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute')"` returns `t`; `psql ... -c "select has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute')"` returns `f`; `grep -c 'auth.hook.custom_access_token' packages/db/supabase/config.toml` ≥ 1.
- **FND:** FND-03 (Auth Hook + JWT claim).

### Plan 1.1.6 — Row-level RLS policies + per-role SECURITY INVOKER views + grants
- **Task:** Three migrations (renumbered from 0012/0013/0014 to 0010/0011/0012 per W8 fix).
  - `20260513000010_rls_policies.sql`: `alter table ... enable row level security` on every user-readable table (`sales`, `sale_items`, `inventory_snapshots`, `master_products`, `product_mappings`, `customers`, `customer_external_links`, `customer_merge_log`, `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles`, `ai_insights`, `ai_conversations`, `messaging_log`, `connector_runs`, `audit_log`). Baseline select policy `authenticated may select if auth.uid() is not null`. NO INSERT/UPDATE/DELETE policies for the `authenticated` role — mutations go through Server Actions running with Service Role. Add `current_role_claim()` SQL helper function per RESEARCH §3.
  - `20260513000011_role_views.sql`: For each table touched by ADR-002 column matrix — minimally `sales`, `sale_items`, `customers`, `customer_external_links`, `customer_merge_log` — create three views `<table>_view_admin`, `<table>_view_manager`, `<table>_view_analista`, each with **`with (security_invoker = true)`** (RESEARCH §3 + Pitfall 1 — mandatory). Column projection per ADR-002 matrix:
    - `_view_admin`: all columns.
    - `_view_manager`: drop customer columns (`customer_id → null::uuid`), keep $ columns.
    - `_view_analista`: drop customer AND $ columns (subtotal/descuento/total/costo_envio → null::numeric).
    - `customers_view_manager` and `customers_view_analista` should return zero rows (or all NULL identifying columns) — Manager and Analista cannot see the Mini-CRM per ADR-004:67-69.
  - `20260513000012_grants_on_views.sql`: `revoke all on <base_table> from anon, authenticated` for tables that have role views; `grant select on <view> to authenticated` for each role view. Document in a comment block at top of file that mutations always run with Service Role from Server Actions (RLS bypass by definition).
- **Files:** `packages/db/supabase/migrations/20260513000010_rls_policies.sql`, `packages/db/supabase/migrations/20260513000011_role_views.sql`, `packages/db/supabase/migrations/20260513000012_grants_on_views.sql`.
- **References:** RESEARCH §3 (full view + RLS + grants SQL), ADR-002:31-39 (view pattern), ADR-002 matrix (column visibility per role), ADR-004:65-69 (customers hidden from Manager/Analista), RESEARCH Pitfall 1 (`security_invoker = true` MANDATORY).
- **Anti-duplication note:** RESEARCH Pitfall 1 — every `create view` MUST include `with (security_invoker = true)`. Lint this in the verify step: `grep -c 'security_invoker' packages/db/supabase/migrations/20260513000011_role_views.sql` must equal the count of `create view`s in that file. DO NOT use SECURITY DEFINER.
- **Effort:** 4h
- **Verifies:** All three migrations apply; lint passes: `grep -c 'create view' packages/db/supabase/migrations/20260513000011_role_views.sql` equals `grep -c 'security_invoker = true' packages/db/supabase/migrations/20260513000011_role_views.sql`; `psql ... -c "select count(*) from pg_views where viewname like '%_view_analista'"` returns ≥ 5 (sales + sale_items + customers + customer_external_links + customer_merge_log); `psql ... -c "select has_table_privilege('authenticated', 'public.sales', 'SELECT')"` returns `f` (base table revoked); `psql ... -c "select has_table_privilege('authenticated', 'public.sales_view_analista', 'SELECT')"` returns `t`.
- **FND:** FND-03 (RLS + column-level views).

### Plan 1.1.7 — Seed mapping profiles + Super Admin CLI seeder + type generation gate
- **Task:** Two artifacts.
  - `packages/db/supabase/seed.sql`: For each existing `scripts/discovery/profiles/*.json` (wordpress, mercadolibre, dropi, pos), `insert into csv_mapping_profiles (id, nombre, canal, tipo, column_map_json, version, is_active, creado_por)` reading the JSON content verbatim via heredoc per RESEARCH §2 seeding snippet. All inserts MUST be idempotent (`on conflict do nothing`) so `supabase db reset` can rerun safely. Add a placeholder row for WhatsApp products even though no JSON exists yet (mark `is_active=false`).
  - `packages/db/scripts/seed-super-admin.ts`: Standalone TS Node script per RESEARCH §2 snippet — creates auth user `nicolasperezmontoya@gmail.com` via `supabase.auth.admin.createUser({ email_confirm: true })`, password from `INITIAL_SUPER_ADMIN_PASSWORD` env, then upserts `profiles` row with `role='super_admin'`. Idempotent: if user exists, only upsert profile. Add `pnpm seed:super-admin` script in `packages/db/package.json`.
  - Add `db:types:check` script that runs `supabase gen types typescript --local > types/database.ts` and `git diff --exit-code types/database.ts` — CI uses this as a gate.
- **Files:** `packages/db/supabase/seed.sql`, `packages/db/scripts/seed-super-admin.ts`, `packages/db/package.json` (modify — add scripts), `packages/db/types/database.ts` (generated; commit the result).
- **References:** RESEARCH §2 (seeding pattern + Super Admin script), ADR-002:47 (Super Admin email locked), PATTERNS §3.B / §5.3 (profiles JSON shape is the contract).
- **Anti-duplication note:** PATTERNS §5.3 — read `scripts/discovery/profiles/*.json` files literally (e.g., via shell heredoc that inlines the JSON content into the SQL `$$...$$::jsonb` literal). DO NOT retype the column_map shape. PATTERNS §1.4 — the seeder hard-coding `nicolasperezmontoya@gmail.com` matches ADR-002:47 verbatim.
- **Effort:** 3h
- **Verifies:** `pnpm --filter @faka/db exec supabase db reset` runs seed without error; `psql ... -c "select count(*) from csv_mapping_profiles where is_active=true"` returns ≥ 4; rerunning `db reset` produces identical row count (idempotency); `INITIAL_SUPER_ADMIN_PASSWORD=test1234! pnpm --filter @faka/db run seed:super-admin` creates the user and exits 0; rerunning the seeder exits 0 with no duplicate (idempotent); `psql ... -c "select role from profiles where email='nicolasperezmontoya@gmail.com'"` returns `super_admin`; `pnpm --filter @faka/db run db:types:check` exits clean.
- **FND:** FND-02 (seeded profiles), FND-03 (Super Admin created).

---

## Wave 2 — Connectors

> Builds `packages/connectors`: the `ChannelConnector` interface, 6 skeletons that throw `NotImplementedError`, the **real** `CSVConnector` implementation, and the cross-cutting helpers (idempotency, retry+DLQ, observability). Plan 1.2.1 (interface + schema) must finish before 1.2.2 and 1.2.3 can start; 1.2.2 (6 skeletons) and 1.2.3 (CSVConnector real impl) run in parallel after the interface. 1.2.3 (CSVConnector real impl) additionally depends on Wave 1 migrations 0003 + 0008 (raw_csv tables + connector_runs). 1.2.4 (helpers) follows 1.2.1 and depends on Wave 1 migrations 0005 + 0008. 1.2.5 (tests) follows 1.2.1–1.2.4 and Wave 1 completion.

### Plan 1.2.1 — `packages/schema` Zod contracts + `packages/connectors` interface + types
- **Task:** Create `packages/schema/`:
  - `src/channel.ts` — `z.enum(['wordpress','mercadolibre','dropi','pos','pos1','pos2','whatsapp','csv-upload','falabella'])`. Elevated from `scripts/discovery/types.ts:1` + `falabella` added per FND-04. **DO NOT include `cron-heartbeat`** — that lives in the separate `connector_run_kind` enum (W2 fix).
  - `src/connector-run-kind.ts` — `z.enum(['channel','cron-heartbeat'])`. Mirrors the DB enum from migration 0002. Consumed by `connector_runs.kind` writes.
  - `src/match-method.ts` — verbatim port of `scripts/discovery/types.ts:20-29` as zod enum.
  - `src/canonical-product.ts` — zod schema from `scripts/discovery/types.ts:3-18`; export `CanonicalProduct = z.infer<...>`. Add nullable `master_sku?: string` (DB UUID).
  - `src/mapping-profile.ts` — `{ channel, type: z.enum(['products','orders','order_items','inventory']), delimiter?, column_map: z.record(z.string(), z.string()), defaults? }` plus production fields `id, version, created_by, is_active`. Matches `scripts/discovery/profiles/_template.json` shape (PATTERNS §5.3).
  - `src/normalized-order.ts`, `src/normalized-order-item.ts`, `src/normalized-product.ts` — superset unions of the 5 CSV templates' fields (PATTERNS §5.8).
  - `src/customer-hint.ts` — `{ phone?, email?, document_id?, external_customer_id?, external_identifier_type?: z.enum(['phone','email','document','nickname']), displayed_name?, source: z.enum(['order_payload','csv_row','manual']) }` per ADR-004 hooks.
  - `src/audit-event.ts` — zod for `audit_log` row shape (verbatim ADR-002:43).
  - `src/normalize.ts` — port `normalizeName` and `normalizeBarcode` verbatim from `scripts/discovery/normalize.ts:1-39` (PATTERNS §5.6 — keep Spanish stopword list intact).
  - `src/index.ts` — barrel.
  - `package.json` (deps: `zod@4.4.3`), `tsconfig.json` (extends config base).
- Create `packages/connectors/`:
  - `src/types.ts` — verbatim from RESEARCH §5: `Canal`, `Capability`, `RawOrder`, `RawProduct`, `RawInventory`, `CustomerHint`, `HealthStatus`, **`interface ChannelConnector`** with `extractCustomerHint?(raw): CustomerHint | null` (ADR-004 hook), `ConnectorContext`, `ConnectorFactory<TConfig>`.
  - `src/index.ts` — re-exports.
  - `package.json` (deps: `@faka/schema` workspace ref, `@supabase/supabase-js`, `csv-parse@6.2.1`, `p-retry@7`), `tsconfig.json`.
- **Files:** `packages/schema/**` (11 source files + `package.json` + `tsconfig.json`), `packages/connectors/src/types.ts`, `packages/connectors/src/index.ts`, `packages/connectors/package.json`, `packages/connectors/tsconfig.json`.
- **References:** RESEARCH §5 (interface verbatim), PATTERNS §3.A (file-by-file schema map), PATTERNS §5.2 (elevate `CanonicalProduct`), PATTERNS §5.4 (channel enum + falabella), PATTERNS §5.6 (Spanish normalize helpers — don't rewrite), PATTERNS §5.8 (one NormalizedOrder per kind, optional fields per channel).
- **Anti-duplication note:** PATTERNS §5.2 — MOVE (don't copy) `CanonicalProduct` shape from `scripts/discovery/types.ts`; downstream `scripts/discovery/` then imports from `@faka/schema`. Update `scripts/discovery/types.ts` to re-export from `@faka/schema`. PATTERNS §5.6 — port `normalize.ts` helpers verbatim, do NOT rewrite the regex chains or stopword list. PATTERNS §5.4 (W2 fix) — `channel` Zod enum stays real-channels-only; `cron-heartbeat` lives in `connector-run-kind.ts`, so `scripts/discovery/types.ts` re-export never gains a sentinel value.
- **Effort:** 4h
- **Verifies:** `pnpm --filter @faka/schema exec tsc --noEmit` passes; `pnpm --filter @faka/connectors exec tsc --noEmit` passes; `pnpm vitest run packages/schema/__tests__/zod-roundtrip.test.ts` confirms a sample CanonicalProduct passes the schema; `grep -c 'extractCustomerHint' packages/connectors/src/types.ts` ≥ 1 (ADR-004 hook present); `grep -c 'security_invoker' packages/connectors/src/types.ts` returns 0 (not a DB concern); `grep -c "'cron-heartbeat'" packages/schema/src/channel.ts` returns 0 (W2 invariant — must NOT be in channel enum); `grep -c "'cron-heartbeat'" packages/schema/src/connector-run-kind.ts` returns ≥1; `pnpm --filter @faka/discovery exec tsc --noEmit` still passes after the type re-export change.
- **FND:** FND-04 (ChannelConnector interface published).

### Plan 1.2.2 — 6 channel skeletons (WP, ML, Dropi, POS, WhatsApp, Falabella)
- **Task:** Create six skeleton files in `packages/connectors/src/` per RESEARCH §5 skeleton pattern. Each is ~30 lines: imports `ChannelConnector, ConnectorContext, ConnectorFactory` from `../types`; exports `create<Channel>Connector: ConnectorFactory<{ ... }>` returning a connector whose `fetchOrders/fetchProducts/normalizeOrder/normalizeProduct` throw `NOT_IMPLEMENTED_F<N>` with the right phase tag, and whose `healthCheck` returns `{ ok: false, last_error: 'not configured (F1 skeleton)' }`. Specifics:
  - `wordpress/index.ts` — config `{ baseUrl, apiKey }`, throws `NOT_IMPLEMENTED_F2`.
  - `mercadolibre/index.ts` — config `{ clientId, clientSecret }`, throws `NOT_IMPLEMENTED_F4`.
  - `dropi/index.ts` — config `{ username, password }`, throws `NOT_IMPLEMENTED_F4`. Comment: CSV fallback delegates to CSVConnector.
  - `pos/index.ts` — config `{ webhookSecret }`, throws `NOT_IMPLEMENTED_F3`.
  - `whatsapp/index.ts` — config `{}`, throws `NOT_IMPLEMENTED_F3` (internal form) / `F5.5` (WA Cloud API). Per ADR-003.
  - `falabella/index.ts` — config `{}`, throws `NOT_IMPLEMENTED_F6`. `healthCheck` returns `{ ok: false, last_error: 'disabled (feature flag off)' }` per FND-04.
- This plan can be parallelized across the 6 skeleton files since they share no state. A single executor can fan-out 6 commits; in a multi-agent setup each connector is its own commit.
- **Files:** `packages/connectors/src/wordpress/index.ts`, `packages/connectors/src/mercadolibre/index.ts`, `packages/connectors/src/dropi/index.ts`, `packages/connectors/src/pos/index.ts`, `packages/connectors/src/whatsapp/index.ts`, `packages/connectors/src/falabella/index.ts`.
- **Depends on:** 1.2.1 (interface + schema). Can run in parallel with 1.2.3.
- **References:** RESEARCH §5 (skeleton pattern + 6 channels), PATTERNS §3.C (per-skeleton notes), CONTEXT.md (ADR-003 for WhatsApp, FND-04 for Falabella disabled).
- **Anti-duplication note:** Each skeleton's `fetchOrders/normalizeOrder` body is `throw new Error('NOT_IMPLEMENTED_F<N>')`. DO NOT scaffold partial implementations or imagine channel-specific logic. Real impls land in their named phases.
- **Effort:** 3h (parallelizable)
- **Verifies:** `pnpm --filter @faka/connectors exec tsc --noEmit` passes (all 6 implement `ChannelConnector`); `grep -rc 'NOT_IMPLEMENTED_F' packages/connectors/src/ | awk -F: '{s+=$2} END {print s}'` returns ≥ 24 (4 methods × 6 skeletons minimum); a deliberate test that calls each skeleton's `healthCheck()` returns `ok: false`.
- **FND:** FND-04 (skeletons compile against interface).

### Plan 1.2.3 — `CSVConnector` real implementation (the F1 acceptance gate connector)
- **Task:** Create `packages/connectors/src/csv/index.ts` with `createCSVConnector: ConnectorFactory<CSVConnectorConfig>` returning a `CSVConnector extends ChannelConnector` with:
  - `name: 'csv-upload'`, `type: 'manual'`, `capabilities: new Set(['orders','products','inventory'])`.
  - `ingestUpload(uploadId: string): Promise<IngestResult>` — **normalization layer** (W1 fix — this is the row→Normalized conversion engine; the workflow that uploads bytes + writes raw_csv_rows is owned by 1.3.5's `commitUpload` Server Action; ingestUpload reads pre-persisted raw rows and turns them into facts/master rows). Full body per RESEARCH §5 skeleton expanded:
    1. Load `raw_csv_uploads` row + linked `csv_mapping_profiles` row via Supabase.
    2. Set `status = 'validating'`.
    3. Stream rows from `raw_csv_rows` for this upload in chunks of 500. **Contract:** `raw_csv_rows.payload_json` is the RAW row (`Record<string,string>` — pre-validation; 1.3.5 writes this as-is from the parsed CSV).
    4. For each row: apply `column_map_json` using `applyColumnMap()` helper → produce `NormalizedOrder` OR `NormalizedProduct` based on `upload.tipo` → validate with Zod schema → if valid, accumulate for downstream insert; if invalid, append to `errors[]`. **This is the ONLY place column-map application + Zod validation runs** (W1 fix — `commitUpload` no longer validates).
    5. UPSERT normalized rows into `sales` / `sale_items` (for orders) or `master_products` / `product_mappings` (for products) using `(canal, external_order_id)` or `(canal, external_id)` ON CONFLICT clauses. F1 inserts via raw `supabase.from(...).upsert(...)`; the matching cascade (F2) will reassign `master_sku` later.
    6. Update `raw_csv_rows.processed = true` per batch.
    7. Update `raw_csv_uploads.status = 'processed'`, `row_count`, `error_log_json`.
    8. Return `{ upload_id, rows_processed, rows_skipped, errors }`.
  - `fetchOrders/fetchProducts` — return `[]` (CSV is push-style, see RESEARCH §5).
  - `normalizeOrder/normalizeProduct` — call `applyColumnMap` against the mapping profile + Zod parse. Used by `ingestUpload`.
  - `extractCustomerHint(raw): CustomerHint | null` — basic implementation: pull `phone/email/document` from `raw.payload` if columns exist in mapping profile; else null. Sets `source: 'csv_row'`.
  - `healthCheck() → { ok: true }`.
- Create `packages/connectors/src/csv/column-map.ts` — `applyColumnMap(row: Record<string,string>, profile: MappingProfile): Record<string, unknown>` using `get()` and `num()` helpers ported verbatim from `scripts/discovery/load-csv.ts:27-39` (PATTERNS §5 / load-csv reuse). **This module is the SINGLE owner of column-map application** (W1 fix — 1.3.5 calls into 1.2.3's `ingestUpload` which calls `applyColumnMap`; `commitUpload` does NOT invoke `applyColumnMap` directly).
- Create `packages/connectors/src/csv/dry-run.ts` — `dryRun(uploadId, profileId): { rowsValid, rowsWarning, rowsError, errors, projected: { newMasterSkus, autoMatches, llmCandidates, validationQueue } }`. For F1 the `projected.*` fields are placeholder zeros (F2 wires real cascade calls per PATTERNS §3.C). Internally also uses `applyColumnMap` to predict valid/error counts without writing.
- Create `packages/connectors/src/csv/auto-detect.ts` — `autoDetect(firstRows, channel): Array<{ field, sourceColumn, confidence: 'high'|'mid'|'none' }>` — fuzzy header matching against existing profiles in `csv_mapping_profiles` table for the channel.
- **Files:** `packages/connectors/src/csv/index.ts`, `packages/connectors/src/csv/column-map.ts`, `packages/connectors/src/csv/dry-run.ts`, `packages/connectors/src/csv/auto-detect.ts`.
- **Depends on:** 1.2.1 (interface + schema) + Wave 1 migrations 0003 (raw_csv_*) + 0008 (connector_runs). Can run in parallel with 1.2.2.
- **References:** RESEARCH §5 (CSVConnector skeleton), RESEARCH §6 (commitUpload algorithm — flows into ingestUpload), PATTERNS §3.C (csv subdir files), PATTERNS §4.D (load-csv algorithm reused), `scripts/discovery/load-csv.ts:41-81` (algorithm).
- **Anti-duplication note (W1 — boundary with 1.3.5):** This plan owns the **normalization layer** (raw row + mapping_profile → NormalizedProduct/NormalizedOrder, Zod validation, UPSERT to facts/master). It is called by the Server Action in 1.3.5. The Server Action in 1.3.5 owns the **workflow** (file upload → write storage → parse CSV bytes → write raw_csv_rows as raw payload → call CSVConnector.ingestUpload). `raw_csv_rows.payload_json` is the raw `Record<string,string>` row (no transformations applied at write time); `applyColumnMap` + Zod parse happen ONLY inside `ingestUpload`. PATTERNS §5 cluster — DO NOT copy the `loadChannel(inputDir, profilesDir, channel)` filesystem walker from `load-csv.ts:83-95`; production reads from Supabase Storage + `raw_csv_rows`, not local files. The `get()` and `num()` helpers ARE ported verbatim. DO NOT port the Jaccard match logic from `cascade.ts` into `dry-run.ts` projections — the projections are placeholder zeros in F1 per PATTERNS §3.C.
- **Effort:** 5h
- **Verifies:** `pnpm --filter @faka/connectors exec tsc --noEmit` passes; `pnpm vitest run packages/connectors/__tests__/csv-column-map.test.ts` passes with a synthetic row matching the WordPress profile; `grep -c 'applyColumnMap' apps/dashboard/app/\(app\)/operacion/upload/_actions/commit-upload.ts` returns 0 (W1 invariant — commitUpload must NOT invoke applyColumnMap directly); integration test against local Supabase (covered by 1.2.5) seeds a fixture upload + raw_csv_rows, calls `ingestUpload`, asserts rows land in `sales` or `master_products` and `raw_csv_rows.processed = true`.
- **FND:** FND-05 (CSVConnector is the first concrete `ChannelConnector`).

### Plan 1.2.4 — Cross-cutting helpers: idempotency, retry+DLQ, observability, audit
- **Task:** Four helper modules.
  - `packages/connectors/src/idempotency.ts` — `idempotencyKey(canal, externalOrderId): string` (string composition for logs) + `idempotentUpsert(supabase, table, row, conflictCols)` wrapper that calls `.upsert(row, { onConflict: conflictCols.join(',') })` (RESEARCH §7 canonical pattern). Test: two consecutive calls with same `(canal, external_order_id)` produce single `sales` row.
  - `packages/connectors/src/retry.ts` — `withRetryAndDLQ<T>(fn, { canal, payload }, supabase): Promise<T | null>` per RESEARCH §7 verbatim: uses `p-retry` with `retries: 3, factor: 2, minTimeout: 1000`; on final failure inserts into `dead_letter_queue` and returns `null`.
  - `packages/connectors/src/observability.ts` — `recordConnectorRun(supabase, { kind, canal, started_at, completed_at, status, records_processed, records_failed, retry_count, errors_json, duration_ms })`. Writes one row at END of the run (RESEARCH §8 — never per sub-batch). **The helper enforces the kind/canal coherence rule from migration 0008 (W2 fix):** when `kind='channel'`, `canal` is required and must be a valid `channel` value; when `kind='cron-heartbeat'`, `canal` must be `null`. Throws at call-site if the rule is violated.
  - `packages/db/helpers/audit.ts` — `auditLog(supabase, { user_id, role_at_time, action, target_table, target_id, payload_json })`. Cap `payload_json` at ~64KB; truncate with marker `{ ..., _truncated: true }` per RESEARCH §6 Pitfall (audit log size).
- **Files:** `packages/connectors/src/idempotency.ts`, `packages/connectors/src/retry.ts`, `packages/connectors/src/observability.ts`, `packages/db/helpers/audit.ts`, `packages/db/index.ts` (modify — re-export audit helper).
- **Depends on:** 1.2.1, Wave 1 migrations 0005 (sales unique constraint), 0008 (connector_runs, audit_log, dead_letter_queue).
- **References:** RESEARCH §7 (retry + DLQ + idempotent UPSERT), RESEARCH §8 (write `connector_runs` once at end), RESEARCH §6 Pitfall (audit_log truncation).
- **Anti-duplication note:** RESEARCH §7 — DO NOT introduce BullMQ or Redis. DLQ is a Postgres table only. RESEARCH §8 — DO NOT trigger `audit_log` from DB triggers; app-layer writes only (so `role_at_time` is the snapshot the caller knew).
- **Effort:** 3h
- **Verifies:** `pnpm vitest run packages/connectors/__tests__/idempotency.test.ts` — two upserts → 1 row; `pnpm vitest run packages/connectors/__tests__/retry.test.ts` — function that fails 4 times triggers DLQ row insert; `pnpm vitest run packages/connectors/__tests__/observability.test.ts` — call records exactly one connector_runs row per invocation AND a call with `kind='cron-heartbeat'` + non-null `canal` throws; `pnpm vitest run packages/db/__tests__/audit.test.ts` — auditLog truncates a 100KB payload to ~64KB with `_truncated: true`.
- **FND:** FND-08 (idempotency + retry+DLQ + connector_runs + audit_log).

### Plan 1.2.5 — Connector integration tests + interface conformance test + RLS test
- **Task:** Three integration test files using Vitest + local Supabase.
  - `packages/connectors/__tests__/skeletons.test.ts` — type-level test: import each of 6 skeleton factories, assert they satisfy `ChannelConnector` interface, call `healthCheck()`, assert returns `{ ok: false }`.
  - `packages/connectors/__tests__/csv.integration.test.ts` — end-to-end against local Supabase: seed a `raw_csv_uploads` row + 10 `raw_csv_rows` from a fixture CSV (`__fixtures__/wordpress-products-sample.csv`, copy from `docs/csv-templates/`), call `csvConnector.ingestUpload(upload_id)`, assert `master_products` has new rows and `raw_csv_rows.processed = true` for all 10. Reprocess test: call `ingestUpload` a second time, assert UPSERT idempotency (no duplicate rows).
  - `packages/db/__tests__/rls.test.ts` — per RESEARCH §3 verification protocol: create test users with `auth.admin.createUser` for each of the 4 roles, set `profiles.role` accordingly, sign each user in, attempt `select * from sales_view_analista` and assert `total IS NULL AND customer_id IS NULL`; attempt `select * from sales_view_manager` and assert `total IS NOT NULL AND customer_id IS NULL`; attempt `select * from sales` directly as `authenticated` and assert "permission denied" (base table revoked).
  - Fixtures: copy `docs/csv-templates/wordpress.csv` (sample) into `packages/connectors/__fixtures__/wordpress-products-sample.csv`. If the .csv version doesn't exist, generate a 10-row synthetic CSV from the .md spec.
- **Files:** `packages/connectors/__tests__/skeletons.test.ts`, `packages/connectors/__tests__/csv.integration.test.ts`, `packages/db/__tests__/rls.test.ts`, `packages/connectors/__fixtures__/wordpress-products-sample.csv`, `packages/db/__fixtures__/sample-sale.json`.
- **Depends on:** 1.2.1, 1.2.2, 1.2.3, 1.2.4, Wave 1 complete.
- **References:** RESEARCH §3 verification protocol, RESEARCH §9 (test pyramid), PATTERNS §3.C tests row.
- **Anti-duplication note:** RESEARCH §9 — fixtures reuse `docs/csv-templates/`; DO NOT regenerate canonical CSVs from scratch.
- **Effort:** 3h
- **Verifies:** All three test files pass via `pnpm vitest run` against local Supabase; CI workflow `db-integration` job goes green; coverage report shows `packages/connectors/src/csv/**` ≥ 70%.
- **FND:** FND-03 (RLS test), FND-04 (skeleton conformance), FND-05 (CSV integration).

---

## Wave 3 — Dashboard (apps/dashboard)

> Next.js 14 App Router shell on Vercel. Login UI, JWT-claim middleware, role-aware layout, full "Operación" view with 3-step CSV upload wizard + historial table + reprocess action. Most plans are serial since they share state (the wizard's 3 steps live in URL params and share Server Actions). Depends on Wave 1 (auth + schema) + Wave 2 (CSVConnector real impl + helpers).

### Plan 1.3.1 — `apps/dashboard` Next.js scaffold + Supabase clients + UI primitives package
- **Task:** Two artifacts.
  - `apps/dashboard/`: `next.config.mjs` (`transpilePackages: ['@faka/ui','@faka/auth','@faka/connectors','@faka/schema','@faka/db']`), `package.json` (deps `next@^14`, `react@^18`, `react-dom@^18`, `@supabase/supabase-js@2.105.4`, `@supabase/ssr@0.10.3`, `@faka/*` workspace refs, `tailwindcss`, `nanoid` — explicit per RESEARCH Pitfall 5), `tsconfig.json` extending `@faka/config/tsconfig.nextjs.json`, `tailwind.config.ts` (content includes `packages/ui/**`), `postcss.config.cjs`, `app/layout.tsx` (sidebar + topbar per `csv-upload-wizard.html:28-58` — only "Operación" link active, others placeholders). **W5 fix: the topbar in this plan renders a `<SignInLink href="/login">Iniciar sesión</SignInLink>` placeholder ONLY** (no `getUser()` / `getSession()` calls, no auth-aware user-email display). The auth-aware topbar (user email + avatar + sign-out) is added by Plan 1.3.2 after middleware ships. This ensures `app/layout.tsx` renders safely when no session exists. `app/globals.css` (Tailwind base + design tokens matching sketch colors), `app/page.tsx` (redirect to `/operacion`), `lib/supabase/server.ts` + `lib/supabase/browser.ts` (re-export from `@faka/db/client`), `app/api/health/route.ts` (returns `{ ok: true, migrations: 'in-sync' }`), `.env.example` (NEXT_PUBLIC_SUPABASE_URL/ANON, SUPABASE_SERVICE_ROLE_KEY).
  - `packages/ui/`: shadcn-style components — `src/components/{button,select,toggle,card,table,badge,data-table}.tsx` (standard shadcn copy-pastes), `src/components/stepper.tsx` (design from `csv-upload-wizard.html:71-86`), `src/components/dropzone.tsx` (design from `csv-upload-wizard.html:170-176`), `src/components/mapping-table.tsx` (design from `csv-upload-wizard.html:212-256`), `src/components/sign-in-link.tsx` (W5 — auth-tolerant topbar placeholder; just a styled `<a href="/login">`). `styles/globals.css` Tailwind tokens. `package.json` deps: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tailwindcss`.
- **Files:** `apps/dashboard/next.config.mjs`, `apps/dashboard/package.json`, `apps/dashboard/tsconfig.json`, `apps/dashboard/tailwind.config.ts`, `apps/dashboard/postcss.config.cjs`, `apps/dashboard/app/layout.tsx`, `apps/dashboard/app/globals.css`, `apps/dashboard/app/page.tsx`, `apps/dashboard/app/api/health/route.ts`, `apps/dashboard/lib/supabase/server.ts`, `apps/dashboard/lib/supabase/browser.ts`, `apps/dashboard/.env.example`, `packages/ui/src/components/{button,select,toggle,card,table,badge,data-table,stepper,dropzone,mapping-table,sign-in-link}.tsx`, `packages/ui/src/index.ts`, `packages/ui/styles/globals.css`, `packages/ui/package.json`, `packages/ui/tsconfig.json`.
- **References:** RESEARCH §1 (Vercel monorepo + transpilePackages), RESEARCH §10 (env var list), PATTERNS §3.E (shadcn primitives + sketch-derived components), PATTERNS §3.G (dashboard tree + sketch line ranges), `docs/sketches/csv-upload-wizard.html:28-58, 71-86, 170-176, 212-256` (UX source of truth).
- **Anti-duplication note:** PATTERNS §5.7 — DO NOT redesign the wizard or rename steps. PATTERNS §3.E — replace inline `slate-900` etc. from the HTML with shadcn theme vars; DO NOT copy inline hex colors. RESEARCH Pitfall 5 — explicitly declare `react`, `react-dom`, `@supabase/*` in `apps/dashboard/package.json`; do NOT rely on transitive pnpm hoisting. **W5 — the `app/layout.tsx` in this plan is the "shell layout" (no session reads). The auth-aware enhancements (user email, role badge, sign-out button) belong to Plan 1.3.2 which extends the topbar AFTER middleware exists.**
- **Effort:** 5h
- **Verifies:** `pnpm --filter dashboard run build` succeeds (Next compile clean); `pnpm --filter dashboard run dev` boots; `curl http://localhost:3000/api/health` returns `{ ok: true }`; visiting `http://localhost:3000/` when not logged in does NOT crash and topbar shows the "Iniciar sesión" link (no `getUser()` call has been added yet); `grep -c 'getUser()' apps/dashboard/app/layout.tsx` returns 0 (W5 invariant — auth-aware reads land in 1.3.2); `pnpm --filter @faka/ui exec tsc --noEmit` passes; sidebar layout renders the 5 nav items with "Operación" highlighted.
- **FND:** FND-01 (Vercel/Next.js linked).

### Plan 1.3.2 — `packages/auth` + middleware + login UI + role propagation + auth-aware topbar
- **Task:** Create `packages/auth/`:
  - `src/middleware.ts` — Next.js middleware verbatim from RESEARCH §4 reading session cookie via `@supabase/ssr`, asserting JWT, extracting `role` from `user.app_metadata.role` (set by the Auth Hook), redirecting unauthenticated to `/login`, role-gating with `ROUTE_ROLE_REQUIREMENTS` table (`/admin: ['super_admin']`, `/operacion: ['super_admin','admin','manager']`, `/inteligencia/hoy: all 4`), setting `x-user-role` header for Server Components.
  - `src/require-role.ts` — `requireRole(roles[], handler)` HOC for Server Actions returning 403 if role mismatched.
  - `src/role-matrix.ts` — TS representation of ADR-002 matrix (`Record<Capability, UserRole[]>`) — used by UI to hide/show buttons (NOT the security boundary).
  - `src/jwt-claims.ts` — `JwtClaims` type + `parseClaims(token)`.
  - `src/sign-in.ts` — Server Action wrapper around `supabase.auth.signInWithPassword` (email + password only, per RESEARCH §3 Claude's Discretion).
  - `src/sign-out.ts`.
  - `__tests__/middleware.test.ts` — mock JWT per role, assert routing decisions.
  - `package.json`, `tsconfig.json`.
- Create `apps/dashboard/middleware.ts` re-exporting `packages/auth/middleware` with the route table, with `matcher: ['/((?!_next/static|_next/image|favicon.ico|public/|api/health).*)']`.
- Create `apps/dashboard/app/(auth)/login/page.tsx` — email + password form using `@faka/ui` Card + Button, submitting to `signIn` Server Action; redirects to `/operacion` on success, shows error message on failure.
- Create `apps/dashboard/app/(app)/forbidden/page.tsx` — "Acceso denegado" landing.
- **W5 fix — extend `apps/dashboard/app/layout.tsx`** (originally created in 1.3.1 as a shell layout) to add the auth-aware topbar: read `user.email` and `user.app_metadata.role` from the SSR Supabase client; render `<UserBadge email role />` + sign-out button when session exists, otherwise keep the `<SignInLink>` placeholder. This change is SAFE only after middleware (above) ships because middleware now guarantees `/` and dashboard routes are gated, so unauthenticated traffic hits `/login` not `app/layout.tsx`. Create `packages/ui/src/components/user-badge.tsx`.
- Add integration test `apps/dashboard/__tests__/auth.integration.test.ts`: sign in as each role, hit `/operacion`, assert middleware allows manager+admin+super_admin and forbids analista (per ADR-002 matrix row "Subir CSV / reprocesar uploads"). Also assert topbar renders user email after login.
- **Files:** `packages/auth/src/{middleware,require-role,role-matrix,jwt-claims,sign-in,sign-out}.ts`, `packages/auth/src/index.ts`, `packages/auth/__tests__/middleware.test.ts`, `packages/auth/package.json`, `packages/auth/tsconfig.json`, `apps/dashboard/middleware.ts`, `apps/dashboard/app/(auth)/login/page.tsx`, `apps/dashboard/app/(auth)/login/_actions.ts`, `apps/dashboard/app/(app)/forbidden/page.tsx`, `apps/dashboard/app/layout.tsx` (modify — add auth-aware topbar), `apps/dashboard/__tests__/auth.integration.test.ts`, `packages/ui/src/components/user-badge.tsx` (modify barrel).
- **Depends on:** 1.3.1, Wave 1 (1.1.5 Auth Hook + 1.1.7 Super Admin seeder).
- **References:** RESEARCH §4 (middleware verbatim + role-routing table), ADR-002 (4-role matrix), PATTERNS §3.D, PATTERNS §3.G login page.
- **Anti-duplication note:** RESEARCH §4 — role lives in `profiles.role` and propagates to JWT via the Auth Hook (1.1.5). DO NOT mutate `auth.users.app_metadata` directly; only the Server Action that updates `profiles` is allowed to change role. **W5 — the auth-aware topbar lands HERE, not in 1.3.1. Do not duplicate the topbar markup; modify the existing `app/layout.tsx` in place.**
- **Effort:** 5h
- **Verifies:** `pnpm vitest run packages/auth/__tests__/middleware.test.ts` passes; `pnpm vitest run apps/dashboard/__tests__/auth.integration.test.ts` passes — 4 sign-ins succeed, role-routing matches matrix, topbar renders email; `pnpm --filter dashboard run build` still clean; `grep -c 'getUser()' apps/dashboard/app/layout.tsx` returns ≥1 (auth-aware topbar landed); manual smoke test: login as Super Admin → redirected to `/operacion`, topbar shows email + role; login as Analista → redirected to `/forbidden` when hitting `/operacion`.
- **FND:** FND-03 (login + JWT middleware + role gating).

### Plan 1.3.3 — Operación landing page + Step 1 (Fuente) of CSV upload wizard
- **Task:** Create:
  - `apps/dashboard/app/(app)/operacion/page.tsx` — Operación landing: links to "Subir CSV" + "Historial" + future placeholders for "Health" (F3) + "Cola de validación" (F2). Server Component reading role from `x-user-role` header.
  - `apps/dashboard/app/(app)/operacion/upload/page.tsx` — wizard host. Reads `?step=1|2|3&upload=...&profile=...` from URL params (CONTEXT.md "Specific Ideas" — state lives in URL). Renders the corresponding step component. Uses `<Stepper>` from `@faka/ui` per `csv-upload-wizard.html:71-86`.
  - `apps/dashboard/app/(app)/operacion/upload/_components/step-source.tsx` — Step 1 per `csv-upload-wizard.html:88-162`: channel grid (clickable cards for wordpress/mercadolibre/dropi/pos/whatsapp/falabella-disabled), type radios (`products`/`orders`/`order_items`/`inventory`), `<Select>` of existing `csv_mapping_profiles` filtered by `(channel, type)` (Server Component fetches profiles via Supabase server client). "Continuar" button submits Server Action `selectSource(formData)` which validates and redirects to `?step=2`.
  - `apps/dashboard/app/(app)/operacion/upload/_actions/select-source.ts` — Server Action: validates channel ∈ enum, type ∈ enum, optional `mapping_profile_id`. If selected channel is `falabella` → return error "canal deshabilitado".
- **Files:** `apps/dashboard/app/(app)/operacion/page.tsx`, `apps/dashboard/app/(app)/operacion/upload/page.tsx`, `apps/dashboard/app/(app)/operacion/upload/_components/step-source.tsx`, `apps/dashboard/app/(app)/operacion/upload/_actions/select-source.ts`.
- **Depends on:** 1.3.1, 1.3.2.
- **References:** RESEARCH §6 (wizard URL state), PATTERNS §3.G (`step-source.tsx` design from sketch:88-162), CONTEXT.md "Specific Ideas" (wizard state in URL), ADR-002 (Operación visible to super_admin/admin/manager per matrix).
- **Anti-duplication note:** PATTERNS §5.7 — match the 3 step labels verbatim: "Fuente" / "Mapeo de columnas" / "Validar y confirmar". Falabella card is rendered but **disabled** (visual + click → noop) per FND-04. DO NOT replace channel grid with a `<Select>`.
- **Effort:** 4h
- **Verifies:** Visit `http://localhost:3000/operacion/upload` while logged in as `admin` → renders step-source UI; clicking a channel + type + profile → "Continuar" → URL updates to `?step=2&channel=wordpress&tipo=products&profile=<id>`; clicking Falabella → button stays disabled or shows tooltip "deshabilitado en F1"; visiting `/operacion` as `analista` → redirected to `/forbidden` (via middleware from 1.3.2).
- **FND:** FND-06 (wizard step 1).

### Plan 1.3.4 — Wizard Step 2 (Mapeo) + upload-csv Server Action + Storage write
- **Task:** Create:
  - `apps/dashboard/app/(app)/operacion/upload/_components/step-mapping.tsx` — Step 2 per `csv-upload-wizard.html:164-280`: dropzone for the CSV file (uses `@faka/ui/dropzone`, 20MB hard cap client-side per RESEARCH Pitfall 6 + accept `.csv`), preview of first 5 parsed rows in a `<DataTable>`, mapping table per sketch:212-256 with auto-detect badges (`auto` / `68% vacío` / `manual`). Calls `autoDetect()` from `@faka/connectors/csv` on file load to suggest column_map. Toggle "Guardar como nueva versión" (creates `csv_mapping_profiles` row v+1 on confirm). "Continuar" → Server Action `createUploadAndMap(formData)`.
  - `apps/dashboard/app/(app)/operacion/upload/_actions/upload-csv.ts` — Server Action verbatim from RESEARCH §6 `createUpload`:
    1. Auth check (`requireRole(['super_admin','admin','manager'])`).
    2. Validate `file.size <= 20MB`, `file.type ∈ ALLOWED_TYPES`, filename sanitized to `[A-Za-z0-9_.-]` (RESEARCH §Security CSV path traversal).
    3. Generate `upload_id = crypto.randomUUID()`, `storage_path = csv/{upload_id}/{filename}`.
    4. `supabase.storage.from('csv-uploads').upload(...)` (server-side, immutable per ADR-001).
    5. Insert `raw_csv_uploads` row with `status='uploaded'`.
    6. Call `auditLog({ action: 'csv_upload_created', target_table: 'raw_csv_uploads', target_id: upload_id, payload_json: { filename, bytes, canal, tipo } })`.
    7. Return `{ upload_id }`.
    8. `revalidatePath('/operacion')`.
  - `apps/dashboard/app/(app)/operacion/upload/_actions/save-mapping.ts` — If user chose "save as new version", insert new `csv_mapping_profiles` row with `version = max(version) + 1` for same (canal, tipo). Update `raw_csv_uploads.mapping_profile_id`.
- **Files:** `apps/dashboard/app/(app)/operacion/upload/_components/step-mapping.tsx`, `apps/dashboard/app/(app)/operacion/upload/_actions/upload-csv.ts`, `apps/dashboard/app/(app)/operacion/upload/_actions/save-mapping.ts`, `apps/dashboard/app/(app)/operacion/upload/_actions/auto-detect.ts` (thin wrapper around `@faka/connectors/csv/auto-detect`).
- **Depends on:** 1.3.3, 1.2.3 (CSVConnector + auto-detect), 1.2.4 (audit helper), Wave 1 migrations 0003 + 0008.
- **References:** RESEARCH §6 (createUpload verbatim + multipart/Storage), `docs/sketches/csv-upload-wizard.html:164-280` (UX), PATTERNS §3.G `_actions/upload-csv.ts` row, ADR-001 (Storage immutable).
- **Anti-duplication note:** RESEARCH §6 + Pitfall 6 — DO NOT raise the 20MB cap; enforce both client-side (input accept) and server-side (file.size check). RESEARCH §Security V8 — DO NOT skip filename sanitization. RESEARCH §6 — server streams to Storage; do NOT base64 the file or send it through serialized RPC.
- **Effort:** 5h
- **Verifies:** Upload a 100KB fixture CSV through the UI → `raw_csv_uploads` row exists with `storage_path` populated; the storage bucket `csv-uploads` contains the file at `csv/{upload_id}/`; `audit_log` has a row with `action='csv_upload_created'`; uploading a 25MB file rejected with "FILE_TOO_LARGE" message; uploading `evil/../etc/passwd.csv` filename is rejected (sanitization); URL reaches `?step=3&upload=<id>`.
- **FND:** FND-06 (wizard step 2 + Storage write + audit_log entry).

### Plan 1.3.5 — Wizard Step 3 (Validar) + dry-run + commit + CSVConnector invocation
- **Task:** Create:
  - `apps/dashboard/app/(app)/operacion/upload/_components/step-validate.tsx` — Step 3 per `csv-upload-wizard.html:282-374`: 3-stat header (valid / warning / error counts from `dryRun` Server Action result), impact projection card (`projected.newMasterSkus`, `projected.autoMatches`, `projected.llmCandidates`, `projected.validationQueue` — all zeros in F1), error list (first 50 errors with row#+reason), "Confirmar y procesar" button → `commitUpload` Server Action with `dry_run: false`.
  - `apps/dashboard/app/(app)/operacion/upload/_actions/dry-run.ts` — Server Action: calls `csvConnector.dryRun(uploadId, profileId)` (from 1.2.3). Returns `{ total, valid, warnings, errors, projected }`.
  - `apps/dashboard/app/(app)/operacion/upload/_actions/commit-upload.ts` — Server Action verbatim from RESEARCH §6 `commitUpload` adapted. **W1 fix — this Server Action owns the WORKFLOW (file → Storage → raw_csv_rows → invoke CSVConnector); it does NOT own normalization (`applyColumnMap` + Zod validation live in 1.2.3 `ingestUpload` exclusively).** The step list:
    1. Auth check + `requireRole`.
    2. Download CSV bytes from Storage.
    3. `csv-parse/sync` parse with `columns: true, skip_empty_lines: true, delimiter, trim: true`.
    4. **Persist each parsed row as-is into `raw_csv_rows.payload_json` (raw `Record<string,string>`).** Deferred validation: NO `applyColumnMap` and NO Zod parse here — those run inside `csvConnector.ingestUpload` (step 7). Chunk-insert raw rows (500/batch).
    5. Update `raw_csv_uploads.status = 'validating'`, `row_count`.
    6. Wrap the next steps with `recordConnectorRun` (from 1.2.4) — one row per upload, written at END.
    7. **Delegate row-to-normalized to CSVConnector from 1.2.3:** invoke `csvConnector.ingestUpload(upload_id)` inline. CSVConnector applies column-map, Zod-validates, UPSERTs into `sales`/`master_products`, and accumulates `error_log_json`.
    8. Update `raw_csv_uploads.status = 'processed'`, `error_log_json` from ingestUpload result.
    9. `auditLog({ action: 'csv_upload_processed', target_id: upload_id, payload_json: { rows_processed, rows_failed } })`.
    10. Redirect to `/operacion/historial?highlight=<upload_id>`.
- Add integration test `apps/dashboard/__tests__/upload.integration.test.ts` verbatim from RESEARCH §9: seed an upload via direct DB+Storage writes, call `commitUpload`, assert `raw_csv_rows.count > 0` AND `raw_csv_rows[0].payload_json` is a raw `Record<string,string>` (no transformations applied at write time), `connector_runs.canal='csv-upload'` has 1 row, `audit_log` has 2 rows (`csv_upload_created` + `csv_upload_processed`).
- **Files:** `apps/dashboard/app/(app)/operacion/upload/_components/step-validate.tsx`, `apps/dashboard/app/(app)/operacion/upload/_actions/dry-run.ts`, `apps/dashboard/app/(app)/operacion/upload/_actions/commit-upload.ts`, `apps/dashboard/__tests__/upload.integration.test.ts`, `apps/dashboard/__fixtures__/wordpress-products-sample.csv`.
- **Depends on:** 1.3.4, 1.2.3 (CSVConnector real impl — normalization layer), 1.2.4 (helpers).
- **References:** RESEARCH §6 (commitUpload + reprocess flow), RESEARCH §9 (integration test pattern), `docs/sketches/csv-upload-wizard.html:282-374` (Step 3 UX), PATTERNS §3.G `_actions/dry-run.ts` row.
- **Anti-duplication note (W1 — boundary with 1.2.3):** This Server Action owns the **workflow** (file upload → write storage → parse CSV bytes → write raw_csv_rows → call CSVConnector.ingestUpload). It does NOT call `applyColumnMap` directly and does NOT Zod-validate rows pre-write — those steps happen exclusively inside 1.2.3's `ingestUpload`. `raw_csv_rows.payload_json` is the raw `Record<string,string>` row at write time. RESEARCH §8 — `connector_runs` row written ONCE at the END of `commitUpload`, NOT per chunk. RESEARCH §6 — reprocess scenario lives in plan 1.3.6, not here; this plan only handles the first-time commit path.
- **Effort:** 5h
- **Verifies:** End-to-end manual test: upload a fixture CSV via UI → step 3 shows valid/warning/error counts → click "Confirmar y procesar" → success toast → redirected to `/operacion/historial` with the row highlighted; `pnpm vitest run apps/dashboard/__tests__/upload.integration.test.ts` passes (asserts `raw_csv_rows` rows are raw payload, `connector_runs`, `audit_log` rows); `grep -c 'applyColumnMap' apps/dashboard/app/\(app\)/operacion/upload/_actions/commit-upload.ts` returns 0 (W1 invariant); a CSV with intentionally bad rows produces an `error_log_json` array on the `raw_csv_uploads` row.
- **FND:** FND-06 (full wizard live, test CSV lands rows end-to-end).

### Plan 1.3.6 — Historial table + reprocess action with versioned mapping profile
- **Task:** Create:
  - `apps/dashboard/app/(app)/operacion/historial/page.tsx` — Server Component listing `raw_csv_uploads` rows ordered by `uploaded_at desc limit 50`, filtered via RLS (role view if applicable). Uses `@faka/ui/data-table` styled per `csv-upload-wizard.html:393-460`: columns Cuándo / Canal / Tipo / Archivo / Filas / Estado / Acciones. Status badges (`uploaded`=info, `validating`=warn, `processed`=ok, `failed`=err) per sketch:21-24. Acciones column: "Ver" (modal with `error_log_json`) + "Reprocesar" (opens reprocess modal).
  - `apps/dashboard/app/(app)/operacion/historial/_components/reprocess-modal.tsx` — Modal allowing user to choose a different `csv_mapping_profile` version (or upload a NEW version via inline form linking to `save-mapping`). On confirm → calls `reprocessUpload` Server Action.
  - `apps/dashboard/app/(app)/operacion/historial/_actions/reprocess.ts` — Server Action per RESEARCH §6 reprocess pattern:
    1. `requireRole(['super_admin','admin','manager'])`.
    2. Validate new profile matches upload's `canal_declarado + tipo`.
    3. Soft-mark prior `raw_csv_rows` for this upload as superseded (add `superseded_at` column via additive migration 0013 — see Note below) OR truncate; choose **keep + version** path per RESEARCH §6.
    4. Update `raw_csv_uploads.mapping_profile_id = new_profile_id`, `status='validating'`.
    5. Re-stream CSV bytes from Storage (immutable), re-parse with new map, chunk-insert NEW `raw_csv_rows` with the new mapping_profile_version recorded (still raw `Record<string,string>` payload per W1 fix).
    6. Re-invoke `csvConnector.ingestUpload(upload_id)`. The `(canal, external_order_id)` UPSERT on `sales` makes downstream idempotent.
    7. `auditLog({ action: 'csv_upload_reprocessed', target_id: upload_id, payload_json: { from_profile, to_profile_id, to_version } })`.
    8. `recordConnectorRun`.
  - **Additive migration `20260513000013_csv_rows_superseded.sql`** (renumbered from 0015 to 0013 per W8 fix — contiguous numbering) adding `superseded_at timestamptz?` + `mapping_profile_version int?` columns to `raw_csv_rows`. Documented as the reprocess versioning support.
  - Integration test `apps/dashboard/__tests__/reprocess.integration.test.ts`: upload a CSV → process → create new profile version → reprocess → assert (a) NEW `raw_csv_rows` rows exist with `mapping_profile_version=2`, (b) OLD rows have `superseded_at IS NOT NULL`, (c) `sales` table has zero duplicates by `(canal, external_order_id)`, (d) `audit_log` has the `csv_upload_reprocessed` entry.
- **Files:** `apps/dashboard/app/(app)/operacion/historial/page.tsx`, `apps/dashboard/app/(app)/operacion/historial/_components/reprocess-modal.tsx`, `apps/dashboard/app/(app)/operacion/historial/_actions/reprocess.ts`, `apps/dashboard/app/(app)/operacion/historial/_actions/list.ts`, `apps/dashboard/__tests__/reprocess.integration.test.ts`, `packages/db/supabase/migrations/20260513000013_csv_rows_superseded.sql`.
- **Depends on:** 1.3.5, Wave 1 (1.1.1 raw_csv schema).
- **References:** RESEARCH §6 reprocess pattern, `docs/sketches/csv-upload-wizard.html:393-460` (history table UX), PATTERNS §3.G `historial/**` rows, FND-07.
- **Anti-duplication note:** RESEARCH §6 — Storage bytes are IMMUTABLE on reprocess; do NOT re-upload the file. RESEARCH Pitfall on reprocess idempotency — UPSERT on `(canal, external_order_id)` is the only safety net; if reprocess swaps the external_order_id column mapping, orphan facts can result — document this as a known F1 limitation and emit a warning in the dry-run output when the new profile changes the `external_id` source column.
- **Effort:** 5h
- **Verifies:** `pnpm vitest run apps/dashboard/__tests__/reprocess.integration.test.ts` passes; manual UI test: upload fixture → process → on history row click "Reprocesar" → choose v2 profile → process completes → history row updated with new mapping_profile_id; `psql ... -c "select count(distinct (canal,external_order_id)) = count(*) from sales"` returns `t` (no dupes after reprocess).
- **FND:** FND-07 (historial + reprocess with versioned profile).

---

## Wave 4 — Orchestrator (apps/orchestrator)

> Railway-hosted Node/TS service. F1 scope: existence + health endpoint + connectors registry + cron skeleton + retry+DLQ helpers wired + Railway deploy config. No real ingest endpoints (CSV ingest stays in Next.js Server Actions per RESEARCH §6/§7). Depends on Wave 1 (migrations 0008 + 0009) + Wave 2 (connector interface + skeletons + helpers).
>
> **W4 fix — Plan 1.4.4 was split into 1.4.4a (Docker + Railway infra; parallelizable with Wave 3) and 1.4.4b (Vercel link + smoke; depends on Wave 3 dashboard buildable).** This allows orchestrator infrastructure to ship in parallel with dashboard work rather than blocking on it.

### Plan 1.4.1 — Hono server skeleton + connectors registry + health/connectors endpoints
- **Task:** Create `apps/orchestrator/`:
  - `package.json` — `type: module`, deps: `hono@4.12.18`, `@hono/node-server@2.0.2`, `@hono/zod-validator`, `pino@10.3.1`, `p-retry@7.x`, `@supabase/supabase-js`, `@faka/connectors`, `@faka/schema`, `@faka/db`. `engines: { node: '>=22.7' }`. Scripts: `build` (tsc), `start` (`node dist/server.js`), `dev` (`tsx src/server.ts`).
  - `tsconfig.json` extending `@faka/config/tsconfig.base.json` with `outDir: dist`, `rootDir: src`.
  - `src/server.ts` — Hono server per RESEARCH §7 verbatim: `app.get('/health', ...)`, `app.get('/connectors', ...)` lists registry connectors + health, `app.post('/webhooks/:canal', ...)` returns 501 (F2+). Uses `buildRegistry` from `connectors/registry.ts`. Logs via pino.
  - `src/connectors/registry.ts` — `buildRegistry(ctx)` returning `Record<Canal, ChannelConnector>` per RESEARCH §5 (instantiates all 7 factories — 6 channel skeletons + CSVConnector). Reads channel-specific config from `process.env` per factory.
  - `src/lib/log.ts` — pino instance with `level: process.env.LOG_LEVEL ?? 'info'`.
  - `src/lib/supabase.ts` — service-role supabase client factory (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })`).
  - `.env.example` — `PORT=8080`, `LOG_LEVEL=info`, `SUPABASE_URL=`, `SUPABASE_SERVICE_ROLE_KEY=`, channel placeholders (WP, ML, Dropi, POS). Per RESEARCH §10. **No `ANTHROPIC_API_KEY` or LLM vars** — those land in F5 (per PATTERNS §1.1 + §5.1 LLM adapter callout).
- **Files:** `apps/orchestrator/package.json`, `apps/orchestrator/tsconfig.json`, `apps/orchestrator/src/server.ts`, `apps/orchestrator/src/connectors/registry.ts`, `apps/orchestrator/src/lib/log.ts`, `apps/orchestrator/src/lib/supabase.ts`, `apps/orchestrator/.env.example`.
- **Depends on:** Wave 0, Wave 2 (1.2.1 interface, 1.2.2 skeletons, 1.2.3 CSVConnector).
- **References:** RESEARCH §7 (Hono server + registry verbatim), PATTERNS §3.H, ADR-003 + ADR-001 (no WhatsApp endpoints in F1 → 501 placeholder).
- **Anti-duplication note:** PATTERNS §5.1 — DO NOT add LLM provider env vars in F1's `.env.example`; the discovery script already has them in `scripts/discovery/.env.example`. F5 will create `packages/llm` mirroring the resolver pattern from `scripts/discovery/llm-arbiter.ts`. RESEARCH §7 — NO `/ingest/csv-upload` endpoint in F1; the upload flow lives in Next.js Server Actions.
- **Effort:** 4h
- **Verifies:** `pnpm --filter @faka/orchestrator run build` produces `dist/server.js`; `pnpm --filter @faka/orchestrator run dev` boots; `curl http://localhost:8080/health` returns `{ ok: true, ts: ... }`; `curl http://localhost:8080/connectors` returns array of 7 entries (6 channel skeletons + csv-upload) with `ok: false` for 6 and `ok: true` for csv-upload; `curl -X POST http://localhost:8080/webhooks/wordpress` returns 501.
- **FND:** FND-04 (registry wires interface + 6 skeletons + CSVConnector), FND-01 (orchestrator exists).

### Plan 1.4.2 — Cron entry + heartbeat to connector_runs
- **Task:** Create:
  - `apps/orchestrator/src/cron.ts` per RESEARCH §7 verbatim: starts pino logger, creates supabase service-role client, inserts a single `connector_runs` heartbeat row with **`kind='cron-heartbeat'`, `canal=null`** (per W2 fix — the kind/canal coherence rule enforced by the CHECK constraint in migration 0008), `status='succeeded'`, `records_processed=0`, then **`process.exit(0)`** (per Pitfall 7 — Railway cron requires clean exit). Use the `recordConnectorRun` helper from 1.2.4 which enforces the rule at the call-site.
  - Build script update: `package.json` `scripts.build` produces both `dist/server.js` and `dist/cron.js`.
  - Integration test `apps/orchestrator/__tests__/cron.test.ts` — set env vars to local Supabase, run cron entry as a child process, assert exit code 0 and assert `connector_runs` has a new row with `kind='cron-heartbeat' AND canal IS NULL` within 5s.
- **W2 fix:** the cron heartbeat used to require extending the `channel` enum with a `'cron-heartbeat'` value (former migration 0016). That migration is **DROPPED**. Instead, migration 0008 (in Plan 1.1.4) now defines a `connector_run_kind` enum (`channel | cron-heartbeat`), adds a `kind` column to `connector_runs`, makes `canal` nullable, and enforces a CHECK constraint requiring `canal IS NOT NULL` when `kind='channel'` and `canal IS NULL` when `kind='cron-heartbeat'`. This keeps the `channel` enum a clean real-channels-only contract per PATTERNS §5.4 and means `scripts/discovery/types.ts` never gains a sentinel.
- **Files:** `apps/orchestrator/src/cron.ts`, `apps/orchestrator/__tests__/cron.test.ts`.
- **Depends on:** 1.4.1, Wave 1 (0008 connector_runs with `kind` column + `connector_run_kind` enum).
- **References:** RESEARCH §7 (cron entry verbatim), RESEARCH Pitfall 7 (clean exit mandatory), `[VERIFIED: docs.railway.com/reference/cron-jobs]`.
- **Anti-duplication note:** RESEARCH §7 — DO NOT add scheduling logic in the cron entry (no `node-cron`, no `setInterval`). Railway invokes the entry on schedule; the process runs once and exits. **W2 — DO NOT extend the `channel` enum with `'cron-heartbeat'`; the kind column on `connector_runs` is the only place this distinction lives.**
- **Effort:** 2h
- **Verifies:** `pnpm vitest run apps/orchestrator/__tests__/cron.test.ts` passes; manually: `node dist/cron.js` exits with code 0 within 3s; `psql ... -c "select kind, canal, status from connector_runs where kind='cron-heartbeat' order by started_at desc limit 1"` returns `cron-heartbeat | (null) | succeeded`; `grep -c "'cron-heartbeat'" packages/db/supabase/migrations/20260513000002_enums.sql` returns 0 in the channel-enum stanza (channel enum stays clean) and ≥1 in the `connector_run_kind` stanza.
- **FND:** FND-04 (cron skeleton wired), FND-08 (connector_runs writes).

### Plan 1.4.3 — Orchestrator-side retry+DLQ + observability integration tests
- **Task:** Two integration test files (orchestrator wraps the helpers from 1.2.4 — this plan just exercises them through the orchestrator's surface area):
  - `apps/orchestrator/__tests__/retry-and-dlq.test.ts` — Define a deliberately failing function that fails 4 times in a row, wrap with `withRetryAndDLQ` from `@faka/connectors/retry`, run against local Supabase, assert (a) the function was called 4 times total (1 + 3 retries), (b) a row landed in `dead_letter_queue` with `attempts=4` and `error` matching, (c) the wrapper returns `null`.
  - `apps/orchestrator/__tests__/observability.test.ts` — Define a successful function, wrap with `recordConnectorRun`, run, assert exactly one `connector_runs` row was written with status `succeeded`, duration_ms > 0, records_processed matches.
  - `apps/orchestrator/__tests__/idempotency.test.ts` — Insert a `sales` row twice with same `(canal, external_order_id)`, assert second insert UPSERTs (single row, `created_at` unchanged or `updated_at` advanced).
- **Files:** `apps/orchestrator/__tests__/retry-and-dlq.test.ts`, `apps/orchestrator/__tests__/observability.test.ts`, `apps/orchestrator/__tests__/idempotency.test.ts`.
- **Depends on:** 1.2.4, 1.4.1, Wave 1 (0005 + 0008).
- **References:** RESEARCH §7 (retry+DLQ + UPSERT pattern), RESEARCH §8 (audit + connector_runs lifecycle), RESEARCH §9 testing pyramid.
- **Anti-duplication note:** These tests sit in `apps/orchestrator/__tests__` to exercise the helpers from the orchestrator's perspective. The helpers themselves are unit-tested in 1.2.4 (`packages/connectors/__tests__`). DO NOT re-implement the helpers in orchestrator code — import from `@faka/connectors`.
- **Effort:** 3h
- **Verifies:** All three tests pass via `pnpm vitest run apps/orchestrator/__tests__`; CI `db-integration` job remains green.
- **FND:** FND-08 (idempotency + retry+DLQ + connector_runs exercised by tests).

### Plan 1.4.4a — Orchestrator Dockerfile + Railway services + DEPLOY runbook (W4 split, orchestrator portion)
- **Task:** Three artifacts (orchestrator-side infra; parallelizable with Wave 3 — does NOT depend on the dashboard being buildable):
  - `apps/orchestrator/Dockerfile` — multi-stage per RESEARCH §10: stage 1 `node:22-alpine` installs pnpm via corepack, copies workspace, runs `pnpm install --frozen-lockfile && pnpm --filter @faka/orchestrator... build`; stage 2 copies `dist/` + production node_modules, sets `CMD ["node","dist/server.js"]`.
  - `apps/orchestrator/railway.toml` (absolute path required per RESEARCH §1 monorepo gotcha) — declares two services: `orchestrator-web` (start `node dist/server.js`, healthcheck `/health`, watch `apps/orchestrator/** packages/**`) and `orchestrator-cron` (start `node dist/cron.js`, schedule `*/30 * * * *` placeholder, no healthcheck).
  - `DEPLOY.md` at repo root — Operator runbook documenting (1) provisioning Supabase staging project + linking via `supabase link`, (2) Railway two-service setup, (3) seed steps including `pnpm --filter @faka/db run seed:super-admin`. Vercel + smoke sections in 1.4.4b reference this file.
- **Files:** `apps/orchestrator/Dockerfile`, `apps/orchestrator/railway.toml`, `DEPLOY.md`.
- **Depends on:** 1.4.1, 1.4.2. **Does NOT depend on Wave 3** — orchestrator infrastructure can ship in parallel with dashboard development.
- **References:** RESEARCH §10 (Vercel + Railway monorepo config verbatim), RESEARCH §1 (railway.toml absolute path requirement), `[CITED: docs.railway.com/guides/monorepo]`, PATTERNS §3.H Dockerfile row.
- **Anti-duplication note:** RESEARCH §1 — `railway.toml` reference must be absolute (`/apps/orchestrator/railway.toml`) per Railway monorepo docs.
- **Effort:** 2h
- **Verifies:** `docker build -f apps/orchestrator/Dockerfile -t faka-orch .` succeeds locally; `docker run -p 8080:8080 -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... faka-orch` boots and `curl localhost:8080/health` returns 200; `grep -c '\[\[services\]\]' apps/orchestrator/railway.toml` ≥ 2 (orchestrator-web + orchestrator-cron); `DEPLOY.md` exists and references both Supabase + Railway sections.
- **FND:** FND-01 (Railway linked, secrets in env vars only).

### Plan 1.4.4b — Vercel monorepo config + smoke tests (W4 split, dashboard portion)
- **Task:** Two artifacts (dashboard-side infra + cross-service smoke; depends on Wave 0 + Wave 3 having a buildable dashboard + 1.4.4a being shipped):
  - `apps/dashboard/vercel.json` (or document in repo `DEPLOY.md` from 1.4.4a) — Vercel project settings: Root Directory `apps/dashboard`, Build Command `cd ../.. && turbo run build --filter=dashboard...`, Ignored Build Step `npx turbo-ignore --fallback=HEAD^1`, env var list (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Add lint rule in CI: `grep -E 'NEXT_PUBLIC_.*(SERVICE|SECRET|PRIVATE)' apps/dashboard/.env.example apps/dashboard/vercel.json` must return zero matches.
  - **Append to `DEPLOY.md`** (created in 1.4.4a) sections (4) Vercel project creation + branch settings, and (5) smoke test commands.
  - `scripts/smoke.sh` — bash script that curls `/api/health` on the deployed dashboard URL and `/health` + `/connectors` on the orchestrator URL, asserts 200 + expected JSON shape. Run post-deploy.
- **Files:** `apps/dashboard/vercel.json`, `DEPLOY.md` (modify — append Vercel + smoke sections), `scripts/smoke.sh`.
- **Depends on:** 1.3.6 (dashboard fully built end-to-end), 1.4.4a (DEPLOY.md + Railway infra exist), Wave 0.
- **References:** RESEARCH §10 (Vercel monorepo config verbatim), `[VERIFIED: vercel.com/docs/monorepos/turborepo]`, PATTERNS §3.H.
- **Anti-duplication note:** RESEARCH §10 + Pitfall — service-role keys MUST live only in Railway and Vercel env vars; the lint grep ensures we never accidentally prefix one with `NEXT_PUBLIC_`. Modify `DEPLOY.md` in place — do NOT create a parallel `DEPLOY-vercel.md`.
- **Effort:** 1h (mostly infra config + docs)
- **Verifies:** `bash scripts/smoke.sh https://dashboard-preview.vercel.app https://orchestrator-staging.up.railway.app` returns exit 0 against the staging deploy (after manual provisioning); CI lint grep `grep -E 'NEXT_PUBLIC_.*(SERVICE|SECRET|PRIVATE)' apps/dashboard/.env.example apps/dashboard/vercel.json` returns zero matches; DEPLOY.md contains both Railway and Vercel sections (`grep -c '## Railway' DEPLOY.md` ≥1 AND `grep -c '## Vercel' DEPLOY.md` ≥1).
- **FND:** FND-01 (Vercel linked, end-to-end smoke).

---

## Cross-cutting verification

These checks must pass at the end of Phase 1 regardless of which plan delivers them. They map directly to ROADMAP.md success criteria 1–5 (lines 41–46).

| ID | Check | Command / Action | Maps to |
|---|---|---|---|
| CC-1 | Zero pending migrations against staging | `supabase db diff --linked` returns empty | ROADMAP F1 SC1 |
| CC-2 | `supabase db reset` applies all 13 migrations clean | `pnpm --filter @faka/db exec supabase db reset` exits 0; `ls packages/db/supabase/migrations | wc -l` returns 13 (contiguous 0001..0013 per W8 fix) | ROADMAP F1 SC1 + FND-02 |
| CC-3 | Generated `database.ts` matches schema | `pnpm --filter @faka/db run types && git diff --exit-code packages/db/types/database.ts` | FND-02 |
| CC-4 | All four roles can log in; column-level views enforced | `pnpm vitest run packages/db/__tests__/rls.test.ts apps/dashboard/__tests__/auth.integration.test.ts` passes | ROADMAP F1 SC3 + FND-03 |
| CC-5 | Service-role key never appears in client bundle | `pnpm --filter dashboard run build && grep -rL SUPABASE_SERVICE_ROLE_KEY apps/dashboard/.next/static apps/dashboard/.next/server/pages` and inspect output (the key must not appear in any `.next/static` JS chunk) | ROADMAP F1 SC3 |
| CC-6 | 6 channel skeletons + CSVConnector compile | `pnpm --filter @faka/connectors exec tsc --noEmit && pnpm vitest run packages/connectors/__tests__/skeletons.test.ts` | ROADMAP F1 SC4 + FND-04 |
| CC-7 | End-to-end CSV upload through wizard lands rows | `pnpm vitest run apps/dashboard/__tests__/upload.integration.test.ts` passes; manual smoke: log in as admin, upload fixture, see history row with status=`processed` | ROADMAP F1 SC2 + FND-05 + FND-06 |
| CC-8 | Reprocess with new profile version works | `pnpm vitest run apps/dashboard/__tests__/reprocess.integration.test.ts` passes | ROADMAP F1 SC2 + FND-07 |
| CC-9 | Idempotency, retry+DLQ, connector_runs, audit_log exercised | `pnpm vitest run apps/orchestrator/__tests__ packages/connectors/__tests__/idempotency.test.ts` | ROADMAP F1 SC5 + FND-08 |
| CC-10 | Staging deploys reachable | `bash scripts/smoke.sh <dashboard-url> <orchestrator-url>` exits 0 | FND-01 |
| CC-11 | Lint rule blocks NEXT_PUBLIC_*-named secrets | `grep -E 'NEXT_PUBLIC_.*(SERVICE\|SECRET\|PRIVATE)' apps/dashboard/.env.example apps/dashboard/vercel.json` returns zero matches | RESEARCH §10 + Pitfall 5 |
| CC-12 | Every `create view` includes `security_invoker = true` | `grep -c 'create view' packages/db/supabase/migrations/*.sql` equals `grep -c 'security_invoker = true' packages/db/supabase/migrations/*.sql` | RESEARCH Pitfall 1 + FND-03 |
| CC-13 | CSV upload payload immutability | After upload+reprocess, `select count(*) from storage.objects where bucket_id='csv-uploads' and name like 'csv/<upload_id>/%'` returns 1 (Storage file unchanged) | ADR-001 + FND-07 |
| CC-14 | `messaging_log` stays empty in F1 (per ADR-003 LOCKED) | F1 acceptance check: `psql ... -c "select count(*) from messaging_log"` returns 0 BOTH (a) immediately after `supabase db reset` AND (b) after the full integration test suite (`pnpm -r run test`) has executed end-to-end. The table exists per ADR-003 but no writers exist until F5.5. | ADR-003 + FND-08 (W3 fix) |

---

## Out of scope (deferred)

Per CONTEXT.md "Deferred Ideas" and "What this phase does NOT deliver":

- **Real connector implementations** for WordPress (F2), Mercado Libre (F4), Dropi (F4), POS (F3), WhatsApp internal form (F3), WhatsApp Business Cloud API (F5.5), Falabella (F6). F1 ships skeletons only.
- **Matching cascade** — `scripts/discovery/cascade.ts` algorithm is reference for F2 only. F1 creates `master_products` + `product_mappings` + `match_method` enum tables; no logic.
- **Mini-CRM matching + UI** — ADR-004 tables created empty in F1; the matching cascade + "Clientes" view live in F4.
- **AI insight jobs + chat** — F5. F1 creates `ai_insights` + `ai_conversations` skeleton tables only; no LLM provider adapter (`packages/llm` is F5).
- **WhatsApp Business Cloud API** — F5.5. F1 creates empty `messaging_log` table; CC-14 enforces the table stays empty.
- **Dashboard views** "Hoy", "Productos", "Canales", "Inteligencia" — F2+. F1 renders nav placeholders only.
- **Magic link auth** — F2 if cliente requests it. F1 is email + password only.
- **shadcn custom registry** — F3 (when there are more components to register).
- **Edge Functions for CSV parsing > 20MB** — deferred until volume justifies. F1 enforces 20MB hard cap.
- **Row-level encryption** for customer PII — post-F4 when Mini-CRM is populated.
- **e2e Playwright** — F2 when there's a real "Hoy" view to test. F1 uses Vitest unit + integration only.
- **`/ingest/csv-upload` HTTP endpoint on the orchestrator** — F1 keeps CSV ingestion in Next.js Server Actions per RESEARCH §6 architectural call. The orchestrator's role in F1 is registry + health + cron skeleton + DLQ helpers.
- **Branch-specific Supabase projects** — RESEARCH §10 Open Question 1 (RESOLVED 2026-05-13); F1 all PRs share staging Supabase.

---

## Goal-backward verification

Mapping ROADMAP.md Phase 1 success criteria → plans that produce them.

### SC1 — "Supabase staging environment has the full 5-layer schema deployed (RAW + MASTER + FACTS + MARTS skeleton + INSIGHTS), including the LOCKED tables `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles`; a developer can run a schema diff and see zero pending migrations."

- Plan 1.1.1 — RAW layer + CSV tables (LOCKED ADR-001).
- Plan 1.1.2 — MASTER layer (incl. Mini-CRM stubs LOCKED ADR-004).
- Plan 1.1.3 — FACTS layer (incl. (canal, external_order_id) unique constraint).
- Plan 1.1.4 — MARTS skeleton + INSIGHTS + messaging_log (LOCKED ADR-003) + observability tables (incl. `connector_runs.kind` column per W2 fix).
- Plan 1.1.7 — Seed + `db:types:check` gate.
- Plan 1.4.4b — Smoke test against staging.
- Cross-cutting checks: CC-1, CC-2, CC-3, CC-14.

### SC2 — "A test CSV uploaded through the dashboard 'Operación' 3-step wizard lands rows in `raw_csv_uploads` + `raw_csv_rows`, with the original payload retained in Supabase Storage at the path referenced by `raw_csv_uploads.storage_path`; the historical uploads table shows the upload with status, row count, and a working 'reprocess with versioned mapping profile' action."

- Plan 1.2.3 — `CSVConnector.ingestUpload` (normalization layer; called by 1.3.5).
- Plan 1.3.3 — Wizard Step 1 (Fuente).
- Plan 1.3.4 — Wizard Step 2 (Mapeo) + upload-csv Server Action + Storage write + audit_log entry.
- Plan 1.3.5 — Wizard Step 3 (Validar) + commit Server Action workflow + invoke CSVConnector + integration test.
- Plan 1.3.6 — Historial table + reprocess action with versioned profile + integration test.
- Cross-cutting checks: CC-7, CC-8, CC-13.

### SC3 — "Three roles (owner, developer, staff) can log in via Supabase Auth; RLS policies enforce role boundaries on every user-readable table; channel API keys are stored only in Railway env vars (zero secrets in Supabase tables, frontend bundles, or the repo)."

> **Note:** ROADMAP SC3 still references the legacy 3-role naming. ADR-002 (LOCKED) supersedes with 4 roles (`super_admin`, `admin`, `manager`, `analista`). F1 ships the 4-role matrix per FND-03 verbatim; SC3 is satisfied by exceeding it (4 roles cover all the 3-role use cases).

- Plan 1.1.5 — Profiles + Auth Hook.
- Plan 1.1.6 — RLS + SECURITY INVOKER role views + grants.
- Plan 1.1.7 — Super Admin seeder (`nicolasperezmontoya@gmail.com`).
- Plan 1.3.2 — `packages/auth` + middleware + login UI + role propagation + auth-aware topbar.
- Plan 1.4.4b — `.env.example` schema + lint rule.
- Cross-cutting checks: CC-4, CC-5, CC-11, CC-12.

### SC4 — "Connector skeletons for WordPress, ML, Dropi, POS, WhatsApp, and Falabella compile against the published `ChannelConnector` interface; `CSVConnector` is the first concrete implementation and is wired into the upload endpoint."

- Plan 1.2.1 — `packages/schema` + `ChannelConnector` interface published.
- Plan 1.2.2 — 6 channel skeletons (each throws NotImplementedError for its target phase).
- Plan 1.2.3 — `CSVConnector` concrete impl.
- Plan 1.3.4 + 1.3.5 — wired into upload Server Actions.
- Plan 1.4.1 — `buildRegistry` instantiates all 7 in the orchestrator.
- Cross-cutting check: CC-6.

### SC5 — "Orchestrator implements the cross-cutting protocols: `(canal, external_order_id)` idempotency, 3× exponential backoff + dead-letter queue, `connector_runs` writes per execution, `audit_log` writes on user mutations."

- Plan 1.1.3 — DB unique constraint on `sales(canal, external_order_id)`.
- Plan 1.1.4 — `connector_runs` (with `kind` column), `audit_log`, `dead_letter_queue` tables.
- Plan 1.2.4 — helpers: `idempotentUpsert`, `withRetryAndDLQ`, `recordConnectorRun` (enforces kind/canal coherence), `auditLog`.
- Plan 1.3.4 + 1.3.5 + 1.3.6 — audit_log entries on user mutations (`csv_upload_created`, `csv_upload_processed`, `csv_upload_reprocessed`).
- Plan 1.4.2 — cron heartbeat exercises `connector_runs` writes with `kind='cron-heartbeat'` / `canal=null`.
- Plan 1.4.3 — orchestrator integration tests verify all four protocols.
- Cross-cutting check: CC-9.

---

## Open Questions (RESOLVED 2026-05-13)

Per W6 fix — all four open questions surfaced during RESEARCH have been resolved in RESEARCH.md (Open Questions section). Decisions summary:

1. **Branch-specific Supabase projects for Vercel previews?** — **Decision (RESOLVED 2026-05-13):** No. F1 all PRs hit the SAME Supabase staging project. Migration testing happens in CI via local Supabase (`supabase db reset`). CI MUST never `supabase db push`; only the tagged release workflow does that. Plan 1.0.3 + Plan 1.4.4b enforce.
2. **Edge Functions for CSV parsing — when to flip?** — **Decision (RESOLVED 2026-05-13):** Defer to F2. F1 enforces a 20MB hard cap (configurable via `CSV_MAX_BYTES` env var, default 20MB) on the Next.js Server Action path. Document the Edge Function migration path in RESEARCH for F2.
3. **Should `profiles` be in `public` schema or its own?** — **Decision (RESOLVED 2026-05-13):** `public.profiles`. Plan 1.1.5 implements verbatim.
4. **Cookie security flags for the Supabase SSR session.** — **Decision (RESOLVED 2026-05-13):** Accept `@supabase/ssr` defaults (`SameSite=Lax`) for F1. Audit in F5 when secret data is more material.

---

## Notes for executors

1. **Locked decisions are non-negotiable.** ADR-001 (CSV first-class), ADR-002 (4 roles + column-level), ADR-003 (messaging_log empty), ADR-004 (Mini-CRM stubs) are LOCKED. Any task that wants to deviate must stop and surface a checkpoint to the user.
2. **Migrations are append-only.** Once a migration is committed, never edit it; create a new one (per RESEARCH §2 — alphabetic ordering by timestamp). Plan 1.3.6 follows this for the `superseded_at` addition. **Migration numbering is contiguous post-revision (0001–0013).** Per W2 fix, the former `cron-heartbeat` enum-extension migration (originally 0016) was DROPPED — the `kind` column on `connector_runs` now lives inside migration 0008. Per W8 fix, migrations 0009–0013 are renumbered down by 2 (former 0011→0009, 0012→0010, 0013→0011, 0014→0012, 0015→0013) so the migration stream is contiguous.
3. **Service-role secrets stay server-side.** Any place that uses `SUPABASE_SERVICE_ROLE_KEY` must NOT be reachable from the client bundle (Server Actions, orchestrator only). Lint rule from 1.0.2 + verification step CC-11 enforce this.
4. **Wave 1 layer order matters.** Migrations 0001→0002→0003→0004→0005→0006→0007→0008 are sequential because FACTS references MASTER and MARTS references FACTS. Plans 1.1.5/1.1.6/1.1.7 (RLS + views + seed) layer atop after 1.1.4 finishes. Migration 0013 (1.3.6) is additive and slots at the end of the migration stream.
5. **Single source of truth for the wizard UX** is `docs/sketches/csv-upload-wizard.html`. Pixel-for-pixel deviation is acceptable; flow/labels/steps/badges are NOT (per PATTERNS §5.7).
6. **Test fixtures reuse `docs/csv-templates/` + `scripts/discovery/profiles/`.** No new canonical CSV files (per PATTERNS §1.4 + §5.8).
7. **The orchestrator does NOT own CSV ingestion in F1.** Server Actions in `apps/dashboard` are the upload entry point. The orchestrator hosts the registry + health + cron skeleton + DLQ helpers, and will host real schedules from F2+.
8. **CSV ingestion boundary (per W1 fix)** — Plan 1.3.5's `commitUpload` Server Action owns the **workflow** (upload → write storage → parse → write raw `raw_csv_rows` → call CSVConnector). Plan 1.2.3's `CSVConnector.ingestUpload` owns the **normalization layer** (`applyColumnMap` + Zod validation + UPSERT to facts/master). `raw_csv_rows.payload_json` is the raw `Record<string,string>` at write time; column-map application happens exactly once, inside `ingestUpload`. Two `grep`-style invariants enforce: `grep -c 'applyColumnMap' apps/dashboard/.../commit-upload.ts` = 0; `grep -c 'applyColumnMap' packages/connectors/src/csv/*.ts` ≥ 1.
9. **`connector_runs.kind` (per W2 fix)** — the `channel` enum is real-channels-only. Non-channel runs (currently only cron heartbeats) live in the `connector_run_kind` enum and are differentiated by `connector_runs.kind`. The CHECK constraint in migration 0008 enforces the coherence rule (`kind='channel'` ⇒ `canal NOT NULL`; `kind='cron-heartbeat'` ⇒ `canal IS NULL`). The `recordConnectorRun` helper enforces the same rule at the call-site.

---

## Revision log

- 2026-05-13: applied PLAN-CHECK.md fixes (B1 + W1..W8). See /home/mandark/faka/.planning/phases/1-foundation/PLAN-CHECK.md for original findings.

---

**End of PLAN.md**
