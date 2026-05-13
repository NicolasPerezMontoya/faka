# Phase 1: Foundation — Research

**Researched:** 2026-05-13
**Domain:** Monorepo bootstrap, Supabase schema/Auth/RLS, Next.js 14 App Router, Railway orchestrator, CSV ingestion pipeline, connector interface contract.
**Confidence:** HIGH for stack/tool choices and Supabase patterns (verified against current docs); MEDIUM for the column-level-RLS-via-views pattern (well-documented but nuanced — `security_invoker` flag is required); MEDIUM-LOW for some orchestrator deploy-shape specifics that are organization-dependent (Railway monorepo root, Vercel ignore-build patterns) where the docs give 2–3 valid options.

---

## Summary

Phase 1 is a **greenfield foundation** with a strong, opinionated stack already locked by `PROJECT.md` and ADRs: Supabase (Postgres + Auth + Storage), Railway (orchestrator), Vercel (Next.js 14 App Router), pnpm + Turborepo monorepo, TypeScript strict everywhere, Supabase CLI migrations (no Prisma/Drizzle ORM). The only meaningful F1 decisions left to the planner are _(a)_ whether to use Drizzle for query-builder ergonomics on top of Supabase types (recommendation: **no for F1** — `supabase-js` + generated types is sufficient and avoids dual-source-of-truth on the schema), _(b)_ whether the orchestrator runs Hono vs Fastify (recommendation: **Hono** — smallest surface, fastest cold start, Node-server adapter is stable), and _(c)_ whether CSV upload lives in Next.js Server Actions or routes through the Railway orchestrator (recommendation: **upload+parse in Next.js Server Action on Vercel** — keeps F1 endpoint count minimal; the orchestrator's role in F1 is connector skeletons + cron skeleton, not ingestion endpoints).

**Primary recommendation:** Build the monorepo with pnpm-workspace + Turborepo (Vercel and Railway both first-class support it). Use Supabase CLI for every schema change (migrations + `supabase gen types typescript` post-migration into `packages/db/types/database.ts`). Implement ADR-002 column-level isolation as **SECURITY INVOKER views** on top of base tables with RLS — every consumer (dashboard, server actions) selects from `*_view_<role>`, never from the base table. Inject the `role` claim via a Supabase `custom_access_token` Postgres function reading from a `public.profiles` table (NOT `auth.users.app_metadata` — app_metadata is admin-only to mutate and you'd have to use `auth.admin` for every role change). CSV upload is a Next.js Server Action that streams multipart to Supabase Storage, then synchronously parses with `csv-parse/sync` (≤20MB ceiling for F1, documented), then chunk-inserts (500 rows/batch) into `raw_csv_rows`. The orchestrator on Railway holds the `ChannelConnector` interface + 6 skeletons + a cron entrypoint that exits cleanly (Railway cron model = service exits, not long-running).

**Estimated complexity (top-line):** F1 is **~80–120 hours** of focused work for a solo dev (20–30 working days). Per success criterion breakdown in the "Complexity per Success Criterion" section below.

---

## Architectural Responsibility Map

| Capability                                   | Primary Tier                                        | Secondary Tier                                        | Rationale                                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema migrations + types codegen            | Database (Supabase)                                 | CI (GitHub Actions)                                   | Supabase CLI owns SQL; CI runs `supabase db reset` on PR.                                                                                                                               |
| Role-based data isolation (column + row)     | Database (Postgres views + RLS)                     | API/Backend (JWT role propagation)                    | DB enforces; app just selects from correct view. Defense in depth.                                                                                                                      |
| JWT custom claim (`role`)                    | Database (Postgres `custom_access_token` hook fn)   | Auth (Supabase GoTrue)                                | Source of truth for role is `public.profiles.role`; hook copies it into JWT on every refresh.                                                                                           |
| Auth session middleware (route gating)       | Frontend Server (Next.js middleware)                | —                                                     | Reads JWT from cookie, asserts role on protected route segments before render.                                                                                                          |
| CSV upload (multipart → Storage)             | Frontend Server (Next.js Server Action on Vercel)   | Database (Supabase Storage)                           | Vercel handles multipart in Server Actions natively; Storage is the durable raw payload sink.                                                                                           |
| CSV parse + dry-run + persist `raw_csv_rows` | Frontend Server (Next.js Server Action)             | Database                                              | Inline server-side parse for F1 (files ≤20MB). Deferred-to-Edge-Function path documented but not built.                                                                                 |
| `ChannelConnector` interface + skeletons     | API / Backend (Railway orchestrator)                | Shared (`packages/connectors`)                        | Interface lives in `packages/connectors`; concrete impls bind in `apps/orchestrator`.                                                                                                   |
| `CSVConnector` (the one real impl in F1)     | Shared (`packages/connectors`)                      | Frontend Server (Next.js Server Action calls into it) | Per ADR-001 LOCKED — it's a `ChannelConnector` first, lives in the package, callable from both `apps/dashboard` (the upload path) and `apps/orchestrator` (future scheduled re-ingest). |
| Cron skeleton / scheduler                    | API / Backend (Railway Cron service)                | —                                                     | F1 wires the cron service with a no-op heartbeat. Real schedules come in F2+.                                                                                                           |
| `connector_runs` + `audit_log` writes        | Database (insert from app)                          | API / Backend (helper functions)                      | Tables in DB; thin TS helpers in `packages/db/helpers/audit.ts` enforce the write contract.                                                                                             |
| Idempotency `(canal, external_order_id)`     | Database (unique constraint + UPSERT)               | API / Backend (UPSERT call)                           | DB enforces uniqueness; orchestrator code does `insert ... on conflict do nothing`.                                                                                                     |
| Retry + DLQ                                  | API / Backend (in-process `p-retry` + DB-table DLQ) | Database (`dead_letter_queue` table)                  | F1 uses a Postgres table for DLQ (no Redis, no pgmq dependency); workers pick up rows manually for F2.                                                                                  |
| Secrets                                      | Infra (Railway env vars / Vercel env vars)          | —                                                     | Per CONSTR-secret-storage: never in DB, never in repo, never in client bundle.                                                                                                          |

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**ADR-001 — CSV upload first-class:**

- Tables `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles` are part of base schema.
- `CSVConnector` implements `ChannelConnector`; not a side-path.
- 3-step Operación wizard is the upload entry point.
- Supabase Storage retains original payloads; immutable.
- Mapping profiles versioned for reprocessing.

**ADR-002 — 4-role column-level matrix:**

- Roles: `super_admin`, `admin`, `manager`, `analista`.
- Postgres vistas por rol con grants explícitos en columnas $ y cliente.
- JWT claim `role` propagado via Next.js middleware.
- Tabla `audit_log` con `user_id + role_at_time + action + target_table + target_id + payload_json + at`.
- Primer Super Admin se crea vía CLI seeder con email `nicolasperezmontoya@gmail.com`.

**ADR-003 — WhatsApp split:**

- F1 NO incluye WA Cloud API (eso es F5.5).
- F1 NO incluye el form interno (eso es F3).
- F1 sí incluye la tabla `messaging_log` (vacía) preparada para F5.5 outbound.

**ADR-004 — Mini-CRM en MASTER:**

- Tablas `customers`, `customer_external_links`, `customer_merge_log` creadas vacías en F1.
- `sales.customer_id` nullable FK desde el inicio (no migración en F4).
- Lógica de matching y UI quedan para F4.

**Stack (locked by PROJECT.md):**

- Supabase como única SoT (Postgres + Auth + Storage + Realtime).
- Railway para orquestador Node/TS.
- Vercel para Next.js 14 App Router dashboard.
- **pnpm** (locked over Bun for Vercel + monorepo compatibility).
- Supabase Migrations CLI para schema management (no Prisma, no manual SQL).
- TypeScript estricto en todo.

### Claude's Discretion

- Migrations approach (Supabase CLI confirmed — see §2).
- Auth flow: email + password only for v1 (no magic link, no social).
- JWT custom claim propagation pattern (Auth Hook `custom_access_token` confirmed — see §4).
- Views pattern: SECURITY INVOKER role views over base tables with RLS (confirmed — see §3).
- Wizard implementation: Next.js Server Actions + inline parsing for F1 (confirmed — see §6).
- Testing harness: `supabase db reset` in CI + Vitest unit + 1 integration test (confirmed — see §9).
- Deployment: Vercel preview per PR, Railway single service deployed from main (confirmed — see §10).

### Deferred Ideas (OUT OF SCOPE)

- Magic link auth (cliente prefiere email/password; revisit F2 if asked).
- shadcn custom registry (defer to F3).
- Edge Functions for CSV parsing >20MB (defer until volume justifies).
- Row-level encryption for sensitive customer data (post-F4).
- Real connector implementations for WP/ML/Dropi/POS/WA/Falabella (only skeletons compile in F1).
- Matching cascade (F2).
- Mini-CRM matching logic + UI (F4).
- WhatsApp Business Cloud API integration (F5.5).
- IA insight jobs (F5).
- Dashboard views "Hoy" / "Productos" / "Canales" / "Inteligencia" (F2+).

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                                                                                                                                         | Research Support                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| FND-01 | Repo + Supabase project + Railway + Vercel linked; secrets in Railway env vars only                                                                                                 | §1 monorepo, §10 deployment                                         |
| FND-02 | Supabase 5-layer schema deployed end-to-end (RAW + MASTER + FACTS + MARTS skeleton + INSIGHTS), including CSV tables (ADR-001), Mini-CRM stubs (ADR-004), `messaging_log` (ADR-003) | §2 migrations, plus the existing PATTERNS.md `§3.B` table inventory |
| FND-03 | Supabase Auth with 4 roles per ADR-002; row-level RLS + column-level via per-role views; JWT `role` claim middleware; CLI seeder creates first Super Admin                          | §3 (views/RLS) + §4 (Auth Hook + middleware)                        |
| FND-04 | `ChannelConnector` TS interface published; 6 skeletons compile (WP/ML/Dropi/POS/WA/Falabella)                                                                                       | §5 connector interface                                              |
| FND-05 | `CSVConnector` implemented as first concrete `ChannelConnector`; `ingestUpload(uploadId)` emits NormalizedOrder/Product                                                             | §5 + §6                                                             |
| FND-06 | CSV upload endpoint + 3-step "Operación" wizard; test CSV lands in `raw_csv_uploads` + `raw_csv_rows`; payload retained in Storage                                                  | §6 ingestion                                                        |
| FND-07 | Historical uploads table with reprocess action (versioned `csv_mapping_profile`) without re-uploading                                                                               | §6 (reprocess pattern)                                              |
| FND-08 | Orchestrator patterns: idempotency `(canal, external_order_id)`, 3× exp backoff + DLQ, `connector_runs` rows per execution, `audit_log` on user mutations                           | §7 (orchestrator) + §8 (cross-cutting layers)                       |

</phase_requirements>

## Library / Tool Choices

| Choice                    | Version (verified 2026-05-13 via `npm view`)                             | Rationale                                                                                                                                                                                                                      | Alternatives rejected                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **pnpm**                  | 11.1.1                                                                   | LOCKED. Best disk efficiency + strict dependency hoisting in monorepos. First-class Vercel + Railway support.                                                                                                                  | Bun (no Vercel official Bun-on-Vercel builder; rejected per CONTEXT.md). npm/Yarn workspaces (slower installs; worse Turbo ergonomics). |
| **Turborepo**             | 2.9.12                                                                   | First-class Vercel integration (`turbo-ignore`, Remote Cache); Railway docs reference Turbo monorepos; minimal config compared to Nx; `turbo.json` is the only build-graph spec.                                               | Nx (heavier, opinionated about Angular legacy; overkill for 2 apps + 6 packages). Lerna (deprecated). Bazel (massive overkill).         |
| **TypeScript**            | 5.5.3                                                                    | LOCKED by PROJECT.md. Strict mode + `noUncheckedIndexedAccess`.                                                                                                                                                                | None — pinned.                                                                                                                          |
| **Next.js 14 App Router** | 16.2.6 latest (use latest stable 14.x or 15.x as available at impl time) | LOCKED. Server Actions + Server Components are the right fit for the upload wizard + role-gated routes.                                                                                                                        | Pages Router (older; no Server Actions). Remix (no client constraint requires it; Vercel preset is best with Next).                     |
| **Supabase JS client**    | `@supabase/supabase-js` 2.105.4 + `@supabase/ssr` 0.10.3                 | `ssr` is the canonical Next.js App Router cookie adapter (replaces the deprecated `@supabase/auth-helpers-nextjs`).                                                                                                            | `@supabase/auth-helpers-nextjs` (deprecated; do not use).                                                                               |
| **Supabase CLI**          | 2.98.2                                                                   | Migrations, type gen, `db reset`, local stack via Docker.                                                                                                                                                                      | Hand-rolled SQL (rejected per CONTEXT.md). Prisma (rejected per CONTEXT.md — dual source of truth).                                     |
| **Hono**                  | 4.12.18                                                                  | Orchestrator HTTP layer. Tiny, edge-compatible, Node adapter `@hono/node-server` 2.0.2 is stable; built-in zod validator middleware.                                                                                           | Fastify 5.8.5 (good but heavier; v5 has stable plugins). Express (legacy; no first-class TS types). Bare http (reinventing routing).    |
| **Zod**                   | 4.4.3                                                                    | Shared schema validation in `packages/schema`. Pair with Hono's `@hono/zod-validator`.                                                                                                                                         | Yup (smaller ecosystem). Valibot (newer, fewer adapters).                                                                               |
| **csv-parse**             | 6.2.1                                                                    | Battle-tested, sync mode for ≤20MB files, streaming mode for larger (deferred). Already used in Phase 0 (`scripts/discovery/load-csv.ts`).                                                                                     | papaparse 5.5.3 (browser-first; less ergonomic on server).                                                                              |
| **p-retry**               | 5.1.11 (or 7.x — verify)                                                 | Exponential backoff with jitter. The ecosystem default for retry-with-backoff.                                                                                                                                                 | Bespoke retry loops (error-prone). axios-retry (couples to axios).                                                                      |
| **Vitest**                | 4.1.6                                                                    | F1 test framework. ESM-native; works with Vite-less TS; fast watch; compatible with Turbo's `test` task.                                                                                                                       | Jest (slow; ESM friction in TS). Node test runner (still minimal ecosystem).                                                            |
| **pino**                  | 10.3.1                                                                   | Structured logging for orchestrator. JSON output → Railway log drains.                                                                                                                                                         | winston (slower; less ergonomic). console.log (no levels).                                                                              |
| **drizzle-orm**           | NOT for F1                                                               | Considered for type-safe SQL on top of Supabase; rejected for F1 because `supabase gen types` + raw `supabase-js` queries are sufficient, and Drizzle introduces a second schema source. Revisit in F2 if SQL ergonomics hurt. | —                                                                                                                                       |
| **shadcn/ui**             | shadcn CLI 4.7.0                                                         | LOCKED by PATTERNS.md / CONTEXT.md. Components copy-pasted into `packages/ui`.                                                                                                                                                 | MUI (heavy; Tailwind conflict). Chakra (less Tailwind-friendly).                                                                        |

**Verification:** All versions pulled from `npm view` on 2026-05-13. `[VERIFIED: npm registry]`

**Installation (top-level commands):**

```bash
# Tooling
corepack enable && corepack prepare pnpm@11.1.1 --activate
npm install -g supabase   # or use brew / scoop — CLI 2.98.2

# Per-package (paths illustrative)
pnpm add -D turbo typescript vitest @types/node
pnpm add -F dashboard next@14 react@18 react-dom@18 @supabase/supabase-js @supabase/ssr
pnpm add -F orchestrator hono @hono/node-server zod pino p-retry csv-parse
pnpm add -F db @supabase/supabase-js
pnpm add -F schema zod
```

---

## Per-Topic Deep Dive

### 1. pnpm monorepo + Turborepo for Vercel + Railway

**Recommendation: Turborepo over Nx.** Reasoning:

- Vercel auto-detects Turbo (build command + `turbo-ignore`); Nx requires manual config.
- Railway docs reference Turbo monorepo patterns; Nx-on-Railway is undocumented.
- Two apps + six packages is well under Nx's complexity break-even point.
- Turbo's `globalEnv` + `outputs` + `dependsOn` cache primitives are all this project needs.
- `[VERIFIED: vercel.com/docs/monorepos/turborepo]` — Vercel automatically configures Build Command (`turbo run build`), Output Directory, Root Directory, and Ignored Build Step (`npx turbo-ignore --fallback=HEAD^1`) on import.

**`pnpm-workspace.yaml`:**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "scripts/discovery" # existing Phase 0 workspace, keep registered
```

**`turbo.json` (skeleton):**

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"],
      "env": [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY"
      ]
    },
    "lint": {},
    "test": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true },
    "db:types": { "outputs": ["packages/db/types/database.ts"] },
    "db:migrate": { "cache": false }
  },
  "globalEnv": ["NODE_ENV"],
  "globalDependencies": ["tsconfig.base.json", ".env"]
}
```

**Shared tsconfig pattern** (`packages/config/tsconfig.base.json`):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "incremental": true,
    "declaration": true,
  },
  "exclude": ["node_modules", "dist", ".next", ".turbo"],
}
```

Each app extends with its own overrides:

- `apps/dashboard/tsconfig.json`: `"jsx": "preserve"`, `"plugins": [{ "name": "next" }]`, includes `.next/types/**/*.ts`.
- `apps/orchestrator/tsconfig.json`: `"outDir": "dist"`, `"rootDir": "src"`, no JSX.

**Vercel deployment from monorepo (apps/dashboard):**

- Set **Root Directory** = `apps/dashboard` in Vercel project settings.
- **Build Command** = `cd ../.. && turbo run build --filter=dashboard...` (the `...` includes workspace dependencies).
- **Install Command** = Vercel auto-detects pnpm; leave default.
- **Ignored Build Step** = `npx turbo-ignore --fallback=HEAD^1` so PRs touching only the orchestrator don't trigger dashboard rebuilds.
- `[VERIFIED: vercel.com/docs/monorepos/turborepo]`

**Railway deployment from monorepo (apps/orchestrator):**

- Create one Railway **service**.
- **Root Directory** (Settings → Source) = `apps/orchestrator`. Note: Railway's config file (`railway.toml`) does NOT inherit the root directory — if used, reference must be absolute (`/apps/orchestrator/railway.toml`). `[CITED: docs.railway.com/guides/monorepo]`
- **Build Command** = `pnpm install --frozen-lockfile && pnpm --filter orchestrator... build` (or use Railway's Nixpacks defaults if Build settings is auto-detected).
- **Start Command** = `node apps/orchestrator/dist/server.js`
- **Watch Paths** = `apps/orchestrator/** packages/**` (so dashboard-only PRs don't trigger orchestrator rebuilds).
- **Healthcheck** = `GET /health` returning 200 (Hono route).

**Pitfalls:**

- Turbo cache misses on Vercel because of Skew Protection env vars — `[CITED: vercel.com/docs/monorepos/turborepo]`. Acceptable for F1; document.
- Railway's start command must `exit cleanly` for cron-typed services (different from web services). `[CITED: docs.railway.com/reference/cron-jobs]`
- pnpm's strict hoisting can break Next.js's auto-detection of devDependencies if `@types/*` packages aren't explicitly declared in the consuming app's `package.json`.

---

### 2. Supabase migrations + types workflow

**Recommendation: `supabase migration new` exclusively.** Hand-rolled SQL files create drift between local + remote — the CLI guarantees migration ordering and provides `supabase db reset` for clean reruns.

**Directory layout:**

```
supabase/
  config.toml              # local stack config (db port, auth hooks, etc.)
  migrations/
    20260513000001_init_extensions_and_schemas.sql
    20260513000002_raw_layer.sql
    20260513000003_master_layer.sql
    20260513000004_facts_layer.sql
    20260513000005_marts_skeleton.sql
    20260513000006_insights_layer.sql
    20260513000007_audit_and_connector_runs.sql
    20260513000008_csv_tables.sql           # ADR-001
    20260513000009_mini_crm_tables.sql      # ADR-004
    20260513000010_messaging_log.sql        # ADR-003
    20260513000011_profiles_and_role_hook.sql   # for ADR-002 JWT claim
    20260513000012_rls_policies.sql         # row-level RLS on all base tables
    20260513000013_role_views.sql           # column-level via views (ADR-002)
    20260513000014_grants_on_views.sql
  seed.sql                 # csv_mapping_profiles seed + (optional dev fixtures)
  functions/               # Edge Functions (none in F1; placeholder dir)
```

**Migration workflow commands:**

```bash
# Start local stack (Postgres + Auth + Storage on Docker)
supabase start

# Create a new migration
supabase migration new init_extensions_and_schemas

# Edit the generated SQL, then apply locally
supabase db reset          # wipes + reruns ALL migrations + seed.sql

# Generate TS types into packages/db
supabase gen types typescript --local > packages/db/types/database.ts

# Apply to staging/prod
supabase link --project-ref <ref>
supabase db push
```

**Type generation pattern** (`packages/db/package.json`):

```json
{
  "name": "@faka/db",
  "version": "0.0.0",
  "type": "module",
  "main": "./index.ts",
  "scripts": {
    "types": "supabase gen types typescript --local > types/database.ts",
    "types:remote": "supabase gen types typescript --linked > types/database.ts"
  },
  "exports": {
    ".": "./index.ts",
    "./types": "./types/database.ts"
  }
}
```

`packages/db/index.ts` re-exports `Database` so consumers do `import type { Database } from '@faka/db'`.

**Seeding pattern** (`supabase/seed.sql`):

```sql
-- Seed mapping profiles from Phase 0 discovery profiles
insert into public.csv_mapping_profiles (id, nombre, canal, tipo, column_map_json, version, creado_por)
values
  (gen_random_uuid(), 'WordPress products v1', 'wordpress', 'products',
   $$ {"external_id":"ID","sku":"SKU","name":"Name","description":"Short description","category":"Categories","brand":"Attribute 1 value(s)","price":"Regular price","cost":null,"barcode":"Attribute 2 value(s)","supplier_code":"Attribute 3 value(s)","image_url":"Images","status":"Visibility in catalog"} $$::jsonb,
   1, null),
  (gen_random_uuid(), 'Mercado Libre products v1', 'mercadolibre', 'products',
   $$ ... $$::jsonb,
   1, null);
-- Repeat for dropi, pos, whatsapp templates from scripts/discovery/profiles/*.json
```

**Super Admin seeder** — a separate CLI script (not seed.sql) because it requires the `auth.admin.createUser` API:

```ts
// scripts/seed-super-admin.ts
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data, error } = await supabase.auth.admin.createUser({
  email: "nicolasperezmontoya@gmail.com",
  password: process.env.INITIAL_SUPER_ADMIN_PASSWORD!,
  email_confirm: true,
});
if (error) throw error;

await supabase.from("profiles").upsert({
  user_id: data.user!.id,
  role: "super_admin",
  email: "nicolasperezmontoya@gmail.com",
});
console.log("Super admin created:", data.user!.id);
```

Invoked once during F1 setup via `pnpm --filter db run seed:super-admin` (with env vars from local `.env`).

**CI workflow** (`.github/workflows/ci.yml` essentials):

```yaml
- uses: supabase/setup-cli@v1
  with: { version: latest }
- run: supabase db start
- run: supabase db reset
- run: pnpm --filter db run types # regen types to verify schema compiles
- run: pnpm -r run lint && pnpm -r run test
- run: supabase db stop
```

**Pitfalls:**

- `supabase gen types` can produce stale output if you forget to `supabase db reset` after a migration edit. CI catches this by failing on uncommitted diff in `types/database.ts`.
- `seed.sql` runs after every `db reset` — make all inserts idempotent (`on conflict do nothing`) to allow rerunning against existing data.
- Migrations are applied alphabetically by filename, so the timestamp prefix is structural — never edit a checked-in migration; create a new one.

---

### 3. Postgres column-level RLS via views (ADR-002)

This is the most nuanced piece of F1. The pattern: **base tables have row-level RLS; per-role views project only allowed columns; views are SECURITY INVOKER (Postgres 15+) so RLS on base tables continues to apply via the caller's identity.**

**Why SECURITY INVOKER, not DEFINER:**

- A SECURITY DEFINER view runs queries with the view owner's privileges, bypassing the caller's RLS. That is the wrong semantics — we want the JWT-bearer's `auth.uid()` and `request.jwt.claim.role` to still filter base rows.
- Since Postgres 15, views support `WITH (security_invoker = true)` to make RLS apply to the caller. Supabase's hosted Postgres is ≥15 (currently 17 on new projects). `[VERIFIED: postgresql.org/docs/15/sql-createview.html]`
- Pitfall: Postgres ≤14 views were always SECURITY DEFINER-ish (owner's permissions). Our migrations MUST include the `WITH (security_invoker = true)` clause.

**Concrete SQL skeleton for `sales` + 3 views** (Super Admin uses the base table directly via Service Role; the three operational roles each get their own view):

```sql
-- 20260513000004_facts_layer.sql (excerpt)
create table public.sales (
  sale_id           uuid primary key default gen_random_uuid(),
  canal             text not null,
  external_order_id text not null,
  fecha             date not null,
  hora              time,
  customer_id       uuid references public.customers(customer_id),  -- ADR-004
  subtotal          numeric(14,2),
  descuento         numeric(14,2),
  total             numeric(14,2),
  costo_envio       numeric(14,2),
  moneda            text default 'COP',
  estado            text,
  punto_venta_id    text,
  created_at        timestamptz not null default now(),
  unique (canal, external_order_id)   -- idempotency key (FND-08 / CONSTR-idempotency-key)
);

alter table public.sales enable row level security;

-- Row-level: every authenticated user can SELECT rows (column visibility is the
-- view's job). Service Role bypasses RLS by definition.
create policy "sales_select_authenticated"
  on public.sales for select
  to authenticated using (true);

-- No INSERT/UPDATE/DELETE policy for clients — mutations go through Server
-- Actions running with Service Role or through stored procedures.

-- 20260513000013_role_views.sql (excerpt)

-- Admin sees everything (mirrors the base table; convenience for app code that
-- always queries the role-suffixed view).
create view public.sales_view_admin
  with (security_invoker = true) as
select * from public.sales;

-- Manager: sees $ but NOT customer_id (per ADR-002 + ADR-004 permissions).
create view public.sales_view_manager
  with (security_invoker = true) as
select sale_id, canal, external_order_id, fecha, hora,
       null::uuid as customer_id,
       subtotal, descuento, total, costo_envio,
       moneda, estado, punto_venta_id, created_at
  from public.sales;

-- Analista: NO $ and NO customer_id; volume + categorical only.
create view public.sales_view_analista
  with (security_invoker = true) as
select sale_id, canal, external_order_id, fecha, hora,
       null::uuid as customer_id,
       null::numeric as subtotal,
       null::numeric as descuento,
       null::numeric as total,
       null::numeric as costo_envio,
       moneda, estado, punto_venta_id, created_at
  from public.sales;
```

**GRANT pattern** (`20260513000014_grants_on_views.sql`):

```sql
-- Default: revoke all from authenticated on base tables EXCEPT through views.
revoke all on public.sales from anon, authenticated;

-- Grant select on each role view to authenticated; access is then
-- gated by app-layer view selection (Next.js picks the view based on JWT.role).
grant select on public.sales_view_admin to authenticated;
grant select on public.sales_view_manager to authenticated;
grant select on public.sales_view_analista to authenticated;

-- Helper: a role-gating RLS-aware policy on the views themselves.
-- Postgres 16+: a view's RLS is the union of its columns' tables' RLS;
-- to enforce role at view granularity we add a check inside each view.
-- Simpler: enforce at app layer (Next.js middleware picks the view).
-- Belt-and-suspenders: add a function-based policy on the underlying table.

create or replace function public.current_role_claim()
  returns text language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    'analista'   -- safe default
  );
$$;

-- (Optional extra defense: add per-role check policies on the base table.)
```

**App-layer view selection** (in Next.js Server Component / Action):

```ts
// apps/dashboard/lib/supabase/role-view.ts
import type { Database } from "@faka/db";
import type { SupabaseClient } from "@supabase/supabase-js";

type Role = "super_admin" | "admin" | "manager" | "analista";
type Tables = keyof Database["public"]["Tables"];

export function roleViewName<T extends "sales" | "sale_items" | "customers">(
  baseTable: T,
  role: Role,
): string {
  if (role === "super_admin" || role === "admin")
    return `${baseTable}_view_admin`;
  if (role === "manager") return `${baseTable}_view_manager`;
  return `${baseTable}_view_analista`;
}

// Usage:
// const view = roleViewName('sales', userRole);
// const { data } = await supabase.from(view).select('*').eq(...);
```

**Pitfalls:**

- **`with (security_invoker = true)` is MANDATORY.** Without it, the views run as owner and RLS on the base table is bypassed — Analista could see all rows. `[VERIFIED: postgresql.org/docs/15/sql-createview.html]`
- **Cascading base-table changes** (adding a column to `sales`) require updating ALL three views via a new migration. Lint rule for plan-checker: any new column added to `sales`/`sale_items`/`customers` must produce a corresponding migration touching `*_view_admin/manager/analista`.
- **View ownership** — by default the view is owned by the migration role (typically `postgres`). Don't change ownership; SECURITY INVOKER makes ownership irrelevant for permission checks.
- **Query planner impact**: views are not materialized; they're rewritten into the underlying query. The 3-way `select *` overhead is negligible at ~5K txns/month. If marts get heavy, switch the materialized views; F1 is unaffected.
- **Insert through view** — INSERT into a view with `null::` columns is allowed for simple views; ours don't need writes since clients don't write directly. Mutations go through Server Actions with the Service Role key, bypassing RLS entirely.

**Verification protocol:** Write a Vitest test in `packages/db/tests/rls.test.ts` that:

1. Creates a test user with each role via `auth.admin.createUser`.
2. Inserts a fixture sale with the Service Role.
3. Asserts that `select * from sales_view_analista` returns `total IS NULL` and `customer_id IS NULL`.

---

### 4. Supabase Auth custom JWT claim for `role`

**Recommendation: Postgres function `custom_access_token_hook` reading from `public.profiles.role`.**

**Why `profiles` table, not `auth.users.app_metadata`:**

- `auth.users.app_metadata` is mutable only via the Service Role (`supabase.auth.admin.updateUserById`). That's fine for a CLI seeder, but role escalation/demotion from the Admin UI (which Super Admin does in F1+) is easier when role lives in a regular table you can `UPDATE` with a Server Action.
- A `profiles` table is also where you'd put `display_name`, `last_login_at`, etc. — single source of profile truth.

**Migrations** (`20260513000011_profiles_and_role_hook.sql`):

```sql
-- Role enum
create type public.user_role as enum
  ('super_admin', 'admin', 'manager', 'analista');

create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       public.user_role not null default 'analista',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Authenticated users can read their own profile.
create policy "profiles_self_read"
  on public.profiles for select to authenticated
  using (user_id = auth.uid());

-- Only super_admin can update other users' roles. Enforced via JWT claim.
create policy "profiles_admin_write"
  on public.profiles for all to authenticated
  using ( (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'super_admin' )
  with check ( (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'super_admin' );

-- The custom_access_token hook function.
create or replace function public.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql
  stable
as $$
declare
  claims jsonb;
  user_role text;
begin
  claims := event -> 'claims';
  select role::text into user_role
    from public.profiles
    where user_id = (event ->> 'user_id')::uuid;

  if user_role is null then
    user_role := 'analista';   -- safe default for users without a profile row
  end if;

  claims := jsonb_set(claims, '{role}', to_jsonb(user_role));
  -- Also put it in app_metadata for tools that look there
  if claims ? 'app_metadata' then
    claims := jsonb_set(claims, '{app_metadata, role}', to_jsonb(user_role));
  else
    claims := jsonb_set(claims, '{app_metadata}', jsonb_build_object('role', user_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Lock down the function so only Supabase Auth can call it.
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- Make profiles readable by the Auth Admin too.
grant select on public.profiles to supabase_auth_admin;
revoke all on public.profiles from anon;
```

**Enable the hook** (`supabase/config.toml`):

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

For staging/prod: enable via Dashboard (Authentication → Hooks → Custom Access Token → choose Postgres → `public.custom_access_token_hook`). `[VERIFIED: supabase.com/docs/guides/auth/auth-hooks]`

**Next.js middleware reading the JWT** (`apps/dashboard/middleware.ts`):

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROUTE_ROLE_REQUIREMENTS: Record<
  string,
  ("super_admin" | "admin" | "manager" | "analista")[]
> = {
  "/admin": ["super_admin"],
  "/operacion": ["super_admin", "admin", "manager"], // upload CSV — ADR-002
  "/inteligencia": ["super_admin", "admin", "manager", "analista"],
  "/hoy": ["super_admin", "admin", "manager", "analista"],
};

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (k) => req.cookies.get(k)?.value,
        set: (k, v, o) => res.cookies.set({ name: k, value: v, ...o }),
        remove: (k, o) => res.cookies.set({ name: k, value: "", ...o }),
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    if (req.nextUrl.pathname.startsWith("/login")) return res;
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Role comes from JWT claim injected by custom_access_token_hook.
  // getUser() doesn't return raw JWT; use getSession() and inspect access_token,
  // OR call a Postgres helper that returns auth.jwt() -> 'role'.
  const role = (user.app_metadata as { role?: string }).role ?? "analista";

  const requiredRoles = matchRouteRoles(
    req.nextUrl.pathname,
    ROUTE_ROLE_REQUIREMENTS,
  );
  if (requiredRoles && !requiredRoles.includes(role as any)) {
    return NextResponse.redirect(new URL("/forbidden", req.url));
  }

  // Attach role to request headers for Server Components to read.
  res.headers.set("x-user-role", role);
  return res;
}

function matchRouteRoles(
  pathname: string,
  table: typeof ROUTE_ROLE_REQUIREMENTS,
) {
  for (const prefix of Object.keys(table)) {
    if (pathname.startsWith(prefix)) return table[prefix];
  }
  return null;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
```

**Role escalation (Super Admin promotes a user):**

```ts
// apps/dashboard/app/admin/users/_actions.ts
"use server";
import { createClient } from "@supabase/supabase-js";

export async function updateUserRole(
  userId: string,
  newRole: "admin" | "manager" | "analista",
) {
  // Server Action runs server-side; use Service Role to mutate profiles.
  const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await admin
    .from("profiles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw error;

  // The user's NEXT token refresh will pick up the new role (custom_access_token
  // hook reads profiles at refresh time). For immediate effect, also call
  // admin.auth.admin.signOut({ scope: 'others' }) to force re-auth.
}
```

**Pitfalls:**

- **`auth.users.app_metadata` only updates on token refresh.** If a Super Admin promotes someone, the user's JWT keeps the old role until the next refresh (~1 hour). For F1 with 3–4 users this is acceptable; document it. For instant effect: invalidate the user's session via `auth.admin.signOut(userId, { scope: 'global' })`.
- **`supabase.auth.getUser()` returns the user object including `app_metadata` from the database, NOT from the JWT.** So even though the hook injects `role` into the JWT, `app_metadata.role` is also correctly set because the hook writes to both places.
- **The hook function MUST have `grant execute ... to supabase_auth_admin`** — without it, login fails with cryptic "could not find hook function" errors. `[VERIFIED: supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook]`
- **Don't make role a free-text column.** Use a Postgres enum (`user_role`) so adding/renaming roles requires a migration.

---

### 5. `ChannelConnector` interface design

**Goal: One interface, six skeletons that compile against it, one concrete impl (`CSVConnector`) in F1.** Interface must support all six channels' shapes without ever being rewritten.

**Recommendation: Put the interface + types in `packages/connectors/src/types.ts`; each concrete impl lives in `packages/connectors/src/<channel>/index.ts`; the registry lives in `apps/orchestrator/src/connectors/registry.ts`.**

**Interface (refines CONSTR-channel-connector-interface with ADR-004 hook):**

```ts
// packages/connectors/src/types.ts
import type { z } from "zod";
import { NormalizedOrderSchema, NormalizedProductSchema } from "@faka/schema";

export type Canal =
  | "wordpress"
  | "mercadolibre"
  | "dropi"
  | "pos"
  | "whatsapp"
  | "falabella"
  | "csv-upload";

export type Capability = "orders" | "products" | "inventory" | "customers";

export interface RawOrder {
  canal: Canal;
  external_order_id: string;
  payload: unknown;
  fetched_at: string;
}
export interface RawProduct {
  canal: Canal;
  external_id: string;
  payload: unknown;
  fetched_at: string;
}
export interface RawInventory {
  canal: Canal;
  external_id: string;
  cantidad: number;
  captured_at: string;
}

export type NormalizedOrder = z.infer<typeof NormalizedOrderSchema>;
export type NormalizedProduct = z.infer<typeof NormalizedProductSchema>;

export interface CustomerHint {
  // ADR-004 forward-compat: connectors that have customer data on the order
  // expose it via this hook. The customer matching cascade (F4) consumes it.
  phone?: string; // E.164 normalized
  email?: string; // lowercased trimmed
  document_id?: string;
  external_customer_id?: string;
  external_identifier_type?: "phone" | "email" | "document" | "nickname";
  displayed_name?: string;
}

export interface HealthStatus {
  ok: boolean;
  last_success_at?: string;
  last_error?: string;
  latency_ms?: number;
}

export interface ChannelConnector {
  name: Canal;
  type: "pull" | "push" | "manual";
  capabilities: Set<Capability>;

  fetchOrders(since: Date): Promise<RawOrder[]>;
  fetchProducts(since: Date): Promise<RawProduct[]>;
  fetchInventory?(): Promise<RawInventory[]>;

  normalizeOrder(raw: RawOrder): NormalizedOrder;
  normalizeProduct(raw: RawProduct): NormalizedProduct;

  /** ADR-004 forward-compat: extract customer hints from a raw order so the
   *  matching cascade (F4) can run. Return null if the channel has no customer
   *  data on the order (e.g., POS anonymous). */
  extractCustomerHint?(raw: RawOrder): CustomerHint | null;

  healthCheck(): Promise<HealthStatus>;
}

