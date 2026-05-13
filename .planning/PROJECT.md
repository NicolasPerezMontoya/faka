# faka — Dashboard Omnicanal de Ventas + Capa de IA

## What This Is

A consolidated sales dashboard with an AI layer for a Colombian televentas (telenovedades) business operating across 5 channels: WordPress, Mercado Libre Colombia, Dropi (proveedor), 2 POS físicos propios, and WhatsApp Business — with Falabella Marketplace deferred. It unifies sales, inventory, and product data into a single Postgres source of truth, runs an AI matching pipeline to reconcile thousands of un-normalized SKUs across channels, and serves twice-daily autonomous insights plus a conversational chat over the consolidated marts. Audience: Nicolás (developer), the client (business owner), and the client's spouse — 3 users at launch.

## Core Value

**One trusted, sub-15-minute view of "what is selling, where, right now"** across every channel — built on a unified catalog that the AI helps create, not just analyze.

If everything else fails, this must work: a developer/owner opens the dashboard and immediately sees today's consolidated sales by channel with reliable product attribution. Catalog normalization (matching) is the hardest part of the project and the precondition for the rest of the value — analytics, insights, and chat all depend on it.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- v1 scope. Building toward these. Full list in REQUIREMENTS.md. -->

- [ ] Discovery & catalog normalization with CSV-driven baseline (Phase 0)
- [ ] Foundation: Supabase 5-layer schema, Railway orchestrator skeleton, Vercel dashboard, auth/RLS, CSV upload first-class (Phase 1)
- [ ] Walking skeleton end-to-end with WordPress + matching cascade + validation queue + "Hoy" view (Phase 2)
- [ ] POS webhooks + WhatsApp internal mini-app + "Productos" + "Operación" health (Phase 3)
- [ ] Mercado Libre OAuth + Dropi (Playwright + CSV fallback) + advanced marts + email alerts (Phase 4)
- [ ] AI layer: LLMProvider adapter, AM/PM insight jobs, chat RAG over marts, versioned prompts (Phase 5)
- [ ] Falabella connector + Prophet demand prediction + replenishment recommender (Phase 6, optional)

### Out of Scope

<!-- Explicit boundaries with reasoning to prevent re-adding. -->

- **WhatsApp Business API integration (v1)** — internal manual form keeps cost at $0 and ships in weeks, not months
- **Auto-executing AI actions** — v1 chat surfaces suggestions only; humans pull the trigger to avoid trust/safety failures early
- **Mobile native app** — web-first dashboard sufficient for 3 internal users
- **Cross-channel real-time inventory rebalancing** — v1 captures snapshots, not active orchestration
- **Multi-tenant SaaS** — single client; RLS exists for role isolation, not tenant isolation
- **Workloads beyond ~5,000 transactions/month** — schema & indexing tuned for current scale, not Mn+/month
- **Generative video / image content** — out of scope; AI is for matching, insights, and chat only
- **Stripe / billing / customer-facing checkout** — this is an internal operations tool, not a storefront

## Context

- **Domain:** televentas / e-commerce omnicanal en Colombia. Catálogo de miles de SKUs con variantes; sin normalización entre canales; sin identificadores comunes confirmados al inicio.
- **Two parallel challenges:** (1) technical — orchestrator + DB + dashboard + IA, deterministic; (2) data quality — without a trusted master catalog, analytics is noise. The roadmap front-loads (2) via a dedicated Phase 0 and uses IA as the matching engine from day one.
- **Connector cheatsheet:**
  - WordPress: REST + WC/plugin webhooks; realtime + 1h sync.
  - Mercado Libre CO: API oficial con OAuth; orders 15 min, products 1h.
  - Dropi: Playwright scraper del panel; 30 min cadence; frágil → CSVConnector fallback (LOCKED).
  - POS propio: webhooks emitidos al orquestador; realtime; co-diseño con el programador del POS.
  - WhatsApp: formulario interno (manual entry); sin WhatsApp Business API en v1.
  - Falabella: Sellercenter API; esqueleto en Fase 1, activación en Fase 6.
  - CSV upload (LOCKED): first-class, channel-agnostic, en cualquier fase y para cualquier canal.
- **AI rationale:** Kimi K2 candidato base; alternativas Claude Haiku 4.5, GPT-4o-mini, Gemini 2.5 Flash detrás del mismo `LLMProvider` adapter. Modos: autónomo (AM/PM) + conversacional (RAG sobre marts pre-resumidos).
- **Matching cascade:** EAN/barcode → código interno proveedor → nombre normalizado → embeddings de texto → imagen (CLIP, cuando exista) → LLM como árbitro. Items por debajo del threshold caen a cola de validación humana; cada validación refuerza reglas.
- **Risk register (top items):**
  - Dropi cambia su panel (Alta) → **CSV upload primario** (LOCKED) + health check.
  - Cliente sin acceso/credenciales (Alta) → documentar requisitos antes de Fase 1; bloquear conector si falta credencial.
  - Catálogo no normaliza bien con IA (Media) → cola humana + iterar prompts; aceptar 90/10.
  - WhatsApp manual no se llena (Media) → formulario de 4 clics + recordatorios al cierre.
  - POS no emite eventos a tiempo (Media) → polling de respaldo + alerta si >2h sin recibir.
  - Costos IA disparados (Baja) → caching de queries similares + tope diario de tokens.
  - Mercado Libre rate-limits (Baja) → backoff exponencial; sincronización incremental.
