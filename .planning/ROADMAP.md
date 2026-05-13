# Roadmap: faka — Dashboard Omnicanal de Ventas + Capa de IA

## Overview

Seven phases moving from catalog discovery → infrastructure foundation → a single-channel walking skeleton → multi-channel coverage → AI layer → optional prediction. The roadmap deliberately front-loads catalog normalization (Phase 0) before any UI, because un-normalized SKUs across 5 channels is the project's hardest problem and the precondition for everything downstream. ADR-001 (LOCKED) makes CSV upload a first-class, channel-agnostic ingestion path from Phase 0 onward — the same `CSVConnector` is used for catalog discovery, WordPress historical backfill, and Dropi scraper fallback. The MVP usable milestone lands at the end of Phase 3 (~5 weeks): 3 channels live (WordPress + POS + WhatsApp), consolidated "Hoy" + "Productos" views, ≥80% master_sku coverage, and ≤15min day-sales latency. Phases 4–5 broaden to 5 channels with advanced analytics and add the AI insight + chat layer. Phase 6 (optional) adds Falabella and Prophet-driven demand prediction.

## Phases

**Phase Numbering:**

- Integer phases (0, 1, 2, 3, 4, 5, 6): Planned milestone work
- Decimal phases (e.g., 2.1): Urgent insertions if needed later (marked INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 0: Discovery & catalog normalization** - Understand the real catalog before building; produce baseline of automatic-vs-manual matching using CSV ingestion from day one.
- [ ] **Phase 1: Foundation** - Repo, Supabase 5-layer schema (incl. LOCKED CSV tables), auth+RLS, Railway orchestrator skeleton, end-to-end CSV upload endpoint + Operación wizard.
- [ ] **Phase 2: Walking skeleton (WordPress)** - First real connector end-to-end + matching cascade + human validation queue + "Hoy" view.
- [ ] **Phase 3: POS + WhatsApp (form) + Dead Stock** - POS webhook + internal WhatsApp form + "Productos" view + `mart_dead_stock` promoted to MVP + "Operación" health checks. **MVP usable milestone**.
- [ ] **Phase 4: Mercado Libre + Dropi + Mini-CRM** - ML OAuth + Dropi CSV-primary + advanced marts + email alerts + **Mini-CRM (ADR-004)** with customer matching cascade and "Clientes" view.
- [ ] **Phase 5: AI layer** - LLMProvider adapter + AM/PM insight jobs + feedback feed + conversational RAG chat + versioned prompts.
- [ ] **Phase 5.5: WhatsApp Business Cloud API** - Webhook receiver + inbound parser + outbound sender for IA insights to owner + MessagingProvider adapter (per ADR-003). Internal form from F3 stays as fallback.
- [ ] **Phase 6: Falabella + prediction (optional)** - Falabella Sellercenter connector + Prophet demand prediction + replenishment recommender.

## Phase Details

### Phase 0: Discovery & catalog normalization

**Goal**: Understand the real catalog before construction; produce a CSV-driven baseline of automatic vs. manual matching and resolve all pre-Phase-1 gating decisions. ADR-001 (LOCKED) applies: catalog exports ingest via the same `CSVConnector` mechanism that will be used everywhere — Phase 0 produces the first stored mapping profiles.
**Depends on**: Nothing (first phase)
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04
**Success Criteria** (what must be TRUE):

1. Client has completed the structured discovery questionnaire and the developer has a documented source inventory: per-channel product counts, presence/absence of common identifiers (barcode, supplier code), and credential/access status for every channel.
2. At least one historical catalog CSV per current channel has been ingested via the `CSVConnector` path defined in ADR-001, with `csv_mapping_profiles` rows persisted and raw payloads retained in Supabase Storage.
3. A baseline report is published estimating the % of catalog rows that will match automatically (barcode/code/normalized name) vs. the % needing human/LLM review, along with a recommended starting LLM model (Kimi K2 or Claude Haiku 4.5) for the matching cascade.
4. All 7 pre-Phase-1 open decisions from PRD §7 are resolved and recorded in PROJECT.md Key Decisions (identifiers, POS stack, WP variant, ML credentials, Dropi access, AI feed format, initial AI model).
   **Plans**: TBD

### Phase 1: Foundation

**Goal**: Stand up the full technical foundation — repo, Supabase 5-layer schema (including the LOCKED CSV tables from ADR-001), auth + RLS, Railway orchestrator skeleton with connector interface + skeletons, and a working end-to-end CSV upload path through the Operación-view wizard. Nothing channel-specific yet — but every channel-specific piece in later phases must plug in cleanly.
**Depends on**: Phase 0
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08
**Success Criteria** (what must be TRUE):

1. Supabase staging environment has the full 5-layer schema deployed (RAW + MASTER + FACTS + MARTS skeleton + INSIGHTS), including the LOCKED tables `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles`; a developer can run a schema diff and see zero pending migrations.
2. A test CSV uploaded through the dashboard "Operación" 3-step wizard lands rows in `raw_csv_uploads` + `raw_csv_rows`, with the original payload retained in Supabase Storage at the path referenced by `raw_csv_uploads.storage_path`; the historical uploads table shows the upload with status, row count, and a working "reprocess with versioned mapping profile" action.
3. Three roles (owner, developer, staff) can log in via Supabase Auth; RLS policies enforce role boundaries on every user-readable table; channel API keys are stored only in Railway env vars (zero secrets in Supabase tables, frontend bundles, or the repo).
4. Connector skeletons for WordPress, ML, Dropi, POS, WhatsApp, and Falabella compile against the published `ChannelConnector` interface; `CSVConnector` is the first concrete implementation and is wired into the upload endpoint.
5. Orchestrator implements the cross-cutting protocols: `(canal, external_order_id)` idempotency, 3× exponential backoff + dead-letter queue, `connector_runs` writes per execution, `audit_log` writes on user mutations.
   **Plans**: TBD

### Phase 2: Walking skeleton (WordPress)

**Goal**: Prove the full pipeline with one real channel end-to-end — WordPress sync (live + CSV historical backfill via ADR-001 path), matching cascade with human validation queue, and a "Hoy" view that reflects today's sales within 15 minutes. This phase is where the architecture meets reality.
**Depends on**: Phase 1
**Requirements**: WP-01, WP-02, WP-03, WP-04, WP-05, WP-06
**Success Criteria** (what must be TRUE):

1. WordPress orders flow into `sales` + `sale_items` with ≤15 min latency from the source transaction, via REST + WC webhooks + 1h scheduled pull.
2. Historical WordPress data has been backfilled via the `CSVConnector` path (LOCKED — ADR-001) and is visible alongside live data in `sales` + `sale_items`.
3. The matching cascade produces scores for every ingested item: barcode → supplier code → normalized name → embeddings → LLM arbiter. Items below the high-confidence threshold appear in a human validation queue and a human can validate/reject from the dashboard, which flips `product_mappings.validado_humano=true`.
4. The dashboard "Hoy" view displays for the day: total consolidated sales, per-channel breakdown bar chart, top 10 products, last-hour realtime transaction feed — refreshed within the 15-min latency budget.
   **Plans**: TBD
   **UI hint**: yes

### Phase 3: POS + WhatsApp (form) + Dead Stock

**Goal**: Bring the second and third channels online — POS via webhooks emitted by the client's POS, and WhatsApp via an **internal mini-app form** (the WhatsApp Business Cloud API integration is split into Phase 5.5 per ADR-003; the form here remains permanent as fallback/correction UI). Add the "Productos" view with hot-by-window rankings, the **`mart_dead_stock` view** promoted to MVP per cliente feedback (Bloque K — 2000+ referencias sin movimiento es el caso de uso #1), and a real "Operación" health-check panel surfacing connector runs. This is the **MVP usable milestone** (~5 weeks in): 3 channels reporting, ≥80% master_sku coverage, stock-muerto visible.
**Depends on**: Phase 2
**Requirements**: PWA-01, PWA-02, PWA-03, PWA-04, PWA-05, PWA-06
**Success Criteria** (what must be TRUE):

1. The POS propio is emitting webhooks that the orchestrator processes in realtime; a polling-of-last-resort fallback fires an alert if no POS events arrive for >2 hours.
2. The dashboard WhatsApp mini-app form lets a vendor record a sale (cliente + productos + total) in ≤4 clicks, creating `sales` + `sale_items` rows and an `audit_log` entry.
3. Three channels — WordPress + POS + WhatsApp — are simultaneously reflected on the "Hoy" view; the "Productos" view shows the master SKU list with category/canal/estado filters and three simultaneous rankings (día, semana, mes).
4. The "Operación" view surfaces per-connector health: last sync time, last error, recent `connector_runs`, and a counter for the pending matching queue.
5. Across the 3 reporting channels, ≥80% of rows in `sale_items` have a non-null `master_sku` (matching coverage NFR met).
   **Plans**: TBD
   **UI hint**: yes

### Phase 4: Mercado Libre + Dropi + Mini-CRM

**Goal**: Expand to all 5 current channels by adding Mercado Libre (OAuth-based official API; cliente debe crear developer app antes de empezar) and Dropi (CSV-primary per cliente feedback — Playwright scraper queda como opcional posterior). Stand up the advanced marts (velocity, cannibalization, days-of-inventory) and the reactive email alerting layer. **Construir el Mini-CRM (ADR-004 LOCKED)**: tablas `customers`/`customer_external_links`/`customer_merge_log` + cascada de matching de clientes + vista "Clientes" con `% cobertura por canal`. Wire a disabled Falabella connector skeleton ready for Phase 6.
**Depends on**: Phase 3
**Requirements**: MLD-01, MLD-02, MLD-03, MLD-04, MLD-05, MLD-06
**Success Criteria** (what must be TRUE):

1. Mercado Libre Colombia orders sync every 15 minutes and products every 1 hour via the official API with OAuth; rate-limit errors trigger exponential backoff rather than data loss.
2. Dropi scrapes the proveedor panel every 30 minutes via Playwright; when the scraper fails or the panel changes shape, the system falls back automatically to the `CSVConnector` ingestion path (LOCKED — ADR-001) with zero Dropi-specific CSV logic on top.
3. All 5 current channels (WordPress + POS + WhatsApp + ML + Dropi) report into the unified facts and appear on a "Canales" view with day/week/month comparisons.
4. Advanced marts are populated and queryable: product velocity (7/30/90-day windows), top-by-window rankings, channel performance, dead stock, days-of-inventory projection, and a cannibalization mart (same customer + same product across channels).
5. Email alerts have fired at least 3 actionable notifications in the first week of operation (low stock, low-confidence-match queue overflow, or connector health failure).
   **Plans**: TBD
   **UI hint**: yes

### Phase 5: AI layer

**Goal**: Ship the AI capability that the project name promises: pluggable `LLMProvider` adapter, twice-daily autonomous insight jobs, a reviewable insight feed with user feedback capture, and a conversational chat with data (RAG over pre-computed mart summaries — never raw rows). Prompts are versioned and testable so we can iterate without breaking production.
**Depends on**: Phase 4
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05, AI-06
**Success Criteria** (what must be TRUE):

1. The `LLMProvider` adapter is implemented; swapping providers (Kimi K2 ↔ Claude Haiku 4.5 ↔ GPT-4o-mini ↔ Gemini 2.5 Flash) requires only an environment variable change, with no call-site modifications.
2. Autonomous insight jobs run at 8:00 AM and 6:00 PM Colombia time, each producing ≥3 structured rows in `ai_insights` per job (with type, severity, and suggested action), and the dashboard "Hoy" view surfaces "Novedades del día" + "Cierre del día" cards.
3. The "Inteligencia" view shows the insight feed with per-card "útil / no-útil" feedback buttons; clicks write back into `ai_insights.feedback` + `ai_insights.revisado_por_usuario`.
4. The conversational chat answers business questions (e.g., "¿Qué producto vendió más esta semana en ML vs WP?") using a router that loads mart summaries on demand, persists conversations in `ai_conversations`, and surfaces optional suggested actions (v1 surface only — never auto-execute).
5. After 2 weeks of real usage, ≥70% of generated insights are flagged "útil" in the feedback log.
   **Plans**: TBD
   **UI hint**: yes

### Phase 5.5: WhatsApp Business Cloud API integration (INSERTED 2026-05-13)

**Goal**: Implement the WhatsApp Business Cloud API integration per ADR-003 (LOCKED). Inbound: webhook receiver verifies Meta signature, parses incoming sales messages, resolves products via the matching cascade, creates `sales` rows with `canal=whatsapp_bot`. Outbound: `MessagingProvider` adapter (mirrors `LLMProvider` pattern) sends AM/PM IA insights to the owner's WhatsApp + ad-hoc alerts (stock crítico, anomalías). Internal form from Phase 3 stays as fallback.
**Depends on**: Phase 5 (AI insights existen para enviar) + Phase 4 (Mini-CRM existe para enriquecer customers desde WA bot)
**Requirements**: WA-01 webhook receiver, WA-02 inbound parser + matching loop, WA-03 outbound sender with approved templates, WA-04 MessagingProvider adapter, WA-05 Meta Business Manager setup (paralelo durante F4)
**Success Criteria** (what must be TRUE):

1. Meta Business Manager verified; phone number approved; AM/PM message templates approved by Meta.
2. A test inbound message "pedido: 2 planchas rojas, total 180k, cliente +57300..." creates a `sales` row with the right items, customer (or new customer row), total, channel = `whatsapp_bot`, with the original payload preserved.
3. AM (8:00) and PM (5:30 Colombia) insights are delivered to the owner's WhatsApp; opening rate ≥ 80% in first 2 weeks (Meta reports this).
4. `MessagingProvider` adapter compiles with both Meta Cloud API + Twilio implementations; switching is env var only.
5. Costos de mensajería en USD reportados en `connector_runs` no excede USD 10/mes en operación normal.
   **Plans**: TBD
   **UI hint**: yes (mensaje de configuración + tabla de mensajes en "Operación")

### Phase 6: Falabella + prediction (optional)

**Goal**: Activate the deferred Falabella connector (skeleton from Phase 4) and add the predictive layer — Prophet or equivalent forecasting demand 2 weeks forward per SKU, plus a replenishment recommender that combines velocity + days-of-inventory + prediction to suggest purchase quantities. Optional — runs only when the client signals readiness.
**Depends on**: Phase 5.5
**Requirements**: FBP-01, FBP-02, FBP-03, FBP-04
**Success Criteria** (what must be TRUE):

1. Falabella Sellercenter is live — orders syncing every 30 minutes, products every 1 hour — bringing the channel count to 6.
2. A demand prediction model (Prophet or equivalent) runs on a schedule, forecasts 2 weeks forward per SKU, records its error metric per SKU, and stores outputs queryable for dashboard surface.
3. A replenishment recommender produces, per SKU, a suggested purchase quantity backed by velocity + days-of-inventory + predicted demand, with the rationale shown alongside the number on either "Productos" or "Inteligencia".
4. All marts, alerts, AI insights, and chat responses correctly account for the 6th channel without channel-specific code branches in the analytics path.
   **Plans**: TBD
   **UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3 → 4 → 5 → 5.5 → 6

| Phase                                 | Plans Complete | Status                                              | Completed |
| ------------------------------------- | -------------- | --------------------------------------------------- | --------- |
| 0. Discovery & catalog normalization  | 0/1            | In progress (Claude-side done; client-side blocked) | -         |
| 1. Foundation                         | 0/TBD          | Not started                                         | -         |
| 2. Walking skeleton (WordPress)       | 0/TBD          | Not started                                         | -         |
| 3. POS + WhatsApp (form) + Dead Stock | 0/TBD          | Not started                                         | -         |
| 4. Mercado Libre + Dropi + Mini-CRM   | 0/TBD          | Not started                                         | -         |
| 5. AI layer                           | 0/TBD          | Not started                                         | -         |
| 5.5. WhatsApp Business Cloud API      | 0/TBD          | Not started (inserted 2026-05-13 per ADR-003)       | -         |
| 6. Falabella + prediction (optional)  | 0/TBD          | Not started                                         | -         |