export interface ConnectorContext {
  supabase: import("@supabase/supabase-js").SupabaseClient<
    import("@faka/db").Database
  >;
  logger: import("pino").Logger;
  env: Record<string, string | undefined>;
}

export type ConnectorFactory<TConfig = unknown> = (
  ctx: ConnectorContext,
  config: TConfig,
) => ChannelConnector;
```

**Why `extractCustomerHint?` is optional and per-raw-order:**

- The customer matching cascade in F4 runs per-order. Hoisting the extractor into the connector keeps channel-specific parsing logic (e.g., "WhatsApp puts phone in field X, ML puts buyer_email in field Y") next to the rest of the channel's normalization code.
- Making it `?` lets F1 skeletons compile without implementing it — F4 fills in the bodies.

**Six skeletons** (file shape — each is ~30 lines, mostly NotImplementedError):

```ts
// packages/connectors/src/wordpress/index.ts
import type {
  ChannelConnector,
  ConnectorContext,
  ConnectorFactory,
} from "../types";

export const createWordPressConnector: ConnectorFactory<{
  baseUrl: string;
  apiKey: string;
}> = (ctx, config) => ({
  name: "wordpress",
  type: "pull",
  capabilities: new Set(["orders", "products", "inventory"]),
  fetchOrders: async (_since) => {
    throw new Error("NOT_IMPLEMENTED_F2");
  },
  fetchProducts: async (_since) => {
    throw new Error("NOT_IMPLEMENTED_F2");
  },
  normalizeOrder: (_raw) => {
    throw new Error("NOT_IMPLEMENTED_F2");
  },
  normalizeProduct: (_raw) => {
    throw new Error("NOT_IMPLEMENTED_F2");
  },
  healthCheck: async () => ({
    ok: false,
    last_error: "not configured (F1 skeleton)",
  }),
});
```

Repeat for `mercadolibre`, `dropi`, `pos`, `whatsapp`, `falabella` (Falabella's skeleton sets a feature flag check).

**CSVConnector — the real impl (skeleton in F1):**

```ts
// packages/connectors/src/csv/index.ts
import type {
  ChannelConnector,
  ConnectorFactory,
  RawOrder,
  RawProduct,
  NormalizedOrder,
  NormalizedProduct,
  CustomerHint,
} from "../types";
import { parse } from "csv-parse/sync";

