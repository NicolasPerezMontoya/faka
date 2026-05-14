# Deployment Runbook — faka

Phase 1 (Foundation). Sets up:

- **Supabase** for Postgres + Auth + Storage
- **Railway** for the orchestrator (web + cron services)
- **Vercel** for the Next.js dashboard

> All four cloud accounts cost <$10/mo for Phase 1 traffic — well inside the $150 cap.

---

## 0. Prerequisites

- Node ≥ 22.7 locally
- pnpm ≥ 10.0 (`corepack enable && corepack prepare pnpm@10.28.1 --activate`)
- Docker daemon running (for local Supabase + orchestrator image build)
- Supabase CLI (`npm i -g supabase` or installed as dev dep via `pnpm install`)
- Railway CLI (optional, for local testing — `npm i -g @railway/cli`)
- Vercel CLI (optional — `npm i -g vercel`)

---

## 1. Supabase

### 1.1 Create the staging project

1. https://supabase.com/dashboard → **New project**.
2. Region: `us-east-1` (lowest latency from Colombia per current routing).
3. Plan: free tier; upgrade to Pro ($25/mo) when row count > 1M.
4. Save the `Project Ref` (e.g. `abcdefg`) and the public anon key + service-role key.

### 1.2 Link the local repo to the project

```bash
pnpm install
pnpm --filter @faka/db exec supabase login
pnpm --filter @faka/db exec supabase link --project-ref <PROJECT_REF>
```

### 1.3 Apply migrations + seed

```bash
pnpm --filter @faka/db exec supabase db push          # applies migrations 0001..0013 (F1) + 20260601000001..2 (F2)
pnpm --filter @faka/db exec supabase db reset --linked   # OR a clean reset
```

> **F2 note:** after adding a migration locally, run
> `pnpm --filter @faka/db run types` and commit the resulting
> `packages/db/types/database.ts`. CI's `db-integration` job runs
> `git diff --exit-code` against this file and hard-fails on drift.
> If you can't run Supabase locally (e.g. WSL2 network issue), push
> first and download the regenerated file from the `database-types`
> artifact on the failed CI run.

Seed the initial Super Admin (locally first to verify, then again against staging if needed):

```bash
export INITIAL_SUPER_ADMIN_PASSWORD='SomeStrongPasswordChangeMeAfterFirstLogin'
pnpm --filter @faka/db run seed:super-admin
```

You can now log in at the local dashboard (`pnpm --filter dashboard run dev`) as
`nicolasperezmontoya@gmail.com` with the password you set.

### 1.4 Configure the Auth Hook

The `custom_access_token_hook` is enabled in `packages/db/supabase/config.toml`
and applied via migration 0009. After `db push` succeeds, verify in the Supabase
dashboard:

- **Auth** → **Hooks** → ensure `custom_access_token` points to
  `public.custom_access_token_hook` and is enabled.

If the hook isn't visible, run:

```bash
psql "$DATABASE_URL" -c "\df custom_access_token_hook"
psql "$DATABASE_URL" -c "select has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute')"
```

Both must return `true`. Without the grant, sign-in fails cryptically (RESEARCH Pitfall 2).

---

## 2. Railway — Orchestrator (web + cron)

### 2.1 Create the project

1. https://railway.app → **New Project** → **Empty project**.
2. Connect to GitHub repo (point at the `main` branch for now; preview environments are post-F1).
3. Add a **secret group** (or set env vars per service):
   - `SUPABASE_URL` → from Supabase project settings
   - `SUPABASE_SERVICE_ROLE_KEY` → from Supabase project settings (server-only)
   - `LOG_LEVEL=info`
   - `PORT=8080`

### 2.2 Two services from one repo

Railway reads `apps/orchestrator/railway.toml` which declares both services. In
the Railway dashboard **Settings** for each new service:

- **Config as code path**: `apps/orchestrator/railway.toml` (absolute path per
  RESEARCH §1).
- **Root directory**: leave blank (the Dockerfile builds from repo root).

Services declared:

- `orchestrator-web`: HTTP server on `$PORT`, healthcheck at `/health`.
- `orchestrator-cron`: cron schedule `*/30 * * * *` running `node dist/cron.js heartbeat` — proves the cron infra is alive.
- `orchestrator-cron-process-wp-events`: `*/5 * * * *` (Plan 2.3.2) — drains `raw_orders.processed=false` for WP.
- `reembed-products` (Plan 2.3.4): daily at `0 4 * * *` UTC (23:00 Bogotá, off-peak) — refreshes `product_embeddings` for `master_products`. The embeddings service short-circuits via `sha256(source_text)` so unchanged rows skip the OpenAI API entirely (RESEARCH §Pitfall 5). Cap defaults to 500 products / run (`REEMBED_BATCH_SIZE` env override). Degrades cleanly when `OPENAI_API_KEY` is unset: writes a `connector_runs` row with `errors_json.reason='no_embedding_provider'` and exits 0.
- `re-cascade-unmatched` (Plan 2.3.4): every 6h at `0 */6 * * *` UTC — retries the matching cascade on `sale_items` rows still stuck in the queue (`master_sku IS NULL AND created_at > now() - 7d`). Capped at 200 rows / run (`RECASCADE_BATCH_SIZE`) and gated by `LLM_DAILY_TOKEN_CAP` via `TokenBudgetTracker` so the cron can't blow the daily LLM budget (RESEARCH §Pitfall 7). Idempotent: `persistMatch` UPSERTs on `(canal, external_id)` and only writes `sale_items.master_sku` when currently NULL.

### 2.3 Verify

After the first deploy:

```bash
curl https://<orchestrator-url>.up.railway.app/health
# {"ok":true,"service":"faka-orchestrator","phase":1,"ts":"..."}

curl https://<orchestrator-url>.up.railway.app/connectors
# {"connectors":[{"canal":"csv-upload","ok":true,...}, {"canal":"wordpress","ok":false,...}, ...]}
```

Cron heartbeat row appears in `connector_runs` every 30 min — verify via:

```sql
select kind, canal, status, started_at
from connector_runs
where kind = 'cron-heartbeat'
order by started_at desc
limit 5;
```

---

## 3. Vercel — Dashboard

### 3.1 Create the project

1. https://vercel.com/new → import the repo.
2. **Root Directory**: `apps/dashboard`.
3. **Framework Preset**: Next.js (auto-detected).
4. **Build Command**: leave as default (Vercel picks up `vercel.json`).
5. **Install Command**: leave as default.

### 3.2 Environment variables

In the Vercel project **Settings** → **Environment Variables**:

| Variable                        | Scope                | Value                                               |
| ------------------------------- | -------------------- | --------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Production + Preview | from Supabase                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production + Preview | from Supabase (safe-ish)                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | Production + Preview | server-only — **NEVER** prefix with `NEXT_PUBLIC_*` |
| `CSV_MAX_BYTES`                 | optional             | default 20971520 (20MB)                             |

⚠️ The eslint rule in `packages/config/eslint.base.cjs` blocks any code that
references `NEXT_PUBLIC_*` env vars whose names contain `SERVICE`, `SECRET`,
or `PRIVATE`. If you find yourself needing to bypass it, you're about to
ship a security incident.

### 3.3 Branch settings

- **Production branch**: `main`.
- **Auto-deploy on push to main**: enabled.
- **Preview deploys for PRs**: enabled.

### 3.4 Verify

After the first deploy:

```bash
curl https://<dashboard-url>.vercel.app/api/health
# {"ok":true,"service":"faka-dashboard","phase":1,"version":"0.0.0","timestamp":"..."}
```

Log in via `/login` as the Super Admin you seeded in §1.3. You should land on
`/operacion` with the auth-aware topbar showing your email + role badge.

---

## 4. Smoke test (end-to-end)

After both services deploy, run the smoke from your local machine:

```bash
bash scripts/smoke.sh \
  https://<dashboard-url>.vercel.app \
  https://<orchestrator-url>.up.railway.app
```

The script exits 0 if all health checks pass and `csv-upload` is in the
connectors registry with `ok:true`.

---

## 5. Production cutover (later)

When the cliente approves, repeat §1 + §2 + §3 against a fresh Supabase
project named `faka-production` and a separate Railway environment. Reasons
to keep staging + production separate:

- Different anon keys (so a leaked staging key doesn't compromise prod).
- Independent migrations (we can test new migrations on staging before prod).
- Free-tier limits on Supabase apply per project — staging chatter doesn't eat prod quota.

Until then, the staging project IS the only environment. Don't share its
service-role key over insecure channels — Supabase's UI is the only correct
distribution point.

---

## Troubleshooting

| Symptom                                           | Probable cause                                                      | Fix                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Sign-in fails with "Database error granting user" | Auth Hook function not granted to `supabase_auth_admin`             | Re-run migration 0009 (`pnpm --filter @faka/db exec supabase db push`) |
| Analista user sees `total` $ values               | View-by-role grant missing OR `security_invoker = true` not on view | Re-run migrations 0011 + 0012; CC-12 grep check                        |
| `pnpm install` times out on registry              | Network instability between WSL/local + npm                         | Retry; the version pins are stable. CI is the reliable install env     |
| Orchestrator container won't boot                 | Missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` env           | `railway variables --service orchestrator-web` to inspect              |
| Cron heartbeat doesn't fire                       | Railway cron schedule < 5min OR not UTC                             | Adjust `apps/orchestrator/railway.toml`; minimum 5min granularity      |

---

# F2 — Walking Skeleton (WordPress)

Phase 2 layers WordPress on top of the F1 foundation: live webhook ingest,
hourly REST pulls, 5-level matching cascade, validation queue, and the "Hoy"
view. **F2 ships in DEGRADED MODE by default** — the code paths are wired but
require the cliente to deliver four WordPress credentials before anything live
runs. The system stays green and useful (CSV path, dashboard, F1 features)
until those credentials arrive.

> **2026-05-14 Auth Hook bug — fixed but worth remembering.** Migration 0009's
> Auth Hook had two real bugs that surfaced only against staging: (1) used
> `->` (jsonb) instead of `->>` (text) when casting `user_id` from the claims
> payload, causing the role lookup to silently fall through to default; and
> (2) overwrote the top-level `role` claim (`authenticated`) with the
> application-level `user_role`, breaking Supabase's PostgREST authz. Commits
> `7ff7a5a` and `6298dff` fix both. **If you see "Database error granting
> user" after a fresh staging spin-up, re-pull main + re-run `supabase db
> push` to pick up these fixes.**

## F2.1 Environment variables (Railway orchestrator)

Set in the Railway dashboard → orchestrator services → **Variables**. All four
are server-only — never expose them via `NEXT_PUBLIC_*` (the eslint rule in
`packages/config/eslint.base.cjs` will fail CI if you try).

| Variable                   | Value                                                                          | Required for                          |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| `WORDPRESS_API_URL`        | `https://<wp-host>/wp-json/wc/v3` (NO trailing slash)                          | hourly REST pulls + product reembed   |
| `WORDPRESS_API_KEY`        | WC REST consumer key (Settings → Advanced → REST API → Add key, read-only)    | hourly REST pulls                     |
| `WORDPRESS_API_SECRET`     | WC REST consumer secret (shown ONCE at key creation — save it)                 | hourly REST pulls                     |
| `WORDPRESS_WEBHOOK_SECRET` | Random 32+ char string; paste into every WC webhook's "Secret" field too      | `POST /webhooks/wordpress` HMAC check |

Until ALL FOUR are set:

- `/connectors` lists `wordpress` with `ok:false, last_error:"not configured"`.
- `POST /webhooks/wordpress` returns `503 {error:"not_configured"}` (the
  webhook route's degraded-mode short-circuit — Plan 2.3.1).
- The hourly `sync-wp-orders` + `sync-wp-products` crons write a
  `connector_runs` row with `errors_json.reason='not_configured'` and exit 0
  (no API calls, no rate-limit risk).
- The dashboard "Hoy" view still renders with whatever non-WP data exists
  (CSV uploads from F1). `/matching` queue may be empty.

This is the documented degraded-mode contract — it is intentional, not a bug.

## F2.2 WooCommerce admin setup (cliente-side, one-time)

Cliente performs these steps in the WordPress admin once we deliver the
orchestrator URL:

1. **WooCommerce → Settings → Advanced → REST API → Add key**
   - Description: `faka-orchestrator-readonly`
   - User: site admin
   - Permissions: **Read** (read-only is sufficient for F2)
   - Copy the consumer key + secret into Railway as `WORDPRESS_API_KEY` /
     `_SECRET` (see §F2.1).
2. **WooCommerce → Settings → Advanced → Webhooks → Add webhook** — create
   three identical entries, one each for these topics:
   - `Order created`
   - `Order updated`
   - `Product updated`
   - Delivery URL: `https://<orchestrator-host>.up.railway.app/webhooks/wordpress`
   - **Secret:** paste the SAME random string that's in Railway as
     `WORDPRESS_WEBHOOK_SECRET`. The HMAC verify step expects an exact match.
   - API Version: WP REST API v3.
   - Status: **Active**.

If the cliente uses a different WC version that signs with hex digest instead
of base64, RESEARCH §Pitfall 8 covers the fix — but the default modern WC ≥
3.0 builds use base64 and the connector matches.

## F2.3 Migrations to apply (order matters)

F2 adds **seven new migrations** on top of the F1 baseline. They are additive
and apply cleanly via `supabase db push` after F1's 13 migrations land:

```bash
pnpm --filter @faka/db exec supabase db push
```

The expected migration files in `packages/db/supabase/migrations/`, in apply
order:

| File                                                  | Adds                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `20260601000001_product_embeddings.sql`               | `product_embeddings` (vector(1536) + HNSW) + `find_similar_products`   |
| `20260601000002_hoy_views.sql`                        | `v_hoy_totals`, `v_hoy_per_channel(+_analista)`, `_top_products`, `_last_hour` (all SECURITY INVOKER) |
| `20260601000003_raw_events_dedup_index.sql`           | unique index `(canal, delivery_id)` on `raw_events` for webhook dedupe |
| `20260601000004_master_products_nombre_normalizado.sql` | `master_products.nombre_normalizado` column + idx for cascade L3        |
| `20260601000006_product_mappings_metadata.sql`        | `product_mappings.metadata jsonb` for cascade decision audit trail     |
| `20260601000007_raw_orders_processed_flag.sql`        | `raw_orders.processed bool` + partial idx for cron drain               |
| `20260601000008_sale_items_unique.sql`                | unique `(sale_id, line_external_id)` on `sale_items` (idempotent upsert) |

> The migration numbering skips 0005 — that slot was reserved during planning
> and consolidated into 0004. This is intentional; CI is fine with gaps.

After every successful local run:

```bash
pnpm --filter @faka/db run types
git add packages/db/types/database.ts
```

CI's `db-integration` job hard-fails on drift between this file and the
schema. If you can't run Supabase locally (WSL2 + Docker), let CI regenerate
and download `database-types` from the failed-run artifacts (see F1 §1.3).

## F2.4 Railway services added in F2

`apps/orchestrator/railway.toml` declares additional services on top of the F1
trio. After `git pull` on the Railway-connected branch, the dashboard auto-
detects and offers to create them — accept all:

| Service                            | Schedule          | Purpose                                                                                                         |
| ---------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `orchestrator-cron-process-wp-events` | `*/5 * * * *`  | Plan 2.3.2 — drains `raw_orders WHERE canal='wordpress' AND processed=false`. UPSERTs sales/sale_items + cascade. |
| `sync-wp-orders`                   | `0 * * * *`       | Plan 2.3.3 — hourly REST pull from WC orders endpoint (webhook insurance per RESEARCH §Pattern 2)               |
| `sync-wp-products`                 | `0 * * * *`       | Plan 2.3.3 — hourly REST pull from WC products endpoint                                                         |
| `reembed-products`                 | `0 4 * * *` UTC   | Plan 2.3.4 — daily HNSW refresh (sha256 short-circuit; caps at 500 / run; OpenAI optional)                      |
| `re-cascade-unmatched`             | `0 */6 * * *` UTC | Plan 2.3.4 — re-runs cascade on `sale_items WHERE master_sku IS NULL AND created_at > now()-7d`; LLM-budget gated |

The F1 `orchestrator-cron` heartbeat continues to write a `connector_runs` row
every 30 min — verify it after the deploy as before.

## F2.5 Post-deploy verification

After the orchestrator + dashboard redeploy and migrations apply:

```bash
# (A) F1+F2 HTTP smoke — passes in both degraded and configured modes.
bash scripts/smoke-f2.sh \
  https://<dashboard-url>.vercel.app \
  https://<orchestrator-url>.up.railway.app

# (B) Optional: end-to-end latency smoke (15-min budget, WP-06).
#     Requires WORDPRESS_WEBHOOK_SECRET + DATABASE_URL locally; exits 78 (skip)
#     in degraded mode without throwing.
ORCHESTRATOR_URL=https://<orchestrator-url>.up.railway.app \
DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
WORDPRESS_WEBHOOK_SECRET='<same-string-as-in-railway>' \
  node scripts/wp-latency-smoke.ts | tee /tmp/wp-latency.json

# (C) Optional: one-off manual reembed run (catches up any backlog).
railway run --service reembed-products node dist/cron.js reembed-products
```

The JSON report from (B) carries three timings — `t_landed`, `t_cascade`,
`t_view_reflects`. Only `t_view_reflects ≤ 15 min` is the formal WP-06 budget;
the other two are tight engineering targets so we have headroom.

## F2.6 Degraded-mode behaviour reference

Quick reference for what each surface returns when WordPress env vars are
unset (the default until cliente delivers credentials):

| Surface                                  | Behaviour without WP env                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /connectors` (orchestrator)         | `wordpress` entry: `{ok:false, last_error:"not configured"}`                  |
| `POST /webhooks/wordpress`               | `503 {error:"not_configured"}` — webhook route degraded short-circuit         |
| `sync-wp-orders` / `sync-wp-products`    | `connector_runs` row with `errors_json.reason='not_configured'`, exit 0       |
| `reembed-products` (no `OPENAI_API_KEY`) | `connector_runs` row with `errors_json.reason='no_embedding_provider'`, exit 0 |
| `re-cascade-unmatched`                   | Runs against existing CSV-ingested data only; LLM disabled if no key          |
| `/hoy` page                              | Renders with CSV-only data; per-channel chart shows only `csv-upload`          |
| `/matching` queue                        | Empty unless CSV upload triggered cascade enqueue                              |

These behaviours satisfy the F2 cross-cutting check **F2-CC-10** ("WP connector
degrades gracefully without env"). They are stable; the cliente can take as
long as they need to deliver credentials.

## F2.7 Forward reference — F2.1 (Mercado Libre integration)

F2.1 (the INSERTED Mercado Libre phase, planned 2026-05-14) introduces a new
table `oauth_tokens` and reuses the webhook route envelope from
`apps/orchestrator/src/routes/webhooks-wordpress.ts`. When F2.1 deploys, this
runbook will gain a §F2.1 section with ML env vars, OAuth bootstrap steps, and
a new `webhooks-mercadolibre` route. F2.1 has no impact on F2 surfaces — the
two channels run side-by-side.

## F2.8 Troubleshooting (F2-specific additions)

| Symptom                                                | Probable cause                                                          | Fix                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Webhook returns 401 `invalid_signature` consistently   | `WORDPRESS_WEBHOOK_SECRET` mismatch between Railway and WC admin       | Re-paste the SAME string in both places; webhooks fire immediately on save           |
| `/hoy` view empty even after webhook fires             | `process-wp-events` cron not running OR migration 7 (`processed` col) missing | Check `connector_runs` for `kind='process-wp-events'`; re-apply migration `...0007` |
| Cascade always routes to queue (master_sku NULL)       | `master_products.nombre_normalizado` not backfilled                     | Run one-off: `update master_products set nombre_normalizado = normalize(name);`     |
| `wp-latency-smoke.ts` exits 1 with `pg_not_installed`  | `pg` not in workspace deps and script is run from cold install          | `pnpm add -D pg @types/pg` at the repo root, or rely on smoke-f2.sh instead          |
| `reembed-products` writes `no_embedding_provider`      | `OPENAI_API_KEY` unset (intentional — embeddings are optional in F2)    | Set the key when ready; cron picks it up on next fire without redeploy              |
