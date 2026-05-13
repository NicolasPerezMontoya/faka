# Phase 1: Foundation — Context

**Gathered:** 2026-05-13
**Status:** Ready for planning
**Source:** ROADMAP.md + ADRs 001/002/003/004 + discovery-findings.md (PRD express equivalent — see canonical refs below)

<domain>
## Phase Boundary

**What this phase delivers:** The full technical foundation that every later phase depends on. No business logic yet. No channel-specific code beyond the generic `CSVConnector`. The phase succeeds when a clean checkout of the repo can:

1. Deploy Supabase schema (RAW + MASTER + FACTS + MARTS-skeleton + INSIGHTS) including the LOCKED CSV tables (ADR-001) and the empty Mini-CRM tables (ADR-004 stubs).
2. Deploy the Railway orchestrator with `ChannelConnector` interface published and `CSVConnector` as the first concrete implementation.
3. Deploy the Vercel Next.js dashboard with auth (4 roles per ADR-002), role-aware views, and the 3-step CSV upload wizard in "Operación".
4. Run end-to-end: a developer uploads a test CSV → file lands in Supabase Storage → rows in `raw_csv_uploads` + `raw_csv_rows` → audit_log entry → reprocess action works.

**What this phase does NOT deliver:**

- Real connector implementations for WordPress/ML/Dropi/POS/WhatsApp (skeletons only that compile against the interface; impls in F2–F4).
- The matching cascade (that's F2; F1 only sets up the tables it will populate).
- Mini-CRM matching/UI (tables only; logic in F4).
- WhatsApp Business Cloud API integration (F5.5).
- IA insight jobs (F5).
- Any of the dashboard "Hoy" / "Productos" / "Canales" / "Inteligencia" views (those are F2+).

**Verifiable success criteria** (from ROADMAP.md):

1. Supabase staging has the full 5-layer schema deployed with **zero pending migrations**; schema diff is clean.
2. Test CSV upload through Operación 3-step wizard lands rows in `raw_csv_uploads` + `raw_csv_rows`; payload retained in Storage; reprocess action with versioned profile works.
3. 4 roles (super_admin/admin/manager/analista) can log in via Supabase Auth; column-level grants enforced on $ columns and customer columns per ADR-002 matrix; secrets in Railway env vars only.
4. 6 connector skeletons (WP, ML, Dropi, POS, WhatsApp, Falabella) compile against `ChannelConnector` interface; `CSVConnector` is first concrete impl wired into the upload endpoint.
5. Idempotency key `(canal, external_order_id)`, 3× exponential backoff + DLQ, `connector_runs` writes per execution, `audit_log` writes on user mutations — all wired and exercised by integration tests.

</domain>

<decisions>
## Implementation Decisions

### LOCKED (immutable without supersession)

**ADR-001 — CSV upload first-class** (`docs/AMENDMENT-csv-source.md`, `docs/ADR-001` retro-implicit):

- Tables `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles` are part of base schema.
- `CSVConnector` implements `ChannelConnector`; not a side-path.
- 3-step Operación wizard is the upload entry point.
- Supabase Storage retains original payloads; immutable.
- Mapping profiles versioned for reprocessing.

**ADR-002 — 4-role column-level matrix** (`docs/ADR-002-role-matrix.md`):

- Roles: `super_admin`, `admin`, `manager`, `analista`.
- Postgres vistas por rol con grants explícitos en columnas $ y cliente.
- JWT claim `role` propagado via Next.js middleware.
- Tabla `audit_log` con `user_id + role_at_time + action + target_table + target_id + payload_json + at`.
- Primer Super Admin se crea vía CLI seeder con email `nicolasperezmontoya@gmail.com`.

**ADR-003 — WhatsApp split** (`docs/ADR-003-whatsapp-strategy.md`):

- F1 NO incluye WA Cloud API (eso es F5.5).
- F1 NO incluye el form interno (eso es F3).
- F1 sí incluye la tabla `messaging_log` (vacía) preparada para F5.5 outbound.

**ADR-004 — Mini-CRM en MASTER** (`docs/ADR-004-mini-crm.md`):

- Tablas `customers`, `customer_external_links`, `customer_merge_log` creadas vacías en F1.
- `sales.customer_id` nullable FK desde el inicio (no migración en F4).
- Lógica de matching y UI quedan para F4.

### Stack (locked by PROJECT.md)

- **Supabase** como única SoT (Postgres + Auth + Storage + Realtime).
- **Railway** para orquestador Node/TS.
- **Vercel** para Next.js 14 App Router dashboard.
- **Bun o pnpm** como package manager — propongo **pnpm** por compatibilidad con Vercel + monorepos.
- **Supabase Migrations CLI** para schema management (no Prisma, no manual SQL).
- **TypeScript estricto** en todo (no JS).

### Monorepo structure (Claude's discretion, propongo)

```
faka/
  apps/
    dashboard/        # Next.js 14 App Router (Vercel)
    orchestrator/     # Node/TS service (Railway)
  packages/
    db/               # Supabase migrations + generated types + RLS helpers
    schema/           # Zod schemas shared (NormalizedOrder, etc)
    connectors/       # ChannelConnector interface + skeletons + CSVConnector
    auth/             # Supabase Auth helpers, role checks, JWT claim middleware
    ui/               # shadcn/ui components shared between dashboard + future tools
    config/           # tsconfig base, eslint, prettier
  docs/               (existing)
  scripts/discovery/  (existing — Phase 0 deliverables)
  pnpm-workspace.yaml
  package.json
  turbo.json          # Turbo for cached builds across packages
```

### Claude's Discretion (not LOCKED, can iterate)

**Migrations:** Use Supabase CLI (`supabase migrations new`). Each ADR-derived table change = one migration. Numbered sequentially.

**Auth flow:** Supabase Auth `email + password` only for v1 (no magic link, no social). Add magic link in F2 if cliente lo pide.

**JWT custom claim:** propagar `role` via Supabase Auth Hook (`custom_access_token`). El JWT contiene `{ sub, email, role, exp, ... }`. Verificación en Next.js middleware antes de cada request a páginas protegidas.

**Vista pattern**: Generamos las vistas por rol mediante migraciones SQL `CREATE VIEW <table>_view_<role> AS SELECT <cols> FROM <table> WHERE <rls_predicate>`. RLS sigue activo sobre tablas base; las vistas son SECURITY INVOKER (heredan permisos del caller).

**Wizard implementation**: Server Actions de Next.js para el endpoint de upload. Multipart streaming a Storage primero, luego trigger Supabase Edge Function o inline parsing del CSV. Para F1, parsing inline server-side (no Edge Function todavía).

**Testing**:

- Migrations validadas con `supabase db reset` en CI.
- Unit tests para `CSVConnector` y `ChannelConnector` interface en `packages/connectors`.
- Integration test: upload de CSV de prueba (fixture) → assert rows en raw*csv*\*.
- No e2e Playwright en F1; eso entra en F2 cuando haya dashboard real.

**Deployment**:

- Vercel preview por cada PR (auto).
- Railway: 1 service para orquestador, deploy desde main branch.
- Supabase: 1 proyecto staging, 1 producción cuando el cliente apruebe MVP.

**Costos esperados F1**:

- Supabase Free tier (cabe inicialmente; upgrade a Pro $25/mo cuando volumen lo justifique).
- Railway: ~$5/mo por orquestador idle.
- Vercel: $0.
- **Total F1**: <$10/mo. Margen amplio sobre cap $150.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Decisions

- `docs/PRD.md` — Base PRD del proyecto (~20KB)
- `docs/AMENDMENT-csv-source.md` — ADR-001 LOCKED (CSV first-class)
- `docs/ADR-002-role-matrix.md` — LOCKED (4 roles column-level)
- `docs/ADR-003-whatsapp-strategy.md` — LOCKED (WA split)
- `docs/ADR-004-mini-crm.md` — LOCKED (Mini-CRM en MASTER)
- `docs/discovery-findings.md` — Findings de Fase 0 + interpretación de respuestas del cliente
- `.planning/PROJECT.md` — Decisiones del proyecto + constraints
- `.planning/ROADMAP.md` — Phase 1 goal + success criteria

### Schema & Requirements

- `.planning/REQUIREMENTS.md` — REQs FND-01..08 son el scope de F1
- `.planning/intel/constraints.md` — CONSTR-_ IDs referenciados desde FND-_
- `.planning/intel/requirements.md` — Vista detallada de cada REQ
- `.planning/intel/decisions.md` — Decisiones extraídas del PRD + amendment
- `.planning/intel/context.md` — Conector strategies cheatsheet y risk register

### UX

- `docs/sketches/csv-upload-wizard.html` — Mockup HTML del wizard de 3 pasos para "Operación" → CSV Upload. La implementación Next.js + shadcn/ui debe matchear este flujo.

### CSV templates (servirán para validación de FND-06/07)

- `docs/csv-templates/README.md` + 5 plantillas por canal
- `scripts/discovery/profiles/*.json` — los pre-seed serán las primeras filas de `csv_mapping_profiles` en seed migrations

### Phase 0 outputs (input para F1)

- `scripts/discovery/` — script de matching exploratorio; sus tipos canónicos (CanonicalProduct) inspiran el schema de `master_products`
  </canonical_refs>

## Specific Ideas

- **Schema versioning**: cada migración es un `<timestamp>_<descripcion>.sql` con UP + DOWN. `db reset` debe correr todas sin errores.
- **Seeders**: tras schema, correr seeder que: (a) inserta los pre-seed `csv_mapping_profiles` con los JSONs de `scripts/discovery/profiles/`; (b) crea Super Admin inicial con email del dev.
- **Type generation**: `packages/db` corre `supabase gen types typescript` post-migration; los tipos viven en `packages/db/types/database.ts` y se re-exportan para que las apps los consuman.
- **`ChannelConnector` interface contract**: incluye `fetchOrders`, `fetchProducts`, `fetchInventory?`, `normalizeOrder`, `normalizeProduct`, `healthCheck`, además de los hooks ADR-004-ready `extractCustomerHint?(order): CustomerHint | null` (para que F4 los enchufe sin tocar el interface).
- **Wizard UI**: Next.js Server Action por step; el state del wizard vive en URL (`?step=2&upload=u_xyz`) para que F5 después pueda reusarlo.

## Deferred Ideas

Estas NO entran en F1 pero conviene tenerlas anotadas:

- Magic link auth (cliente pidió email/password en cuestionario; magic link es F2 si lo necesita).
- shadcn/ui custom registry para componentes del proyecto (deferred a F3 cuando haya más componentes).
- Edge Functions para CSV parsing pesado (deferred a cuando un upload pase de 20MB).
- Row-level encryption para datos sensibles de clientes (deferred a post-F4 cuando Mini-CRM esté lleno).