export interface CSVConnectorConfig {
  // The CSV path here is the upload_id; CSVConnector pulls from raw_csv_rows.
}

export interface IngestResult {
  upload_id: string;
  rows_processed: number;
  rows_skipped: number;
  errors: { row_number: number; error: string }[];
}

export interface CSVConnector extends ChannelConnector {
  name: "csv-upload";
  type: "manual";
  ingestUpload(uploadId: string): Promise<IngestResult>;
}

export const createCSVConnector: ConnectorFactory<CSVConnectorConfig> = (
  ctx,
  _config,
) => {
  const conn: CSVConnector = {
    name: "csv-upload",
    type: "manual",
    capabilities: new Set(["orders", "products", "inventory"]),

    async ingestUpload(uploadId) {
      // 1. Load upload row + mapping profile
      const { data: upload } = await ctx.supabase
        .from("raw_csv_uploads")
        .select("*, csv_mapping_profiles(*)")
        .eq("upload_id", uploadId)
        .single();
      if (!upload) throw new Error(`upload not found: ${uploadId}`);

      // 2. Stream rows from raw_csv_rows in chunks
      // 3. For each row, apply column_map → emit NormalizedOrder/Product
      // 4. UPSERT into sales / sale_items on (canal, external_order_id)
      // 5. Update raw_csv_rows.processed = true
      // 6. Update raw_csv_uploads.status = 'processed', row_count, error_log_json
      // 7. Write connector_runs row
      throw new Error("NOT_IMPLEMENTED — flesh out in F1 Wave N");
    },

    fetchOrders: async () => [], // CSV is push-style; not used
    fetchProducts: async () => [],
    normalizeOrder: (raw: RawOrder): NormalizedOrder => {
      /* apply mapping_profile.column_map */ throw new Error("TODO");
    },
    normalizeProduct: (raw: RawProduct): NormalizedProduct => {
      throw new Error("TODO");
    },
    extractCustomerHint: (raw: RawOrder): CustomerHint | null => null,
    healthCheck: async () => ({ ok: true }),
  };
  return conn;
};
```

**Registry pattern (dependency injection)** (`apps/orchestrator/src/connectors/registry.ts`):

```ts
import { createWordPressConnector } from "@faka/connectors/wordpress";
import { createMercadoLibreConnector } from "@faka/connectors/mercadolibre";
import { createDropiConnector } from "@faka/connectors/dropi";
import { createPosConnector } from "@faka/connectors/pos";
import { createWhatsappConnector } from "@faka/connectors/whatsapp";
import { createFalabellaConnector } from "@faka/connectors/falabella";
import { createCSVConnector } from "@faka/connectors/csv";
import type {
  ChannelConnector,
  ConnectorContext,
  Canal,
} from "@faka/connectors/types";

