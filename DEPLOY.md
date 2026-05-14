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
- `orchestrator-cron`: cron schedule `*/30 * * * *` running `node dist/cron.js`.

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
