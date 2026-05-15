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

---

# F2.1 — Mercado Libre Colombia

Phase 2.1 (INSERTED 2026-05-14 per cliente decision) layers Mercado Libre Colombia
on top of the F2 walking-skeleton. Same architectural shape as F2: production-ready
code that **DEGRADES GRACEFULLY** when ML env vars are unset, plus one new dashboard
route (`/operacion/conectar-mercadolibre`) used once per seller for OAuth bootstrap.
ML rows surface on F2's existing `/hoy` + `/matching` views with NO new ML-specific
pages (CC-12 invariant carried forward).

> **2026-05-15 — ML app already registered.** Cliente registered the developer app
> at https://developers.mercadolibre.com.co with app_id `3933497047128728`. Env
> vars currently live in **Vercel** (orchestrator-temporarily — until the
> orchestrator gets its own Railway deploy, dashboard server actions read the
> client_id from Vercel env and the callback writes to oauth_tokens via the
> service-role client). When the orchestrator deploys to Railway, move
> `ML_CLIENT_SECRET` + `ML_WEBHOOK_SECRET` to Railway and leave `ML_CLIENT_ID` +
> `ML_REDIRECT_URI` mirrored in both (the dashboard still needs the client_id +
> redirect to build the authorize URL server-side).

## F2.1.0 Prerequisites

The cliente MUST register the Mercado Libre developer app at
https://developers.mercadolibre.com.co BEFORE F2.1 sync runs in production.
**This is already done as of 2026-05-15** (app_id `3933497047128728`). If the
app is ever rotated (compromised, deleted, or rebuilt against a fresh seller),
re-run the registration runbook below.

### F2.1.0.a App registration runbook (only re-run if rotating)

Operator (or cliente) performs these steps at https://developers.mercadolibre.com.co
ONCE per seller account:

1. Log in with the seller's ML account (the same login that owns the storefront).
2. Click **Crear app** → fill name (`faka-orchestrator`), short description
   (`Sincronización de pedidos y productos para faka — dashboard interno`),
   category (`Gestión de pedidos`).
3. **Redirect URI** — set to EXACTLY (no trailing slash, no extra path):
   - Production: `https://orchestrator.fakawholesale.com/oauth/mercadolibre/callback`
   - Dev/local:  `http://localhost:8080/oauth/mercadolibre/callback`
   - **Vercel preview URLs are NOT valid** — ML's auth server rejects redirects
     it has not pre-approved. Use the stable orchestrator hostname or `localhost`
     (RESEARCH §Pitfall 12).
4. **Webhook URL** — set to:
   - Production: `https://orchestrator.fakawholesale.com/webhooks/mercadolibre`
5. **Scopes** — request `read write offline_access` (the `offline_access` scope
   is the one that issues the refresh_token; without it, tokens go invalid after
   6h with no recovery).
6. Copy the credentials from the ML dev console:
   - App ID → `ML_CLIENT_ID`
   - Secret Key → `ML_CLIENT_SECRET`
   - Notification Secret → `ML_WEBHOOK_SECRET`
7. Hand off the secret values via 1Password / Bitwarden / equivalent shared
   vault. **NEVER paste them into email, Slack, or any chat.**

## F2.1.1 Environment variables

Set in the Vercel (or Railway when orchestrator deploys) project → orchestrator
service → **Variables**. All five are server-only — never expose them via
`NEXT_PUBLIC_*` (the eslint rule extended by F2.1 Plan 2.1.0.3 in
`packages/config/eslint.base.cjs` will fail CI if you try).

| Variable                   | Value                                                                      | Required for                                |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| `ML_CLIENT_ID`             | App ID from ML dev console (e.g. `3933497047128728`)                       | OAuth authorize + token exchange + refresh  |
| `ML_CLIENT_SECRET`         | Secret Key from ML dev console (shown ONCE on app creation; rotatable)     | OAuth token exchange + refresh              |
| `ML_REDIRECT_URI`          | `https://orchestrator.fakawholesale.com/oauth/mercadolibre/callback`       | OAuth callback (must EXACT-match app config) |
| `ML_WEBHOOK_SECRET`        | Notification Secret from ML dev console (signed-query-params HMAC verify)  | `POST /webhooks/mercadolibre` HMAC verify   |
| `ML_SITE_ID`               | `MCO` (hardcoded in `types.ts`; env mirror for ops visibility)             | Currency / locale assertions in connector   |

**Where they live today (2026-05-15):** All five in **Vercel** (orchestrator-
temporarily). When the orchestrator deploys to Railway, move `ML_CLIENT_SECRET`
+ `ML_WEBHOOK_SECRET` to Railway and keep `ML_CLIENT_ID` + `ML_REDIRECT_URI`
mirrored in both (dashboard server actions need the client_id to build
authorize URLs).