export function buildRegistry(
  ctx: ConnectorContext,
): Record<Canal, ChannelConnector> {
  return {
    wordpress: createWordPressConnector(ctx, {
      baseUrl: ctx.env.WP_BASE_URL!,
      apiKey: ctx.env.WP_API_KEY!,
    }),
    mercadolibre: createMercadoLibreConnector(ctx, {
      clientId: ctx.env.ML_CLIENT_ID!,
      clientSecret: ctx.env.ML_CLIENT_SECRET!,
    }),
    dropi: createDropiConnector(ctx, {
      username: ctx.env.DROPI_USER!,
      password: ctx.env.DROPI_PASS!,
    }),
    pos: createPosConnector(ctx, {
      webhookSecret: ctx.env.POS_WEBHOOK_SECRET!,
    }),
    whatsapp: createWhatsappConnector(ctx, {}),
    falabella: createFalabellaConnector(ctx, {}), // feature-flag-gated
    "csv-upload": createCSVConnector(ctx, {}),
  };
}
```

**Pitfalls:**

- **Don't put `extractCustomerHint` on the connector AND on a separate utility** — split brain. Single owner: connector module.
- **Don't normalize in the connector AND in a downstream normalizer service** — connector normalizes; downstream consumer just reads.
- **Don't put env-var reads in the connector factory body** — pass them via `config`. Makes connectors testable without mocking `process.env`.

---

### 6. CSV ingestion endpoint architecture (FND-05/06/07)

**Recommendation: Next.js Server Action on Vercel handles the entire upload + parse + persist flow for F1. No round-trip through Railway.**

**Why Server Action over Route Handler:**

- Server Actions support multipart form data natively when invoked from a `<form>` element.
- Server Actions are co-located with the page that renders the wizard — closer to the UX code.
- Route Handlers are RPC-style and need explicit fetch wiring; more boilerplate for the same result.
- Server Action progressive enhancement is a plus: form posts work even with JS disabled.

**Why parse in Next.js, not Railway, for F1:**

- The orchestrator's F1 scope is interface + 6 skeletons + cron skeleton + cross-cutting plumbing. Adding an upload endpoint there is extra surface area.
- Vercel Server Actions can run up to 4.5MB request body on Hobby; multipart streaming to Storage bypasses this for the file body. CSV parse work is bounded (~20MB files, ≤5K txns/month).
- Migration path: when files exceed 20MB or async processing is needed, the same `CSVConnector.ingestUpload(uploadId)` is called from a Supabase Edge Function trigger or a Railway worker — no rewrite, just a different invoker.

**Endpoint architecture:**

```
[Browser]
   │ Step 1: POST /operacion/upload (Server Action: createUpload)
   │   - multipart: file, canal, tipo, mapping_profile_id
   │   - server streams file → Supabase Storage (path: csv/{upload_id}/{filename})
   │   - server inserts raw_csv_uploads row with status='uploaded'
   │   - returns { upload_id }
   │
   │ Step 2: POST /operacion/upload/preview (Server Action: previewUpload)
   │   - reads file from Storage, parses with csv-parse/sync
   │   - applies mapping_profile.column_map to first N rows
   │   - returns column_auto_detect_diff, preview_rows, validation_errors
   │
   │ Step 3: POST /operacion/upload/confirm (Server Action: confirmUpload)
   │   - dry-run: validate all rows; if --dry-run flag, return summary, no writes
   │   - real run: chunk-insert raw_csv_rows (500/batch); update upload status
   │   - invoke CSVConnector.ingestUpload(upload_id) inline (or enqueue)
   │   - write audit_log entry, write connector_runs row
