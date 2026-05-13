# faka — Dashboard Omnicanal de Ventas + Capa de IA

Dashboard que consolida ventas de 5+ canales (WordPress, Mercado Libre Colombia, Dropi, POS físicos, WhatsApp) con catálogo unificado vía matching cascade + capa de IA para insights autónomos AM/PM y chat conversacional.

## Stack

- **Supabase** — Postgres + Auth + Storage + Realtime (única source of truth de datos)
- **Railway** — orquestador Node/TS (cron + workers)
- **Vercel** — Next.js 14 App Router dashboard
- **Turborepo + pnpm workspaces** — monorepo
- **Vercel AI Gateway** default para LLM (Anthropic/OpenAI/Google/Moonshot intercambiables vía env)

## Estructura del monorepo

```
faka/
  apps/
    dashboard/           # Next.js 14 App Router (Vercel)
    orchestrator/        # Hono server + cron (Railway)
  packages/
    config/              # tsconfig base, eslint, prettier compartido
    db/                  # Supabase migrations + tipos generados
    schema/              # Zod schemas compartidos (NormalizedOrder, etc.)
    connectors/          # ChannelConnector interface + skeletons + CSVConnector
    auth/                # Helpers de Supabase Auth, role checks, JWT middleware
    ui/                  # Componentes shadcn/ui compartidos (futuro)
  scripts/
    discovery/           # Fase 0 — script exploratorio de matching CSV
  docs/                  # PRD, ADRs, plantillas CSV, sketches UX
  .planning/             # GSD planning artifacts (auto-managed por skills)
```

## Quickstart

**Requisitos:** Node 22.7+, pnpm 11.1.1+, Docker (para Supabase local).

```bash
# 1. Activar Corepack para pinear pnpm a la versión correcta
corepack enable
corepack prepare pnpm@11.1.1 --activate

# 2. Instalar dependencias
pnpm install

# 3. Copiar variables de entorno
cp .env.example .env
# Edita .env con tus credenciales locales

# 4. Iniciar Supabase local (requiere Docker corriendo)
pnpm --filter @faka/db exec supabase start

# 5. Aplicar migraciones + seed
pnpm db:reset

# 6. Generar tipos TS desde el schema
pnpm db:types

# 7. Levantar dashboard + orchestrator en watch mode
pnpm dev
```

Dashboard en `http://localhost:3000`. Orchestrator en `http://localhost:4000`.

## Documentación

- **`docs/PRD.md`** — Producto y arquitectura
- **`docs/ADR-001`** (en `docs/AMENDMENT-csv-source.md`) — CSV upload como fuente de primera clase
- **`docs/ADR-002-role-matrix.md`** — 4 roles con permisos column-level
- **`docs/ADR-003-whatsapp-strategy.md`** — Split form (F3) + Cloud API (F5.5)
- **`docs/ADR-004-mini-crm.md`** — Mini-CRM en capa MASTER
- **`docs/discovery-findings.md`** — Hallazgos de Fase 0
- **`docs/sketches/csv-upload-wizard.html`** — Mockup UX del wizard de upload (abre en browser)
- **`scripts/discovery/README.md`** — Script exploratorio de matching de Fase 0

## Planning

El proyecto usa [GSD](https://get-shit-done.dev) para planning. Artifacts en `.planning/`:

- `PROJECT.md` — Decisiones del proyecto
- `ROADMAP.md` — 7 fases (0 → 1 → 2 → 3 → 4 → 5 → 5.5 → 6)
- `REQUIREMENTS.md` — 40 requirements con trazabilidad por fase
- `phases/<N>-<slug>/` — Plans atómicos por fase

## Licencia

Privado. Cliente externo.
