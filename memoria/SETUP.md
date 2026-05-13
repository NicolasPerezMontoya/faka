# Setup — pasos concretos para desbloquear despliegue

Este doc asume que ya tienes los tokens de Supabase. Si necesitas más detalle, `DEPLOY.md` en la raíz tiene el runbook completo.

## ¿Qué tokens necesitas exactamente?

Hay **3 valores** que vienen de Supabase y se reparten entre 3 lugares:

| Token                          | De dónde sale                                       | Va en                                                     |
| ------------------------------ | --------------------------------------------------- | --------------------------------------------------------- |
| `SUPABASE_URL`                 | Supabase dashboard → Settings → API → "Project URL" | Vercel + Railway + tu `.env` local                        |
| `SUPABASE_ANON_KEY` (pública)  | Settings → API → "anon public"                      | Vercel como `NEXT_PUBLIC_SUPABASE_ANON_KEY`               |
| `SUPABASE_SERVICE_ROLE_KEY` ⚠️ | Settings → API → "service_role secret"              | Vercel + Railway (**nunca** prefijar con `NEXT_PUBLIC_*`) |

Adicional (no de Supabase):

| Token                              | De dónde sale                                              | Va en                                                                |
| ---------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `INITIAL_SUPER_ADMIN_PASSWORD`     | Tú lo eliges (mínimo 12 chars + símbolos)                  | `.env` local cuando corras el seeder                                 |
| `SUPABASE_ACCESS_TOKEN` (para CLI) | https://supabase.com/dashboard/account/tokens → "Generate" | Solo si vas a usar `supabase` CLI fuera del proyecto local; opcional |

## Paso a paso

### 1. Si AÚN no creaste el proyecto Supabase

1. https://supabase.com/dashboard → New project
2. Nombre: `faka-staging`
3. Región: `us-east-1` (Virginia — latencia más baja desde Colombia)
4. Plan: Free (basta para F1; subes a Pro $25/mo cuando volumen lo justifique)
5. Espera ~2 min a que se aprovisione

### 2. Si YA tienes los tokens, aplica las migraciones

**Opción A — desde tu máquina con `supabase` CLI:**

```bash
# Una sola vez: link el repo al proyecto remoto
cd ~/faka
pnpm install   # OJO: si pnpm install falla por red, salta este paso. CI lo hará.
pnpm --filter @faka/db exec supabase login   # interactivo, pide token
pnpm --filter @faka/db exec supabase link --project-ref <tu-project-ref>

# Aplica las 13 migraciones
pnpm --filter @faka/db exec supabase db push

# Verifica que pegó
pnpm --filter @faka/db exec supabase migration list
```

**Opción B — copy/paste SQL directo a Supabase SQL editor** (si pnpm install no coopera):

1. Abre Supabase dashboard → SQL Editor → New query
2. Para cada archivo en `packages/db/supabase/migrations/`:
   - Abre el archivo `.sql`
   - Copia todo el contenido
   - Pega en el SQL editor y ejecuta
   - Repite con el siguiente en orden numérico (0001 → 0013)
3. Al final, ejecuta `packages/db/supabase/seed.sql` para insertar los 5 mapping profiles

### 3. Crea el primer Super Admin

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."   # service_role secret
export INITIAL_SUPER_ADMIN_PASSWORD="UnaContraseñaFuerte123!"

pnpm --filter @faka/db run seed:super-admin
```

Esto crea el usuario `nicolasperezmontoya@gmail.com` en Supabase Auth + le pone `profiles.role = 'super_admin'`. Idempotente — puedes re-correrlo, solo upserta el profile.

### 4. Configura el Auth Hook en Supabase dashboard

Esto suele aplicarse vía migración pero a veces el dashboard requiere confirmación manual:

1. Supabase dashboard → Authentication → Hooks
2. Verifica que `custom_access_token` esté en `pg-functions://postgres/public/custom_access_token_hook`
3. Si no está, créalo manualmente con esa configuración

**Sin esto, el login fallará con "Database error granting user"** (es un gotcha conocido — RESEARCH §4 Pitfall 2).

### 5. Configura Vercel

1. https://vercel.com/new → Import Git Repository → `NicolasPerezMontoya/faka`
2. **Root Directory**: `apps/dashboard`
3. **Framework Preset**: Next.js (auto)
4. **Build Command**: deja default (lee de `vercel.json`)
5. **Environment Variables** — agrega 3:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role secret
6. Deploy

URL queda algo como `https://faka.vercel.app` o `https://faka-xxx.vercel.app`.

### 6. Configura Railway

1. https://railway.app → New Project → Deploy from GitHub repo → `faka`
2. Railway debería detectar `apps/orchestrator/railway.toml` automáticamente
3. Si no, en Settings → Service:
   - **Config as code path**: `apps/orchestrator/railway.toml`
   - **Root directory**: deja vacío (Dockerfile builda desde raíz del repo)
4. **Variables** del servicio `orchestrator-web`:
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role secret
   - `LOG_LEVEL` = `info`
   - `PORT` = `8080`
5. Repite las mismas variables para `orchestrator-cron` si Railway las separa
6. Deploy

URL queda algo como `https://faka-orchestrator.up.railway.app`.

### 7. Smoke test cross-service

```bash
bash scripts/smoke.sh \
  https://faka.vercel.app \
  https://faka-orchestrator.up.railway.app
```

Debería imprimir 3 ✓ y exit 0. Si falla, mira el output específico y revisa la sección Troubleshooting en `DEPLOY.md`.

### 8. Primer login

1. Abre `https://faka.vercel.app/login`
2. Email: `nicolasperezmontoya@gmail.com`
3. Password: el que pusiste en `INITIAL_SUPER_ADMIN_PASSWORD`
4. Te redirige a `/operacion`
5. Topbar muestra "Super Admin" + email

Si llegas a este paso, **Phase 1 está LIVE**.

## ¿Y los tokens de los canales (WordPress / ML / Dropi / etc)?

NO son necesarios para F1. Los conectores son skeletons que tiran `NOT_IMPLEMENTED_F<N>`. Cuando arranquemos F2 (WordPress walking skeleton) necesitarás `WORDPRESS_API_URL` + `WORDPRESS_API_KEY` que se obtienen del wp-admin del cliente.

## Si algo falla en CI

Después del último fix (commit `8f41c38` y siguientes en `memoria/`), CI debería:

1. Setear Node 22.7 desde `.nvmrc`
2. Detectar pnpm 10.28.1 desde `packageManager`
3. Correr `pnpm install` SIN `--frozen-lockfile` (primer run genera lockfile)
4. Pasar lint + format check
5. Setup Supabase CLI + arranca local stack
6. `db reset` aplica las 13 migrations
7. `db:types` genera types/database.ts
8. Si types/database.ts NO existe aún en repo → solo warning, no error
9. Tests integration (cuando los habilites)

Si falla, `gh run view --repo NicolasPerezMontoya/faka <id> --log-failed | head -60` muestra el primer error.