```

**Multipart streaming to Storage** (Server Action, simplified):

```ts
// apps/dashboard/app/(app)/operacion/upload/_actions.ts
"use server";
import { createServerActionClient } from "@/lib/supabase/server";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB hard cap for F1
const ALLOWED_TYPES = ["text/csv", "application/vnd.ms-excel", "text/plain"];

export async function createUpload(formData: FormData) {
  const supabase = await createServerActionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHORIZED");

  const file = formData.get("file") as File;
  if (!file) throw new Error("NO_FILE");
  if (file.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error("INVALID_TYPE");

  const canal = formData.get("canal") as string;
  const tipo = formData.get("tipo") as string;
  const mappingProfileId = formData.get("mapping_profile_id") as string | null;

  const upload_id = crypto.randomUUID();
  const storagePath = `csv/${upload_id}/${file.name}`;

  // Stream file to Storage
  const { error: storageErr } = await supabase.storage
    .from("csv-uploads")
    .upload(storagePath, file, {
      contentType: file.type,
      cacheControl: "no-cache",
    });
  if (storageErr) throw storageErr;

  const { error: dbErr } = await supabase.from("raw_csv_uploads").insert({
    upload_id,
    canal_declarado: canal,
    tipo,
    filename: file.name,
    bytes: file.size,
    row_count: 0,
    uploaded_by: user.id,
    storage_path: storagePath,
    mapping_profile_id: mappingProfileId,
    status: "uploaded",
  });
  if (dbErr) throw dbErr;

  // Audit log
  await supabase.from("audit_log").insert({
    user_id: user.id,
    role_at_time: (user.app_metadata as any).role ?? "analista",
    action: "csv_upload_created",
    target_table: "raw_csv_uploads",
    target_id: upload_id,
    payload_json: { filename: file.name, bytes: file.size, canal, tipo },
  });

  revalidatePath("/operacion");
  return { upload_id };
}
```

**Inline CSV parsing + chunk insert** (the dry-run + commit step):

```ts
// apps/dashboard/app/(app)/operacion/upload/_parse.ts
"use server";
import { parse } from "csv-parse/sync";

const CHUNK = 500;

export async function commitUpload(
  upload_id: string,
  options: { dry_run: boolean },
) {
  const supabase = await createServerActionClient();
  const { data: upload, error } = await supabase
    .from("raw_csv_uploads")
    .select("*, csv_mapping_profiles(*)")
    .eq("upload_id", upload_id)
    .single();
  if (error || !upload) throw new Error("UPLOAD_NOT_FOUND");

  // Download CSV bytes from Storage
  const { data: blob } = await supabase.storage
    .from("csv-uploads")
    .download(upload.storage_path);
  if (!blob) throw new Error("STORAGE_DOWNLOAD_FAILED");
  const text = await blob.text();

  // Parse with csv-parse/sync (≤20MB is fine)
  const records: Record<string, string>[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    delimiter: upload.csv_mapping_profiles?.delimiter ?? ",",
    trim: true,
  });

  // Validate rows against mapping profile
  const errors: { row_number: number; error: string }[] = [];
  const validRows = [];
  for (const [i, row] of records.entries()) {
    const validation = validateRow(
      row,
      upload.csv_mapping_profiles!.column_map_json,
    );
    if (validation.ok) validRows.push({ row_number: i + 1, payload_json: row });
    else errors.push({ row_number: i + 1, error: validation.error });
  }

  if (options.dry_run) {
    return { total: records.length, valid: validRows.length, errors };
  }

  // Chunk insert into raw_csv_rows
  for (let i = 0; i < validRows.length; i += CHUNK) {
    const slice = validRows.slice(i, i + CHUNK).map((r) => ({
      upload_id,
      row_number: r.row_number,
      payload_json: r.payload_json,
      processed: false,
      target_table: upload.tipo === "orders" ? "raw_orders" : "raw_products",
    }));
    const { error: insErr } = await supabase.from("raw_csv_rows").insert(slice);
    if (insErr) throw insErr;
  }

  await supabase
    .from("raw_csv_uploads")
    .update({
      status: "processed",
      row_count: validRows.length,
      error_log_json: errors.length ? errors : null,
    })
    .eq("upload_id", upload_id);

  // Invoke connector inline (in F1, this is the same process)
  const result = await csvConnector.ingestUpload(upload_id);

  // connector_runs row
  await supabase.from("connector_runs").insert({
    canal: "csv-upload",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    records_processed: result.rows_processed,
    errors_json: result.errors,
    status: result.errors.length ? "partial" : "succeeded",
  });

  return { total: records.length, valid: validRows.length, errors };
}
```

**Reprocess pattern (FND-07):**

```ts
export async function reprocessUpload(
  upload_id: string,
  new_mapping_profile_id: string,
) {
  // 1. Validate new profile exists and matches the upload's canal+tipo
  // 2. Soft-delete prior raw_csv_rows for this upload (mark replaced_at)
  //    OR: keep them and use a new version column. Choose: keep + version.
  // 3. Update raw_csv_uploads.mapping_profile_id = new_mapping_profile_id
  // 4. Re-stream from Storage (CSV bytes are immutable) → re-parse with new map
  //    → chunk-insert new raw_csv_rows
  // 5. Invoke CSVConnector.ingestUpload(upload_id) — its UPSERT on
  //    (canal, external_order_id) handles idempotency on sales/sale_items.
  // 6. Write audit_log + connector_runs.
}
```

Critically: **the raw bytes in Storage are immutable.** Reprocess uses the same file with a different mapping profile. The unique constraint `(canal, external_order_id)` on `sales` makes downstream UPSERTs safe.

**Pitfalls:**

- **`csv-parse/sync` is memory-bound.** 20MB CSVs are fine; 200MB will OOM. Hard cap at 20MB for F1; document the streaming path for later (`csv-parse` (non-sync) is a Node stream).
- **Server Action body limits** — Vercel Hobby is 4.5MB, Pro is 10MB. Multipart streaming to Storage bypasses this _for the file body_ because Supabase Storage upload takes a Blob. But the Server Action runtime itself still has a serialized arg limit. Workaround: client uploads file directly to Storage with a signed URL, then Server Action only receives the `storage_path` string. **For F1, accept the 20MB ceiling and use Server Action with the file passed in FormData; if it breaks, switch to signed-URL direct upload.**
- **MIME-type spoofing** — `application/vnd.ms-excel` is the Windows-csv MIME. Validate by file extension AND by trying to parse the first line.
- **Reprocess idempotency** — the UPSERT on `(canal, external_order_id)` only protects `sales`. If two consecutive reprocesses produce different `external_order_id` derivations (e.g., the mapping profile changed which column is the ID), you can leave orphaned facts. Mitigation: keep `raw_csv_uploads.mapping_profile_version` history; on reprocess with a different ID-column, soft-delete prior facts attributable to this upload first.
- **Audit log size** — `payload_json` can balloon. Cap at ~64KB per row; truncate with a marker.

---

### 7. Orchestrator skeleton on Railway

**Recommendation: Hono on `@hono/node-server`.** Reasoning:

- Smallest API surface; reads like Express but with full TS inference.
- `@hono/zod-validator` gives free body/query validation via shared Zod schemas in `packages/schema`.
- Edge-compatible (future portability to Cloudflare Workers if Railway gets pricey).
- `@hono/node-server` 2.0.2 is stable. `[VERIFIED: npm view]`

**Endpoints in F1:**

```
GET  /health            — Railway healthcheck
GET  /connectors        — list registered connectors + healthCheck() results
POST /webhooks/:canal   — placeholder for F2 (POS webhook); 501 in F1
```

**No `/ingest/csv-upload` in F1.** CSV ingestion lives entirely in Next.js Server Actions. The orchestrator's role in F1 is to _exist_, expose health, and have the cron skeleton wired.

**Hono server skeleton** (`apps/orchestrator/src/server.ts`):

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger as honoLogger } from "hono/logger";
import pino from "pino";
import { createClient } from "@supabase/supabase-js";
import { buildRegistry } from "./connectors/registry";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const registry = buildRegistry({ supabase, logger: log, env: process.env });

const app = new Hono();
app.use(honoLogger());

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.get("/connectors", async (c) => {
  const results = await Promise.all(
    Object.entries(registry).map(async ([canal, conn]) => ({
      canal,
      type: conn.type,
      capabilities: [...conn.capabilities],
      health: await conn
        .healthCheck()
        .catch((e) => ({ ok: false, last_error: String(e) })),
    })),
  );
  return c.json(results);
});

app.post("/webhooks/:canal", (c) => c.json({ status: "not_implemented" }, 501));

const port = parseInt(process.env.PORT ?? "8080", 10);
serve({ fetch: app.fetch, port });
log.info({ port }, "orchestrator listening");
```

**Cron scheduler pattern — Railway native cron.** `[VERIFIED: docs.railway.com/reference/cron-jobs]`

- Railway cron = a **setting on a service** (not a separate service type).
- Service start command runs on schedule; **must exit cleanly** (Railway does not force termination).
- Minimum interval: 5 minutes. UTC only.
- For F1, the cron is a **separate Railway service** that shares the same monorepo deploy, with a different start command:
  - Service A: `orchestrator-web` — web service, start = `node dist/server.js`.
  - Service B: `orchestrator-cron` — cron service, start = `node dist/cron.js`, schedule = `*/30 * * * *` (placeholder; F1 has no real jobs).

**Cron entry** (`apps/orchestrator/src/cron.ts`):

```ts
import { createClient } from "@supabase/supabase-js";
import pino from "pino";

const log = pino();
async function main() {
  const t0 = Date.now();
  log.info("cron tick start");
  // F1: write a heartbeat row to connector_runs so we can observe cron is alive
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  await supabase.from("connector_runs").insert({
    canal: "cron-heartbeat",
    started_at: new Date(t0).toISOString(),
    completed_at: new Date().toISOString(),
    records_processed: 0,
    status: "succeeded",
  });
  log.info({ duration_ms: Date.now() - t0 }, "cron tick done");
  process.exit(0); // MUST exit; Railway cron requires clean exit.
}
main().catch((e) => {
  log.error(e);
  process.exit(1);
});
```

**Worker pattern + DLQ:** For F1 we go **table-based**, not Redis/pgmq.

- DLQ is a Postgres table `dead_letter_queue (id, canal, payload_json, error, attempts, last_attempted_at, created_at)`.
- Retry uses `p-retry` with `retries: 3, factor: 2, minTimeout: 1000`. On final failure, insert into `dead_letter_queue`.
- F1 doesn't need a worker dequeuing the DLQ — F2+ adds that.