Until ALL FIVE are set, the connector ships in **degraded mode** — see §F2.1.6
for the surface-by-surface behavior table.

## F2.1.2 Migrations to apply (order matters)

F2.1 adds **four new migrations** on top of the F1+F2 baseline. They are additive
and apply cleanly via `supabase db push` after F1's 13 + F2's 7 migrations land:

```bash
pnpm --filter @faka/db exec supabase db push
```

The expected migration files in `packages/db/supabase/migrations/`, in apply
order (after the F2 series ending at `20260601000008_sale_items_unique.sql`):

| File                                                | Adds                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `20260615000001_oauth_tokens.sql`                   | `oauth_tokens` table + service-role-only RLS + `unique (canal, user_id)`     |
| `20260615000001b_advisory_lock_fn.sql`              | `pg_try_advisory_xact_lock` wrapper fn for refresh-race protection           |
| `20260615000002_product_variants_unique.sql`        | Additive unique `(master_sku, attributes_hash)` on `product_variants`        |
| `20260615000003_oauth_state.sql`                    | `oauth_state` CSRF nonce table + 10-min TTL cleanup                          |

After every successful local run:

```bash
pnpm --filter @faka/db run types
git add packages/db/types/database.ts
```

> The `oauth_tokens` row count after the cliente completes the connect-flow
> should be exactly **1** per canal — the connector reads "the one row" via
> `limit 1`. Multi-account support is multi-ready in the schema (`unique
> (canal, user_id)`) but v1 writes only one row.

## F2.1.3 Railway services added in F2.1

`apps/orchestrator/railway.toml` declares additional services on top of the
F1+F2 set. After `git pull` on the Railway-connected branch, the dashboard
auto-detects and offers to create them — accept all:

| Service                                  | Schedule          | Purpose                                                                                                       |
| ---------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `orchestrator-cron-ml-refresh-tokens`    | `0 */5 * * *`     | Plan 2.1.1.4 — 5h safety-net refresh; advisory-lock-gated so it never races with the lazy in-flight refresh. |
| `orchestrator-cron-sync-ml-orders`       | `*/15 * * * *`    | Plan 2.1.3.2 — every 15min REST pull from `/orders/search` with `from_id` pagination + idempotent UPSERT.    |
| `orchestrator-cron-sync-ml-products`     | `0 * * * *`       | Plan 2.1.3.3 — hourly REST pull from `/users/{id}/items/search` with `scroll_id` pagination + variants.      |

All three crons use `kind:"channel", canal:"mercadolibre"` in `connector_runs`
(W2 invariant carried forward from F2). They `process.exit(0)` on success AND
on degraded mode (silences pager noise during pre-OAuth period — RESEARCH
§Environment Availability).

> **Staggering:** `sync-ml-products` runs at the top of the hour (`0 * * * *`).
> `sync-ml-orders` runs every 15min (`*/15 * * * *`) — so at top-of-hour both
> fire together. ML's documented rate limit (10k calls/h per seller per scope)
> easily absorbs this; no staggering is needed for v1. If a future cron is
> added that competes for the same access_token, stagger it 5–10min off.

## F2.1.4 OAuth bootstrap procedure (one-time per seller)

The orchestrator + dashboard talk to ML on behalf of the cliente by holding a
long-lived `refresh_token` in `oauth_tokens`. The operator initiates the
authorize flow ONCE; ML redirects to the orchestrator's callback; tokens land
in the DB; from then on all syncs use those tokens transparently.

1. **Login** to the dashboard as **super_admin** (the only role with access
   to `/operacion/conectar-mercadolibre`).
2. **Navigate** to `/operacion/conectar-mercadolibre`. The page surfaces one
   of two states:
   - **Not configured** — env vars missing; surfaces a red pill "Not
     configured. Set `ML_CLIENT_ID/SECRET/REDIRECT_URI/WEBHOOK_SECRET` on
     orchestrator and reload." NO connect button. **STOP** — finish §F2.1.1
     first.
   - **Ready to connect** — env vars set; surfaces a green "Connect Mercado
     Libre" button.
3. **Click** "Connect Mercado Libre". The Server Action `start-oauth.ts`:
   - Inserts a fresh row into `oauth_state` with a UUID nonce + 10-min TTL.
   - Redirects the browser to
     `https://auth.mercadolibre.com.co/authorization?response_type=code&client_id=$ML_CLIENT_ID&redirect_uri=$ML_REDIRECT_URI&state=<nonce>`.