- **Provenance:** Synthesized from `docs/PRD.md` (PRD, precedence 2) and `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED, precedence 0). See `.planning/intel/SYNTHESIS.md`.

## Constraints

- **Budget**: ≤ $150 USD/month infra + servicios (hard cap). Target operating point ~$50–85/mo, leaving ~$65 headroom. — Solo developer, single client; no room for enterprise-tier infra.
- **Tech stack — Database/Auth/Storage**: Supabase Postgres ($0 free → $25 Pro) with Auth, Storage, Realtime; RLS mandatory on user-readable tables. — Single SoT; auth + RLS included; storage for CSV payload retention.
- **Tech stack — Orchestrator**: Node.js + TypeScript on Railway ($5–10/mo) for cron jobs + workers. — Cheapest reliable cron platform that runs TS natively.
- **Tech stack — Dashboard**: Next.js 14 (App Router) on Vercel free tier. — Matches the team's existing skills; $0 hosting.
- **Tech stack — AI**: Kimi K2 baseline (~$20–50/mo via API), behind a pluggable `LLMProvider` adapter that also supports Claude Haiku 4.5, GPT-4o-mini, Gemini 2.5 Flash. Provider swappable via env var only. — Cost/quality optimization for Spanish + reasoning; vendor lock-in is unacceptable.
- **Tech stack — Monitoring**: Better Stack or Axiom free tier. — Cost cap.
- **Data scale**: System sized for ~5,000 consolidated transactions/month. — Real volume at launch; architecture and indexing tuned to this, not Mn+/month.
- **Performance — MVP latency**: Day-sales reflected in dashboard within 15 min of source transaction (CONSTR-mvp-latency). — Operational decisions can't wait hours.
- **Data quality — matching coverage**: ≥80% of `sale_items.master_sku` non-null by end of Phase 1 (CONSTR-matching-coverage). — Below this, analytics is unreliable.
- **Product quality — AI insight usefulness**: ≥70% of generated insights marked "útil" after 2 weeks of use (CONSTR-ai-insight-usefulness, end of Phase 5). — Insight quality, not volume.
- **Security — RLS**: Row-Level Security MUST be enabled on all user-readable Postgres tables. — Role boundaries (owner/developer/staff) enforced at DB level.
- **Security — Secret storage**: Channel API keys and provider keys MUST live in Railway env vars only. Forbidden in Supabase tables, frontend bundles, or source control. — Prevents leaks via dashboard token exfil or repo exposure.
- **Observability — Connector runs**: Every connector run MUST write to `connector_runs(timestamp, duración, registros_procesados, errores)`; surfaced in dashboard "Operación" view. — Health visibility is non-negotiable for a multi-connector system.
- **Observability — Audit log**: `audit_log` table MUST record who-did-what-when for user-initiated mutations (uploads, match validations, manual overrides). — Multi-user write traceability.
- **Protocol — Idempotency**: `(canal, external_order_id)` is the unique ingestion key across all connectors; re-ingestion MUST be a no-op. — Connectors retry; duplicates corrupt facts.
- **Protocol — Retries**: Failed external fetches MUST retry 3× with exponential backoff; final failure → dead-letter queue (not lost). — Network reality across 5+ external systems.
- **Connector interface**: All channel connectors MUST implement the `ChannelConnector` TS interface (see `.planning/intel/constraints.md` CONSTR-channel-connector-interface). New channels conform without modifying existing connectors. — Open/closed pluggability across 6 current+future channels.
- **Timeline**: Total 10–14 weeks end-to-end; usable MVP at end of Phase 3 (POS+WhatsApp), ~5 weeks in. — Solo developer + client patience window.

## Key Decisions

<!-- LOCKED decisions are immutable without explicit supersession. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **ADR-001 (LOCKED) — CSV Upload as first-class data source** (overrides PRD §3.4 "Plan B" framing). Permanent, channel-agnostic. New RAW tables `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles`. Generic `CSVConnector` implementing `ChannelConnector`. Operación-view 3-step wizard. Supabase Storage retention of original payloads (immutable). Mapping profiles with versioning for reprocessing. Reshapes Phase 0, 1, 2, 4 deliverables. | Unblocks Phase 0 (catalog historical exports); reduces risk (API breakage → CSV keeps business running); enables unlimited backfill; immutable raw payload supports re-running corrected mappings without data loss. | 🔒 LOCKED — Accepted 2026-05-13, Decisor: Nicolás. Source: `docs/AMENDMENT-csv-source.md`. Immutable without explicit supersession. |
| **ADR-002 (LOCKED) — Matriz de roles column-level**. Cuatro roles (`super_admin`, `admin`, `manager`, `analista`) con permisos column-level: Manager no ve datos de cliente; Analista no ve dinero $ ni cliente. Requiere vistas por rol en Postgres + grants explícitos + JWT-claim middleware. Supera la propuesta original de 3 roles row-level del PRD §3.7. | Sin column-level, un Analista podría ver márgenes reales o exportar directorio de clientes (riesgo operativo). Definirlo en F1 cuesta 1 día de schema; reconstruirlo post-F2 requiere migración con downtime y rewrite de queries. | 🔒 LOCKED — Accepted 2026-05-13, Decisor: cliente. Source: `docs/ADR-002-role-matrix.md`. |
| **ADR-003 (LOCKED) — Estrategia WhatsApp split**. F3 mantiene formulario interno como entrada/fallback. F5.5 (NUEVA, insertada entre F5 e F6) integra WhatsApp Business Cloud API: webhook receiver, parser de pedidos entrantes, sender de insights AM/PM al teléfono del dueño. `MessagingProvider` adapter para swap Cloud API / Twilio / 360dialog. Supera "manual form únicamente" del PRD §3.4. | Cliente prefiere integración real (Bloque D.5) e insights por WhatsApp (Bloque H). Split protege el MVP de F3 (no depende de verificación Meta que puede tardar 1–2 semanas) y permite reutilizar la infraestructura de mensajería para el output de IA. Costo adicional: USD 1–5/mes (dentro de cap $150). | 🔒 LOCKED — Accepted 2026-05-13, Decisor: cliente + dev. Source: `docs/ADR-003-whatsapp-strategy.md`. |
| **ADR-004 (LOCKED) — Mini-CRM como entidad MASTER**. Tablas `customers`, `customer_external_links`, `customer_merge_log` en capa MASTER (no derivada). Cascada de matching de cliente (phone → email → document → phone fuzzy) reutiliza patrón de matching de producto + cola de validación humana. Vista "Clientes" muestra `% cobertura por canal`. Permisos siguen ADR-002. Implementación en F4. | Cliente solicitó explícitamente directorio + recurrencia + canales (Bloque E commentary). PRD original solo tenía `cliente_externo_id` en `sales` sin tabla maestra. Construirlo en F4 (cuando los marts ya existen) cuesta ~3 días; post-F5 requeriría re-aterrizar `sales.customer_id` con migración pesada. | 🔒 LOCKED — Accepted 2026-05-13, Decisor: cliente. Source: `docs/ADR-004-mini-crm.md`. |
| **Mart `dead_stock` sube de [v2] a MVP** (Fase 3, vista "Productos"). Cliente confirmó (Bloque K + J) que el problema #1 del negocio son 2000+ referencias sin movimiento desde hace 2 años. | El feature de mayor valor según el cliente; no tiene sentido posponerlo a v2 si es la razón principal por la que pidió el dashboard. | Pending validation in Phase 3. |
| Supabase as single SoT (DB + Auth + Storage + Realtime). | One vendor, one bill, RLS built-in, free-tier viable until ~5K tx/mo. | — Pending validation in Phase 1. |
| Railway as orchestrator runtime (Node.js + TS). | Cheapest reliable cron + workers platform that runs TS natively; matches stack. | — Pending validation in Phase 1. |
| Vercel free tier for Next.js 14 App Router dashboard. | $0 hosting; matches existing skills. | — Pending validation in Phase 1. |
| `LLMProvider` adapter pattern (mirror of `ChannelConnector`). | Avoid vendor lock-in; allow swap by env var across Kimi/Claude/GPT/Gemini without call-site changes. | — Pending validation in Phase 5. |
| Matching cascade: barcode → supplier code → normalized name → embeddings → image → LLM arbiter, with human validation queue below threshold. | Most-reliable-first cuts AI cost; human-in-the-loop refines rules over time. | — Pending validation in Phase 2 (cascade live) and Phase 1 (≥80% coverage target). |
| ~~WhatsApp as internal manual form for v1 (not WhatsApp Business API)~~. | ~~$0 cost, ships in days; v1 volume is small enough that manual entry is acceptable.~~ | **SUPERSEDED by ADR-003** — split form (F3) + WA Business Cloud API (F5.5). |
| Falabella deferred to optional Phase 6. | Non-priority channel; client not ready; avoid scope creep. | — Pending. |
| Channel API keys in Railway env vars only (never Supabase, never frontend, never repo). | Prevent dashboard token exfil and repo secret leaks. | — Pending validation in Phase 1. |
| `(canal, external_order_id)` as ingestion idempotency key. | Survives retries and dead-letter replays without duplicating facts. | — Pending validation in Phase 2. |

---
*Last updated: 2026-05-13 — ADR-002 (4-role matrix), ADR-003 (WhatsApp split), ADR-004 (Mini-CRM) locked after Phase 0 discovery findings (`docs/discovery-findings.md`).*