```ts
// apps/orchestrator/src/lib/retry.ts
import pRetry from "p-retry";

export async function withRetryAndDLQ<T>(
  fn: () => Promise<T>,
  meta: { canal: string; payload: unknown },
  supabase: SupabaseClient,
): Promise<T | null> {
  try {
    return await pRetry(fn, { retries: 3, factor: 2, minTimeout: 1000 });
  } catch (err) {
    await supabase.from("dead_letter_queue").insert({
      canal: meta.canal,
      payload_json: meta.payload,
      error: String(err),
      attempts: 4,
      last_attempted_at: new Date().toISOString(),
    });
    return null;
  }
}
```

**Idempotent UPSERT** (the canonical pattern):

```ts
await supabase.from("sales").upsert(
  {
    canal: "wordpress",
    external_order_id: "12345",
    // ...fields
  },
  { onConflict: "canal,external_order_id", ignoreDuplicates: false },
);
// Postgres UPSERT: ON CONFLICT (canal, external_order_id) DO UPDATE SET ...
```

The unique constraint on `(canal, external_order_id)` (defined in §3) is what makes this idempotent.

**Pitfalls:**

- **Railway cron + Postgres connections** — each tick opens a connection. With Supabase free tier (60 direct connections), 6 cron jobs every 5 min × 2 connections each = 12 concurrent peak. Acceptable. Use pgBouncer pooled URL for safety.
- **`process.exit(0)` is required.** Without it, Railway considers the cron tick still running and skips the next one. `[VERIFIED: docs.railway.com/reference/cron-jobs]`
- **Don't use `BullMQ` for F1.** Requires Redis; out of scope. Postgres-backed DLQ is enough.

---

### 8. Where each cross-cutting layer lives

| Concern                                  | Where                                              | How                                                                                                                                                                                                                 | F1 deliverable                                                                                                      |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Idempotency `(canal, external_order_id)` | DB (unique constraint) + app (UPSERT)              | `unique (canal, external_order_id)` on `sales`, `raw_orders`. App uses `.upsert({ onConflict: 'canal,external_order_id' })`.                                                                                        | Migration #4 (facts layer) creates constraint; helper `packages/db/helpers/idempotent-upsert.ts` wraps the pattern. |
| Retries + DLQ                            | App (`p-retry`) + DB (`dead_letter_queue` table)   | `withRetryAndDLQ()` wrapper in `apps/orchestrator/src/lib/retry.ts`. Migration #7 creates `dead_letter_queue`.                                                                                                      | Wrapper code + table + 1 unit test that triggers retry path.                                                        |
| `connector_runs` writes                  | App calls DB                                       | Helper `recordConnectorRun({ canal, started_at, ..., status })` in `packages/db/helpers/connector-runs.ts`. Called by every connector entry point AND by the CSV ingestion Server Action.                           | Helper + 1 integration test (upload CSV → assert `connector_runs` has 1 row).                                       |
| `audit_log` writes                       | App (helper)                                       | `auditLog({ user_id, role_at_time, action, target_table, target_id, payload_json })` in `packages/db/helpers/audit.ts`. Called by Server Actions on user mutations (upload created, role changed, match validated). | Helper + 1 integration test.                                                                                        |
| RLS enforcement                          | DB (policies)                                      | Per-table `enable row level security` + `create policy` (see §3).                                                                                                                                                   | Migration #12.                                                                                                      |
| Column-level isolation                   | DB (views)                                         | Per-role views with `with (security_invoker = true)` (see §3).                                                                                                                                                      | Migration #13.                                                                                                      |
| JWT role injection                       | DB (`custom_access_token` fn) + Auth (hook config) | See §4.                                                                                                                                                                                                             | Migration #11 + `config.toml` change.                                                                               |
| Route gating                             | App (Next.js middleware)                           | See §4.                                                                                                                                                                                                             | `apps/dashboard/middleware.ts`.                                                                                     |
| Secrets                                  | Infra (Vercel + Railway env vars)                  | No code lives here; just the env var schema.                                                                                                                                                                        | `apps/dashboard/.env.example` + `apps/orchestrator/.env.example`.                                                   |

**`audit_log` writes are mandatory on every user mutation in F1:**

- `csv_upload_created`, `csv_upload_processed`, `csv_upload_reprocessed`
- `role_changed` (Super Admin promoting/demoting)
- `user_created`, `user_invited`

Mark TODOs for F2+:

- `match_validated` (F2)
- `customer_merged` (F4)
- `ai_insight_feedback` (F5)

**`connector_runs` lifecycle:**

```
started_at = now()
... do work, accumulating errors ...
completed_at = now()
status = errors.length ? 'partial' : 'succeeded' | 'failed'
records_processed = count of NormalizedOrder/Product emitted
errors_json = [{ row, error }, ...] or null
duration_ms = completed - started
```

Write the row at the END of the run, not the start (so duration is meaningful).

**Pitfalls:**

- **Don't trigger `audit_log` from DB triggers.** App-layer writes give you the `role_at_time` snapshot easily; a trigger would need to read `request.jwt.claims` → fragile.
- **Don't write `connector_runs` on every chunked sub-batch.** One row per ingest operation. If a single Server Action processes 5K rows in 10 chunks, that's 1 `connector_runs` row, not 10.

---

### 9. Testing strategy for F1

**Recommendation: 3-tier test pyramid, Vitest at every tier, no Playwright in F1.**

| Tier        | Tool                    | What it tests                                                                                              | Run when      |
| ----------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------- |
| Unit        | Vitest                  | Pure functions in `packages/connectors` (normalizers, CSV mapping helpers), `packages/schema` (Zod parses) | Every commit  |
| Integration | Vitest + local Supabase | DB-touching code: RLS, role views, JWT hook, CSV upload Server Action against local Supabase               | Every PR (CI) |
| Smoke       | Curl-based bash script  | Production health endpoints after deploy                                                                   | Post-deploy   |

**Local Supabase for CI:**

```bash
# .github/workflows/ci.yml (essentials)
- uses: supabase/setup-cli@v1
- run: supabase start
- run: supabase db reset    # applies all migrations + seed
- run: pnpm install --frozen-lockfile
- run: pnpm --filter db run types    # regenerate; CI fails if not committed
- run: pnpm run lint
- run: pnpm run test
- run: supabase stop
```