4. **Cliente approves on ML** — at the ML auth page, the cliente logs in
   with the seller account and clicks **Autorizar**. ML redirects to
   `$ML_REDIRECT_URI?code=<auth_code>&state=<nonce>`.
5. **Orchestrator callback** at `/oauth/mercadolibre/callback`:
   - Verifies the `state` nonce matches a non-expired row in `oauth_state`
     (CSRF check); deletes the row on use.
   - Exchanges `code` for tokens via `POST /oauth/token` (grant_type=authorization_code).
   - UPSERTs the resulting `{ access_token, refresh_token, expires_at, user_id }`
     into `oauth_tokens` keyed by `(canal='mercadolibre', user_id)`.
   - Redirects back to `/operacion/conectar-mercadolibre?status=success`.
6. **Verify** the token landed with a single read-only SQL (NO values are
   displayed — just confirm the row exists):

   ```sql
   SELECT canal, user_id, expires_at
   FROM oauth_tokens
   WHERE canal = 'mercadolibre';
   ```

   Expected: exactly 1 row; `expires_at` ~6h in the future; `user_id` is the
   seller's ML internal id.

After this ceremony completes, the three crons (§F2.1.3) start producing real
data within their next scheduled tick. No code redeploy is required to flip
from degraded mode to live.

### F2.1.4.a Secret rotation runbook

If `ML_CLIENT_SECRET` needs to be rotated (suspected leak, scheduled rotation,
etc.):

1. Rotate in ML dev console → app settings → **Regenerate Secret Key**. ML
   shows the new value ONCE — capture it before navigating away.
2. Update Railway (or Vercel) env: `ML_CLIENT_SECRET=<new-value>`.
3. **Restart** the orchestrator service so the new value loads.
4. **DO NOT re-run the OAuth flow.** Existing access + refresh tokens keep
   working until they expire (~6h for access; refresh is single-use but
   long-lived). The new secret is ONLY used the next time the connector
   calls `POST /oauth/token` (refresh). Forcing a re-auth is unnecessary and
   would interrupt active syncs.

### F2.1.4.b Revoke + re-auth runbook (compromise)

If `oauth_tokens` is suspected compromised (e.g., service-role key leaked, DB
backup exfiltrated):

1. **Revoke the app** in ML dev console — this invalidates ALL tokens
   immediately, including in-flight refresh tokens.
2. Delete the row(s) via service-role SQL (the only role with write
   access — F2.1 Plan 2.1.1.1 RLS):

   ```sql
   DELETE FROM oauth_tokens WHERE canal = 'mercadolibre';
   ```

3. Rotate `ML_CLIENT_SECRET` per §F2.1.4.a.
4. Cliente re-completes the connect-flow at `/operacion/conectar-mercadolibre`
   per §F2.1.4 (steps 1–6).

## F2.1.5 Post-deploy verification

After the orchestrator + dashboard redeploy and migrations apply:

```bash
# (A) F1 + F2 + F2.1 HTTP smoke — passes in both degraded and configured modes.
bash scripts/smoke-f2.1.sh \
  https://<dashboard-url>.vercel.app \
  https://<orchestrator-url>.up.railway.app

# (B) Optional: end-to-end 15-min latency smoke (Plan 2.1.4.4).
#     Requires ML_WEBHOOK_SECRET + DATABASE_URL locally; exits cleanly in
#     degraded mode (no creds → skips the live HMAC step + reports skip).
ORCHESTRATOR_URL=https://<orchestrator-url>.up.railway.app \
DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
ML_WEBHOOK_SECRET='<same-string-as-in-railway>' \
  pnpm --filter @faka/orchestrator exec tsx scripts/ml-latency-smoke.ts | tee /tmp/ml-latency.json

# (C) Optional: one-off manual sync run (catches up any backlog).
railway run --service orchestrator-cron-sync-ml-orders node dist/cron.js sync-ml-orders
```

The JSON report from (B) carries timings — `t_webhook_acked`, `t_raw_event_landed`,
`t_cascade_fired`, `t_view_reflects`. Only `t_view_reflects ≤ 15 min` is the
formal ML-01 budget; the others are tight engineering targets so we have headroom.

## F2.1.6 Degraded-mode behaviour reference

Quick reference for what each surface returns when ML env vars are unset (the
default until cliente completes the bootstrap):

| Surface                                                | Behaviour without ML env                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `GET /connectors` (orchestrator)                       | `mercadolibre` entry: `{ ok: false, last_error: "not configured", missing: [...] }`     |
| `fetchOrders` / `fetchProducts` (connector)            | Returns `[]` + structured warning; NO API call attempted                                |
| `POST /webhooks/mercadolibre`                          | `503 { error: "not_configured" }` — webhook route degraded short-circuit               |
| `GET /oauth/mercadolibre/callback`                     | `503 { error: "not_configured" }` — callback route degraded short-circuit              |
| `orchestrator-cron-ml-refresh-tokens` (every 5h)       | `connector_runs` row with `errors_json.reason='not_configured'`, exit 0                |
| `orchestrator-cron-sync-ml-orders` (every 15min)       | `connector_runs` row with `errors_json.reason='not_configured'`, exit 0                |
| `orchestrator-cron-sync-ml-products` (every 1h)        | `connector_runs` row with `errors_json.reason='not_configured'`, exit 0                |
| `/operacion/conectar-mercadolibre` (dashboard)         | Red pill "Not configured"; lists missing env vars; NO connect button                   |
| `/hoy` page                                            | Renders with whatever non-ML data exists (CSV + WP); per-channel chart shows no `mercadolibre` slice |
| `/matching` queue                                      | Empty of ML rows; WP + CSV rows still surface normally                                  |

These behaviours satisfy F2.1 requirement **ML-06** ("connector ships in
degraded mode") and the cross-cutting check **F2.1-CC-DEGRADED**. They are
stable; the cliente can take as long as they need to complete the OAuth
bootstrap.

## F2.1.7 Out-of-scope reminder

F2.1 is **MCO only, single seller, items mode only**. Explicitly NOT included:

- Other ML sites (MLA Argentina, MLM Mexico, MLB Brazil) — `siteId` is hardcoded
  `"MCO"` in `types.ts`; currency hardcoded `"COP"`.
- Multi-account ML support — schema is multi-ready but v1 writes 1 row only.
- ML Shipments / Logistics API — carrier metadata stays in `raw_orders.payload_json`.
- ML Messaging / Questions API — webhook topic `messages` is logged + dropped
  with 200; `messaging_log` stays empty (CC-14 invariant carried forward; the
  smoke asserts it).
- ML Catalog Products mode — items with `catalog_product_id != null` are DLQ'd
  + skipped by variant-mapper. MCO 2026 adoption is unconfirmed
  (RESEARCH §Assumption A2); if the smoke's catalog-mode counter shows > 0
  per cron run, revisit in a follow-up phase.
- Per-variant pricing schema column — F2.1 stashes per-variation `price` +
  `available_quantity` under `atributos_json.__pricing` as nested metadata.
- Dashboard ML-specific pages — F2.1 adds NO new views besides
  `/operacion/conectar-mercadolibre`. ML rows surface on F2's channel-agnostic
  `/hoy` + `/matching` automatically.

## F2.1.8 Troubleshooting (F2.1-specific additions)

| Symptom                                                       | Probable cause                                                                                  | Fix                                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Webhook returns 401 `invalid_signature` consistently          | `ML_WEBHOOK_SECRET` mismatch between Railway and ML dev console                                | Re-paste the Notification Secret from the ML dev console into Railway env; restart service                |
| Webhook returns 401 with a CORRECT secret                     | Signed-query-params canonical-string builder mismatch (sort order, URL-encoding edge case)      | Check `packages/connectors/src/mercadolibre/webhook-verify.ts` — ML signs SORTED query params, NOT body  |
| OAuth callback returns 403 `invalid_state`                    | `oauth_state` row expired (>10min) OR state nonce mismatch (cookie/storage cleared mid-flow)    | Cliente retries the connect ceremony — the nonce is single-use; old links die after 10min                 |
| Refresh-token cron writes `concurrent_refresh_in_progress`    | Two crons OR cron + lazy-refresh raced; advisory lock did its job — one held, one skipped       | Expected behaviour; not a bug. Verify the held one wrote a new row; the skipped one exits 0 silently     |
| `/orders/search` returns currency NOT `COP`                   | Seller has a non-MCO listing in their catalog (rare); F2.1 hardcodes MCO/COP                   | Connector rejects the order at `assertCurrency` + writes a DLQ row; investigate seller's catalog          |
| `sync-ml-products` writes `catalog_mode_skipped` counter > 0  | ML's catalog-products mode (Assumption A2) has > 0 adoption in MCO 2026                        | Decision point: revisit catalog-mode support in a follow-up phase. Track count for trend; not a bug      |
| `/operacion/conectar-mercadolibre` 404                        | Dashboard not deployed yet OR user lacks `super_admin` role                                     | Check Vercel deploy + `auth.users.role`; only super_admin sees the route per role-matrix.ts              |
| `ml-refresh-tokens` exits 0 but no new row in `oauth_tokens`  | `oauth_tokens` is empty — bootstrap not completed                                              | Complete §F2.1.4 OAuth bootstrap first. Cron has nothing to refresh until the first row exists           |