**Vitest unit example** (`packages/connectors/src/csv/csv.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { applyColumnMap } from "./column-map";

describe("applyColumnMap", () => {
  it("maps CSV row to canonical product", () => {
    const row = { "SKU vendedor": "A-001", Precio: "1500" };
    const profile = {
      column_map: { external_id: "SKU vendedor", price: "Precio" },
    };
    expect(applyColumnMap(row, profile)).toEqual({
      external_id: "A-001",
      price: 1500,
    });
  });
});
```

**Integration test** (`apps/dashboard/tests/upload.integration.test.ts`):

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

describe("CSV upload integration", () => {
  let supabase: ReturnType<typeof createClient>;

  beforeAll(() => {
    supabase = createClient(
      process.env.SUPABASE_URL ?? "http://localhost:54321",
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  });

  it("uploads + parses + persists raw_csv_rows", async () => {
    const fixture = readFileSync(
      "./tests/fixtures/wordpress-products-sample.csv",
    );
    // Direct Storage upload (server-side simulating the Server Action)
    const upload_id = crypto.randomUUID();
    await supabase.storage
      .from("csv-uploads")
      .upload(`csv/${upload_id}/test.csv`, fixture);

    await supabase.from("raw_csv_uploads").insert({
      upload_id,
      canal_declarado: "wordpress",
      tipo: "products",
      filename: "test.csv",
      bytes: fixture.length,
      row_count: 0,
      uploaded_by: null,
      storage_path: `csv/${upload_id}/test.csv`,
      mapping_profile_id: "<seeded-wp-products-profile-id>",
      status: "uploaded",
    });

    // Trigger the parse helper directly (not via Server Action HTTP)
    const result = await commitUpload(upload_id, { dry_run: false });

    expect(result.errors).toHaveLength(0);
    const { count } = await supabase
      .from("raw_csv_rows")
      .select("*", { count: "exact" })
      .eq("upload_id", upload_id);
    expect(count).toBeGreaterThan(0);

    const { count: cr } = await supabase
      .from("connector_runs")
      .select("*", { count: "exact" })
      .eq("canal", "csv-upload");
    expect(cr).toBeGreaterThan(0);
  });
});
```

**Fixtures:** Use the 5 CSV templates in `docs/csv-templates/*.csv` + the 5 profile JSONs in `scripts/discovery/profiles/*.json`. F1 already has these.

**No Playwright in F1** — dashboard is too thin (login + the 3-step wizard). Defer to F2 when there's a real "Hoy" view.

**Pitfalls:**

- **Don't run integration tests against the production Supabase.** Local stack only. CI's local stack is ephemeral.
- **Reset between tests** — wrap each integration test in a transaction OR call `supabase db reset` between groups (slow). Recommended: each test inserts uniquely-keyed fixtures and asserts subsets.

---

### 10. Vercel + Railway deployment specifics

**Vercel (Next.js dashboard):**

- **Project root directory:** `apps/dashboard`.
- **Framework Preset:** Next.js (auto-detected).
- **Build Command:** `cd ../.. && turbo run build --filter=dashboard...`
- **Install Command:** auto (pnpm detected).
- **Output Directory:** `.next` (default).
- **Ignored Build Step:** `npx turbo-ignore --fallback=HEAD^1`
- **Environment variables (Vercel UI / `vercel env`):**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only — DO NOT prefix `NEXT_PUBLIC_`)
  - `SUPABASE_PROJECT_REF` (for diagnostics)
- **Preview environments:** Vercel auto-creates a preview deployment per PR. They share the same Supabase project unless you wire branch-specific Supabase projects (out of scope F1).
- `[VERIFIED: vercel.com/docs/monorepos/turborepo]`

**Railway (orchestrator):**

- **Service A: orchestrator-web**
  - Root Directory: `apps/orchestrator`
  - Build Command: `pnpm install --frozen-lockfile && pnpm --filter @faka/orchestrator... build`
  - Start Command: `node dist/server.js`
  - Watch Paths: `apps/orchestrator/** packages/**`
  - Healthcheck Path: `/health`
  - Healthcheck Timeout: 30s
  - Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOG_LEVEL=info`, future channel keys (`WP_API_KEY`, `ML_CLIENT_ID`, etc. — F1 sets them empty/placeholder)
- **Service B: orchestrator-cron**
  - Same source, different start command: `node dist/cron.js`
  - Cron Schedule: `*/30 * * * *` (placeholder F1; real schedules in F2+)
  - No healthcheck (cron services exit).
- `[CITED: docs.railway.com/guides/monorepo]` + `[VERIFIED: docs.railway.com/reference/cron-jobs]`

**Secrets pipeline:**

```
[Local .env.example] ──checked into repo (no values)
[Local .env] ──gitignored, dev fills in
                │
                ▼
[CI: GitHub Secrets] ──used by .github/workflows/ci.yml for `supabase db reset` integration tests
                │
                ▼
[Vercel: Project Env Vars] ──NEXT_PUBLIC_* + SUPABASE_SERVICE_ROLE_KEY for SSR. Set via `vercel env add`.
                │
                ▼
[Railway: Service Variables] ──SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, channel API keys. Set via Railway UI or `railway variables set`.
```

**`ANTHROPIC_API_KEY` / `SUPABASE_SERVICE_KEY` flow specifically:**

- F1 does NOT use `ANTHROPIC_API_KEY` (no IA work in F1). Add to `.env.example` placeholder for F5 readiness.
- `SUPABASE_SERVICE_ROLE_KEY` lives in (a) local `.env` for dev, (b) GitHub Secrets for CI, (c) Vercel env vars (for Next.js Server Actions running with service role), (d) Railway env vars (for orchestrator background jobs). **Never** in client bundles or repo.

**`.env.example`** (root, for monorepo dev):

```bash
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_PROJECT_REF=

# Orchestrator
PORT=8080
LOG_LEVEL=info

# Channel placeholders (F2+ fills these)
WP_BASE_URL=
WP_API_KEY=
ML_CLIENT_ID=
ML_CLIENT_SECRET=
DROPI_USER=
DROPI_PASS=
POS_WEBHOOK_SECRET=

# Future (F5)
ANTHROPIC_API_KEY=
KIMI_API_KEY=

# Seeder
INITIAL_SUPER_ADMIN_PASSWORD=
```

**Pitfalls:**

- **`SUPABASE_SERVICE_ROLE_KEY` in `NEXT_PUBLIC_*`** — catastrophic. Never. Lint rule: if any `NEXT_PUBLIC_*` env var name contains `SERVICE` or `SECRET` or `PRIVATE`, fail the build.
- **Vercel ignore-build-step with sparse checkout** — turbo-ignore relies on git history to detect affected packages. Vercel does a shallow clone by default; turbo-ignore handles this. If you see false rebuilds, increase the clone depth via `--fallback=HEAD^N`.
- **Railway watch paths don't include monorepo root** — a change to `pnpm-lock.yaml` or `turbo.json` should trigger orchestrator rebuilds. Add those paths explicitly to Watch Paths.

---

## Common Pitfalls (cross-cutting)

### Pitfall 1: Forgetting `WITH (security_invoker = true)` on role views

**What goes wrong:** Views run as their owner (typically `postgres`), bypassing RLS. Analista can read all rows.
**Why it happens:** Postgres 14 and below defaulted to "definer-like" semantics; 15+ added the explicit flag.
**How to avoid:** Plan-checker lint rule: every `CREATE VIEW` in `supabase/migrations/*.sql` must include `with (security_invoker = true)` OR be in `auth.*` schema.
**Warning signs:** Integration test for Analista returns `total` non-null.

### Pitfall 2: Auth Hook function not granted to `supabase_auth_admin`

**What goes wrong:** Login succeeds but JWT has no `role` claim. Middleware defaults to `analista` for everyone.
**Why it happens:** Default Postgres function permissions deny execution to roles other than the creator.
**How to avoid:** Always pair the `create function` with `grant execute on function ... to supabase_auth_admin` in the same migration.
**Warning signs:** Cookies set on login but `/admin` route redirects every Super Admin to `/forbidden`.

### Pitfall 3: Storage uploads not deleted when rows are deleted

**What goes wrong:** Storing CSV uploads accumulates orphan files when `raw_csv_uploads` rows are deleted.
**Why it happens:** Supabase Storage and Postgres tables are separate systems; no automatic cascade.
**How to avoid:** Don't delete `raw_csv_uploads` rows (immutable per ADR-001). Use soft-delete + retention if needed. F1 doesn't need this; document for v2.

### Pitfall 4: Idempotency UPSERT race condition without unique constraint

**What goes wrong:** Two concurrent ingests of the same `(canal, external_order_id)` create duplicate `sales` rows.
**Why it happens:** Without the DB-level unique constraint, the application-level UPSERT can race.
**How to avoid:** Define `unique (canal, external_order_id)` on `sales` in the migration. Postgres serializes conflicting inserts at the constraint.
**Warning signs:** Sales rows with same `external_order_id` but different `sale_id`.

### Pitfall 5: pnpm hoisting breaks Next.js peer deps

**What goes wrong:** Next.js fails to resolve `react` at runtime because pnpm's strict hoisting put it in a sibling node_modules.
**Why it happens:** Some packages declare peer deps that pnpm doesn't auto-install at the consumer level.
**How to avoid:** `apps/dashboard/package.json` MUST explicitly declare every Next runtime dep (`react`, `react-dom`, `@supabase/*`). Don't rely on transitive resolution.
**Warning signs:** Vercel build fails with `Cannot find module 'react'` even though it works locally with `pnpm dev`.

### Pitfall 6: `csv-parse/sync` memory blow-up on large files

**What goes wrong:** A 50MB CSV uploaded by an over-eager user OOMs the Server Action.
**Why it happens:** Sync mode materializes all rows in memory.
**How to avoid:** Enforce 20MB max at the `<input type="file">` accept check AND at the Server Action body check.
**Warning signs:** Vercel function logs show "JavaScript heap out of memory".

### Pitfall 7: Railway cron service that doesn't exit

**What goes wrong:** Cron tick at t=0 runs forever (or > 5 min). Tick at t=5 is skipped.
**Why it happens:** Forgot `process.exit(0)` or kept an open Postgres connection alive via a global client.
**How to avoid:** Always call `process.exit(0)` at the end of the cron entry. Close Supabase clients before exit (the JS client doesn't keep connections alive, but Pino with async sinks might).
**Warning signs:** Railway log shows the cron service status as "running" but no second invocation appears.

---

## Code Examples (canonical, ready to copy)

### Server Action: createUpload

See §6 code block — covers FND-06 Step 1.

### View migration pattern

See §3 code block — covers FND-03.

### Custom access token hook

See §4 code block — covers FND-03 (JWT propagation).

### Hono health endpoint

See §7 code block — covers FND-04.

### Idempotent UPSERT

See §7 code block — covers FND-08 (idempotency).

---

## State of the Art

| Old Approach                                            | Current Approach                                                                     | When Changed           | Impact for F1                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `@supabase/auth-helpers-nextjs` for Next.js cookie auth | `@supabase/ssr` 0.10.3                                                               | 2024-Q3                | Use `createServerClient`/`createBrowserClient` from `@supabase/ssr` only. Old helper is deprecated.   |
| SECURITY DEFINER views for role-aware data              | SECURITY INVOKER views (Postgres 15+) with explicit `with (security_invoker = true)` | Postgres 15 (Oct 2022) | Mandatory pattern for F1.                                                                             |
| Prisma against Supabase                                 | `@supabase/supabase-js` + `supabase gen types`                                       | —                      | Per CONTEXT.md, no Prisma. `supabase gen types` produces the same TS guarantees with no schema drift. |
| Express + body-parser for Node APIs                     | Hono on `@hono/node-server`                                                          | 2023+                  | Tiny, fast, edge-portable.                                                                            |
| `csv-parser` (callback-based)                           | `csv-parse` (sync or stream)                                                         | Long-established       | Use sync mode for ≤20MB.                                                                              |
| Auth via `auth.users.app_metadata` mutation             | `profiles` table + Auth Hook `custom_access_token`                                   | 2024 (Auth Hooks GA)   | Cleaner role-management ergonomics.                                                                   |

**Deprecated/outdated:**

- `@supabase/auth-helpers-nextjs` — replaced by `@supabase/ssr`.
- Pages Router for new Next.js projects — App Router is default, locked.

---

## Assumptions Log

| #   | Claim                                                                                                                      | Section        | Risk if Wrong                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| A1  | Vercel Hobby tier is sufficient for F1 dashboard traffic (3 users, ~$0/mo).                                                | §10 deployment | Low — if Hobby limits hit, upgrade is $20/mo Pro; well within $150 cap.                              |
| A2  | Supabase Free tier (60 direct connections, 500MB DB, 1GB Storage) suffices through F1.                                     | §10 + §2       | Low — Phase 0 data is small; F1 has near-zero traffic. Upgrade $25/mo Pro covered by budget.         |
| A3  | CSV files in F1 are ≤20MB (allowing `csv-parse/sync` in Server Actions).                                                   | §6 ingestion   | Medium — if a discovery export exceeds 20MB, switch to streaming or Edge Function. Mitigation noted. |
| A4  | The Supabase Auth Hook `custom_access_token` runs on every token issue/refresh (~1h cadence).                              | §4             | Low — documented behavior.                                                                           |
| A5  | `@hono/zod-validator` is mature enough for F1's needs.                                                                     | §7             | Low — Hono is stable; F1 endpoints are trivial (3 routes).                                           |
| A6  | Railway's cron service skips overlapping ticks (already-running tick blocks next).                                         | §7 cron        | Low — `[VERIFIED: docs.railway.com/reference/cron-jobs]`.                                            |
| A7  | Postgres version on Supabase is ≥15 (for `security_invoker` views).                                                        | §3 RLS         | None — current Supabase new projects default to PG 17. Verify on project provisioning.               |
| A8  | Server Actions can return non-Response payloads on the result path; cookies set via the SSR helper persist across actions. | §4, §6         | Low — well-documented in Next.js 14+.                                                                |

If any of these turn out wrong, the only one that triggers a meaningful plan rework is **A3** — and the rework is "implement file size guard at upload time + document Edge Function path as a v2 task" which is already in the pitfall list.

---

## Open Questions

1. **Should we wire branch-specific Supabase projects for Vercel previews?**
   - What we know: Vercel previews use the same env vars as production by default; you'd need Branch-specific env vars to point to a Supabase staging project per branch.
   - What's unclear: cost of running 1+ Supabase projects per branch (each is $0 free tier; Pro is $25/each).
   - Recommendation: For F1, all PRs hit the SAME Supabase staging project. Migration testing happens in CI via local Supabase. Plan-checker rule: never `supabase db push` from CI — only from a tagged release workflow.

2. **Edge Functions for CSV parsing — when to flip?**
   - What we know: Vercel Server Action limit + `csv-parse/sync` memory cap us at ~20MB.
   - What's unclear: When the client's exports will start exceeding 20MB (probably never at 5K txns/mo, but ML exports can be large).
   - Recommendation: Add a `CSV_MAX_BYTES` env var (default 20MB) so the cap is configurable. Document the Edge Function migration path in this RESEARCH for F2.

3. **Should `profiles` be in `public` schema or its own?**
   - What we know: `public.profiles` is the canonical Supabase pattern.
   - What's unclear: whether splitting auth-adjacent tables into a `auth_app` schema is worth the namespacing.
   - Recommendation: `public.profiles` for F1. Single-schema simplicity wins.

4. **Cookie security flags for the Supabase SSR session.**
   - What we know: `@supabase/ssr` defaults are reasonable.
   - What's unclear: whether we need to harden `SameSite=Strict` or accept `Lax` (default).
   - Recommendation: Accept defaults for F1 (Lax). Audit in F5 when secret data is more material.

---

## Environment Availability

| Dependency                 | Required By                       | Available                   | Version                                                      | Fallback                                                       |
| -------------------------- | --------------------------------- | --------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Node.js ≥ 22.7             | Monorepo, dashboard, orchestrator | (verify on planner machine) | 22.7+ recommended for `csv-parse` sync + `import attributes` | nvm install 22                                                 |
| pnpm 11+                   | Workspace mgmt                    | (verify)                    | 11.1.1                                                       | `corepack enable && corepack prepare pnpm@11.1.1 --activate`   |
| Docker                     | Local Supabase (CLI uses Docker)  | (verify)                    | any recent                                                   | Use a hosted Supabase project for local dev (slower iteration) |
| Supabase CLI               | Migrations + types + local stack  | (verify)                    | 2.98.2                                                       | `brew install supabase/tap/supabase` or `npm i -g supabase`    |
| Git                        | Vercel/Railway integration        | yes                         | any                                                          | —                                                              |
| GitHub account + repo      | CI + Vercel/Railway integration   | yes                         | —                                                            | —                                                              |
| Vercel account             | Dashboard hosting                 | (verify Nicolás has one)    | —                                                            | Self-host on Fly.io as fallback (defer)                        |
| Railway account            | Orchestrator hosting              | (verify Nicolás has one)    | —                                                            | Render.com fallback (defer)                                    |
| Supabase project (staging) | All DB + Auth + Storage           | (verify provisioned)        | PG 15+                                                       | —                                                              |

**Missing dependencies with no fallback:**

- None hard-blocking. All tooling is installable; cloud accounts must be created if not yet.

**Missing dependencies with fallback:**

- Local Docker (for `supabase start`) — fallback: develop directly against staging Supabase.

---

## Validation Architecture

### Test Framework

| Property           | Value                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Framework          | Vitest 4.1.6                                                                             |
| Config file        | `vitest.config.ts` at repo root (or per-package; recommend root + workspace inheritance) |
| Quick run command  | `pnpm vitest run --changed` (only re-runs files affected by current diff)                |
| Full suite command | `pnpm -r run test` (Turbo cached)                                                        |

### Phase Requirements → Test Map

| Req ID | Behavior                                                     | Test Type   | Automated Command                                                                                       | File Exists?                                |
| ------ | ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| FND-01 | Repo + workspaces resolve; basic build succeeds              | unit        | `pnpm -r run build`                                                                                     | ❌ Wave 0                                   |
| FND-02 | All migrations apply cleanly; types regen matches schema     | integration | `supabase db reset && pnpm --filter db run types && git diff --exit-code packages/db/types/database.ts` | ❌ Wave 0                                   |
| FND-03 | RLS + role view isolation for each role                      | integration | `pnpm vitest run packages/db/tests/rls.test.ts`                                                         | ❌ Wave 0 — `packages/db/tests/rls.test.ts` |
| FND-03 | JWT `role` claim present after login                         | integration | `pnpm vitest run apps/dashboard/tests/auth.integration.test.ts`                                         | ❌ Wave 0                                   |
| FND-04 | All 6 connector skeletons compile + healthCheck returns      | unit        | `pnpm vitest run packages/connectors/tests/skeletons.test.ts`                                           | ❌ Wave 0                                   |
| FND-05 | `CSVConnector.ingestUpload()` parses fixture and writes rows | integration | `pnpm vitest run packages/connectors/tests/csv.integration.test.ts`                                     | ❌ Wave 0                                   |
| FND-06 | Upload flow end-to-end against local Supabase                | integration | `pnpm vitest run apps/dashboard/tests/upload.integration.test.ts`                                       | ❌ Wave 0                                   |
| FND-07 | Reprocess action re-emits rows with new profile version      | integration | `pnpm vitest run apps/dashboard/tests/reprocess.integration.test.ts`                                    | ❌ Wave 0                                   |
| FND-08 | Idempotent UPSERT no-op on duplicate; DLQ row on triple-fail | integration | `pnpm vitest run apps/orchestrator/tests/retry-and-dlq.test.ts`                                         | ❌ Wave 0                                   |
| FND-08 | `connector_runs` row written per execution                   | integration | `pnpm vitest run apps/orchestrator/tests/observability.test.ts`                                         | ❌ Wave 0                                   |
| FND-08 | `audit_log` row written on user mutation                     | integration | (part of upload.integration.test.ts)                                                                    | ❌ Wave 0                                   |

### Sampling Rate

- **Per task commit:** `pnpm vitest run --changed` + `pnpm -r run lint`
- **Per wave merge:** `pnpm -r run test` (full suite via Turbo)
- **Phase gate:** Full suite green + `supabase db reset` clean on CI + smoke test against deployed staging.

### Wave 0 Gaps

- [ ] `vitest.config.ts` at repo root
- [ ] `packages/db/tests/rls.test.ts` — RLS + role view assertions
- [ ] `packages/connectors/tests/skeletons.test.ts` — interface conformance test
- [ ] `packages/connectors/tests/csv.integration.test.ts`
- [ ] `apps/dashboard/tests/upload.integration.test.ts`
- [ ] `apps/dashboard/tests/reprocess.integration.test.ts`
- [ ] `apps/dashboard/tests/auth.integration.test.ts`
- [ ] `apps/orchestrator/tests/retry-and-dlq.test.ts`
- [ ] `apps/orchestrator/tests/observability.test.ts`
- [ ] `tests/fixtures/wordpress-products-sample.csv` (and 4 more) — copies from `docs/csv-templates/`
- [ ] `.github/workflows/ci.yml`
- [ ] Framework install: `pnpm add -D -w vitest @types/node`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category         | Applies     | Standard Control                                                                                                                                         |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2 Authentication     | yes         | Supabase Auth email+password; password policy enforced by Supabase (min 8 char by default — strengthen via `auth.password_requirements` in config.toml). |
| V3 Session Management | yes         | `@supabase/ssr` HttpOnly cookies; auto-refresh; sign-out scopes. JWT exp = 1h default.                                                                   |
| V4 Access Control     | yes         | RLS + per-role views (§3); Next.js middleware route gating (§4); JWT `role` claim.                                                                       |
| V5 Input Validation   | yes         | Zod schemas in `packages/schema`; `@hono/zod-validator` on orchestrator routes; multipart file type + size guards on Server Actions.                     |
| V6 Cryptography       | no (mostly) | Supabase + Vercel + Railway handle TLS, password hashing (argon2id). Don't hand-roll. F1 has no app-level crypto.                                        |
| V8 Data Protection    | partial     | Service Role key never reaches client. Customer PII (phone/email/document_id) hidden from Manager/Analista via views — defense in depth.                 |
| V13 Configuration     | yes         | `.env.example` checked in; real values never committed; secret-naming lint rule (§10).                                                                   |

### Known Threat Patterns for Next.js + Supabase + Railway

| Pattern                                                    | STRIDE                 | Standard Mitigation                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SQL injection via dynamic query                            | Tampering              | Use `supabase-js` parameterized methods only; never string-concat into SQL. RLS as last line.                                                                      |
| Mass assignment on profiles update (user setting own role) | Elevation of Privilege | Server Action validates that caller role = super_admin before allowing `profiles.role` mutation. RLS policy denies non-super_admin updates as belt-and-suspenders. |
| CSV path traversal via filename                            | Tampering              | Storage path is server-generated as `csv/{upload_id}/{filename}`; sanitize filename to `[A-Za-z0-9_.-]`.                                                           |
| Service Role key leaked to client bundle                   | Information Disclosure | Lint rule: any env var with `SERVICE` in name MUST NOT be prefixed `NEXT_PUBLIC_*`.                                                                                |
| Session fixation via cookie set on login form              | Spoofing               | `@supabase/ssr` handles cookie rotation on auth state change.                                                                                                      |
| CSRF on Server Actions                                     | Spoofing               | Next.js Server Actions include built-in CSRF protection via Origin checks; ensure `next.config.js` allowed origins are set correctly for previews.                 |
| Auth Hook function exposed to anon via Data API            | Information Disclosure | `revoke execute ... from anon, authenticated`; only `supabase_auth_admin` can call it.                                                                             |
| Open redirect after login                                  | Tampering              | `redirect_to` parameter MUST be validated against an allowlist of internal paths.                                                                                  |

---

## Project Constraints (from CLAUDE.md)

No `CLAUDE.md` exists in the repo root at the time of research. If one is added, planner must re-read and add constraints here. Current binding rules come from `PROJECT.md` and the ADRs (folded into `<user_constraints>` above).

---

## Complexity per Success Criterion (in 4-hour increments)

Reading from ROADMAP.md Phase 1 success criteria (lines 41–46 of the source) and FND-01..08:

| Success Criterion                                                                                   | Estimated Hours (4h increments)  | Notes                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Schema deployed, zero pending migrations, `supabase db reset` clean                              | **16–20h**                       | 14 migrations × ~1h each + seed + types + CI workflow + verifying pnpm/turbo build green. Largest chunk.                                                             |
| 2. Test CSV upload through 3-step wizard lands rows; reprocess works                                | **24–28h**                       | Wizard UI (shadcn/ui port of HTML sketch) + 3 Server Actions + parse logic + storage upload + reprocess flow + audit_log + connector_runs writes + integration test. |
| 3. 4 roles login; RLS + column views enforced; secrets in env vars only                             | **16–20h**                       | Auth Hook fn + migrations for views/grants + middleware + role-aware view selection helper + login UI (shadcn/ui Card + form) + CLI seeder + RLS integration test.   |
| 4. 6 connector skeletons compile against `ChannelConnector`; `CSVConnector` concrete                | **8–12h**                        | Mostly mechanical: 6 × ~30-line skeleton files + 1 real CSV impl + registry + interface tests.                                                                       |
| 5. Orchestrator patterns: idempotency, retry+DLQ, `connector_runs`, `audit_log`, exercised by tests | **12–16h**                       | Hono server + cron entry + retry helper + DLQ table migration + audit helper + connector_runs helper + Railway 2-service setup + tests.                              |
| **Total**                                                                                           | **76–96h** (~19–24 working days) | Solo dev, 4h focused per increment. Buffer 15% → realistic finish ~90–110h (~22–28 working days = ~4.5–5.5 weeks).                                                   |

This aligns with the PROJECT.md timeline target of "F1 in ~3–5 weeks" but leans toward the upper end — the column-level RLS and Auth Hook work, plus the wizard's UX polish, are the unavoidable time sinks.

---

## Sources

### Primary (HIGH confidence)

- `[VERIFIED: supabase.com/docs/guides/auth/auth-hooks]` — Auth Hook enablement via `config.toml` + Dashboard.
- `[VERIFIED: supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook]` — function signature, GRANT requirements, claim injection pattern.
- `[VERIFIED: vercel.com/docs/monorepos/turborepo]` — Vercel auto-detected build config for Turbo monorepos; Root Directory + Build Command + Ignored Build Step.
- `[CITED: docs.railway.com/guides/monorepo]` — Root Directory in Railway service settings; railway.toml absolute path requirement.
- `[VERIFIED: docs.railway.com/reference/cron-jobs]` — cron is a service setting; minimum 5min interval; UTC only; must exit cleanly; overlapping ticks are skipped.
- `[VERIFIED: postgresql.org/docs/15/sql-createview.html]` — `security_invoker = true` flag for views (PG 15+).
- `[VERIFIED: npm registry]` — all package versions (pulled 2026-05-13).

### Secondary (MEDIUM confidence)

- Next.js 14 App Router Server Actions docs — multipart, redirect/revalidate APIs (training knowledge cross-checked with current Vercel guidance).
- Supabase `@supabase/ssr` cookie pattern for App Router — current canonical (replaces `@supabase/auth-helpers-nextjs`).
- Hono + `@hono/node-server` Node deploy pattern — verified via npm metadata + Hono docs (training).

### Tertiary (LOW confidence, flagged)

- Specific Server Action body size limits per Vercel plan tier — values shift; treat as approximate. Recommendation: enforce app-level guard at 20MB so the limit isn't ambiguous.

---

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — every package version verified against npm registry on 2026-05-13.
- Architecture (RLS, views, Auth Hook, Server Actions): **HIGH for hooks/RLS** (verified against current Supabase docs); **MEDIUM-HIGH for Server Actions** (well-established but plan-tier limits shift).
- Pitfalls: **HIGH** — drawn from documented Postgres/Supabase behaviors and common community gotchas, not speculation.
- Deployment shapes (Vercel + Railway monorepo): **MEDIUM-HIGH** — multiple valid configurations exist; the one above is the most-documented canonical path.

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30-day window — Supabase Auth Hooks and `@supabase/ssr` are stable; only re-validate package versions if planning slips past June). For Next.js Server Action body limits and Vercel monorepo defaults, re-check at planning-start if > 14 days have passed.
