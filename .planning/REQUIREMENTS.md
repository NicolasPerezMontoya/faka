# Requirements: faka — Dashboard Omnicanal de Ventas + Capa de IA

**Defined:** 2026-05-13
**Core Value:** One trusted, sub-15-minute view of "what is selling, where, right now" across every channel — built on a unified catalog that the AI helps create, not just analyze.

Provenance: synthesized from `docs/PRD.md` + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED). See `.planning/intel/SYNTHESIS.md` and `.planning/intel/requirements.md` for full source-traced entries. Requirements below are the v1 atomic, checkable units derived from those intel entries.

## v1 Requirements

Requirements for initial release. Each maps to exactly one roadmap phase. IDs use `[CATEGORY]-[NUMBER]`.

### Discovery & Catalog (DISC)

- [ ] **DISC-01**: Client completes structured discovery questionnaire (source inventory: per-channel product counts; common identifier presence: barcode, supplier code; access/credentials checklist for all 5 channels).
- [ ] **DISC-02**: At least one historical catalog CSV per current channel (WordPress, ML, Dropi, POS, WhatsApp) is exported and ingested via `CSVConnector` (LOCKED — ADR-001), producing the first stored `csv_mapping_profiles`.
- [ ] **DISC-03**: Manual + AI cross-match baseline report published: estimated % of automatic matches, estimated % requiring human review, and recommendation of starting LLM model (Kimi K2 vs. Claude Haiku 4.5).
- [ ] **DISC-04**: All 7 pre-Phase-1 open decisions from PRD §7 resolved and recorded: (1) product identifiers, (2) POS stack, (3) WordPress is WC vs custom, (4) ML credentials, (5) Dropi access, (6) AI feed format, (7) initial AI model.

### Foundation / Infrastructure (FND)

- [ ] **FND-01**: Repository initialized; Supabase project provisioned (Auth + Storage + Postgres + Realtime); Railway service skeleton deployed; Vercel project linked; secret management in Railway env vars only (CONSTR-secret-storage).
- [ ] **FND-02**: Supabase 5-layer schema deployed end-to-end (RAW + MASTER + FACTS + MARTS + INSIGHTS skeleton). RAW layer includes `raw_orders`, `raw_products`, `raw_events`, and the LOCKED tables `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles` per CONSTR-raw-csv-schema. MASTER includes `master_products`, `product_mappings`, `product_variants`. FACTS includes `sales`, `sale_items` (with nullable `master_sku`), `inventory_snapshots`. MARTS skeleton scaffolded. INSIGHTS includes `ai_insights`, `ai_conversations`.
- [ ] **FND-03**: Supabase Auth wired with 3 roles (owner, developer, staff); RLS policies enabled on every user-readable table (CONSTR-rls-required); login UI in dashboard.
- [ ] **FND-04**: `ChannelConnector` TS interface published (CONSTR-channel-connector-interface); skeletons compile for WordPress, ML, Dropi, POS, WhatsApp, Falabella connectors (Falabella disabled).
- [ ] **FND-05**: `CSVConnector` implemented (LOCKED — CONSTR-csv-connector) as the first concrete `ChannelConnector`, with `ingestUpload(uploadId)` emitting `NormalizedOrder` / `NormalizedProduct` from `raw_csv_uploads` + linked `csv_mapping_profile`.
- [ ] **FND-06**: CSV upload endpoint live; dashboard "Operación" view 3-step upload wizard functional (1: pick canal+tipo+profile, 2: preview + column auto-detect + adjust, 3: validate + dry-run + confirm). A test CSV uploads end-to-end and lands rows in `raw_csv_uploads` + `raw_csv_rows`, with original payload retained in Supabase Storage at `raw_csv_uploads.storage_path` (CONSTR-csv-ingest-pipeline, LOCKED).
- [ ] **FND-07**: Historical uploads table in Operación view (status, row count, raw link, reprocess action) supports re-running a versioned `csv_mapping_profile` against an existing upload without re-uploading (LOCKED).
- [ ] **FND-08**: Orchestrator patterns implemented: idempotency key `(canal, external_order_id)` (CONSTR-idempotency-key); 3× exponential backoff + dead-letter queue (CONSTR-retry-policy); `connector_runs` observability table (CONSTR-connector-observability); `audit_log` table (CONSTR-audit-log).

### WordPress Walking Skeleton (WP)

- [ ] **WP-01**: WordPress `ChannelConnector` live: REST API + WC/plugin webhooks; orders sync realtime via webhook + scheduled pull every 1h; products sync every 1h.
- [ ] **WP-02**: WordPress historical backfill performed via `CSVConnector` (LOCKED — ADR-001) before live sync activates; backfilled rows land in `raw_orders` + `sales` + `sale_items` via the normalization pipeline.
- [ ] **WP-03**: Matching cascade implemented end-to-end (CONSTR-matching-coverage applies): (1) EAN/barcode exact → score 1.0; (2) supplier code exact → score 1.0; (3) normalized name (lowercase, no accents, no special chars) → score 0.9; (4) text embeddings (name + description) → variable score with calibrated threshold; (5) LLM arbiter on remaining ambiguous candidates. Items below threshold land in human validation queue.
- [ ] **WP-04**: Match validation queue UI live in dashboard; human validations write back to `product_mappings.validado_humano=true` and feed rule refinement.
- [ ] **WP-05**: Dashboard "Hoy" view MVP slice live: today's consolidated sales total, per-channel breakdown bar chart, top 10 products sold today, last-hour realtime transaction feed (REQ-dashboard-view-hoy MVP items).
- [ ] **WP-06**: Day-sales latency ≤15 min from WordPress source transaction to dashboard reflection (CONSTR-mvp-latency).

### POS + WhatsApp (PWA)

- [ ] **PWA-01**: POS propio `ChannelConnector` live via webhooks from the POS to the orchestrator (realtime); idempotency + retry policy honored; polling-of-last-resort fallback alert if >2h without events (risk mitigation).
- [ ] **PWA-02**: WhatsApp internal mini-app form live in dashboard (no WhatsApp Business API): vendor pastes cliente + productos + total in ≤4 clicks; creates `sales` + `sale_items` rows; emits an `audit_log` entry per submission.
- [ ] **PWA-03**: At least 3 channels (WordPress + POS + WhatsApp) reporting sales into unified facts and visible on "Hoy" view.
- [ ] **PWA-04**: Dashboard "Productos" view MVP slice: master SKU list with filters by categoría / canal / estado; "hot by window" rankings — día, semana, mes — shown simultaneously (REQ-dashboard-view-productos MVP items).
- [ ] **PWA-05**: Dashboard "Operación" view health-check section live: per-connector last sync time, last error, recent `connector_runs` rows; pending matching queue counter (CONSTR-connector-observability; REQ-dashboard-view-operacion MVP items).
- [ ] **PWA-06**: ≥80% of products in `sale_items` have non-null `master_sku` across the 3 reporting channels (CONSTR-matching-coverage; PRD Fase 1 success metric carried into this phase).

### Mercado Libre + Dropi (MLD)

- [ ] **MLD-01**: Mercado Libre Colombia `ChannelConnector` live: OAuth flow + registered MLM developer app; orders sync every 15 min; products sync every 1h; exponential backoff for rate limits.
- [ ] **MLD-02**: Dropi `ChannelConnector` live: Playwright headless scraper of the proveedor panel every 30 min; on scraper failure or panel change, automatic fallback to `CSVConnector` ingestion path (LOCKED — ADR-001) with same downstream code path, no Dropi-specific CSV logic.
- [ ] **MLD-03**: 5 current channels (WordPress, ML, Dropi, POS, WhatsApp) all reporting sales into unified facts; visible in updated "Canales" view (per-channel comparison day/week/month, REQ-dashboard-view-canales MVP item).
- [ ] **MLD-04**: Advanced marts live: `mart_product_velocity` (units/day avg over 7/30/90 days), `mart_top_products_by_window`, `mart_channel_performance`, `mart_dead_stock`, days-of-inventory projection. Mart of cannibalization (same customer + same product across channels) live.
- [ ] **MLD-05**: Reactive email alerts wired: low stock (per-SKU threshold), low-confidence matches above queue volume, connector health failures. ≥3 actionable alerts delivered in first week of operation (PRD Fase 2 success metric).
- [ ] **MLD-06**: Falabella connector skeleton wired and gated by feature flag (disabled).

### AI Layer (AI)

- [ ] **AI-01**: `LLMProvider` adapter implemented (CONSTR-llm-provider-adapter) supporting Kimi K2, Claude Haiku 4.5, GPT-4o-mini, Gemini 2.5 Flash. Provider selectable via env var; no call-site changes required to swap.
- [ ] **AI-02**: Autonomous insight jobs scheduled at 8:00 AM and 6:00 PM Colombia time (REQ-ai-autonomous-mode). Inputs: mart snapshots (ventas del día, top productos, anomalías estadísticas, stock crítico, productos sin movimiento). Outputs: parsed structured rows in `ai_insights` (type, severity, suggested action). Dashboard "Hoy" surfaces "Novedades del día" (AM) and "Cierre del día" (PM) cards.
- [ ] **AI-03**: Dashboard "Inteligencia" view live: insight feed with reviewable cards capturing útil / no-útil feedback into `ai_insights.feedback` and `ai_insights.revisado_por_usuario`.
- [ ] **AI-04**: Conversational chat live (REQ-ai-conversational-mode): router decides which mart summaries to load; context assembled from pre-computed summaries (never raw DB rows); system prompt defines role; v1 surfaces suggested actions only, never auto-executes; conversations stored in `ai_conversations`.
- [ ] **AI-05**: Prompts versioned in source control with a testable structure (input fixtures + expected-output shape); swap-able alongside `LLMProvider`.
- [ ] **AI-06**: At ≥2 weeks of usage, ≥70% of generated `ai_insights` are flagged "útil" (CONSTR-ai-insight-usefulness, PRD Fase 3 success metric).

### Falabella + Prediction (FBP)

- [ ] **FBP-01**: Falabella Sellercenter `ChannelConnector` activated (was skeleton from MLD-06); orders every 30 min; products every 1h.
- [ ] **FBP-02**: Demand prediction model live (Prophet or equivalent): forecasts SKU demand 2 weeks forward with a recorded error metric per SKU; runs on a scheduled job; outputs stored for dashboard surface.
- [ ] **FBP-03**: Replenishment recommender live: combines velocity, days-of-inventory, and demand prediction into a recommended purchase quantity per SKU; surfaced in "Productos" or "Inteligencia" view with rationale.
- [ ] **FBP-04**: 6 channels reporting (Phase 4's 5 + Falabella); all marts and predictions account for the 6th channel.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Dashboard Enhancements (DASH-V2)

- **DASH-V2-01**: Daily ticket average + comparison ("Hoy" view).
- **DASH-V2-02**: Active alerts panel on "Hoy" view (low stock, anomalies).
- **DASH-V2-03**: Rotation velocity per SKU on "Productos" (7/30/90 day windows).
- **DASH-V2-04**: Accelerating vs. declining trend indicators ("Productos").
- **DASH-V2-05**: Per-SKU detail page with channel history, average price, margins.
- **DASH-V2-06**: Channel mix over time (stacked area on "Canales").
- **DASH-V2-07**: Per-channel performance breakdown (ingresos, # órdenes, ticket promedio, conversión).
- **DASH-V2-08**: Statistical anomaly detection feeding "Inteligencia".
- **DASH-V2-09**: 30/60/90-day rebuy cohorts on "Inteligencia".
- **DASH-V2-10**: Insight feedback log on "Operación".

### Future Operations (OPS-V2)

- **OPS-V2-01**: Per-POS scope for `staff` role (RLS-driven).
- **OPS-V2-02**: Per-channel AI diagnosis on "Canales" view.
- **OPS-V2-03**: AI-driven feed format expansion (email + WhatsApp summary in addition to dashboard cards), pending PRD §7 question 6.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| WhatsApp Business API integration (v1) | Internal manual form keeps cost at $0 and ships fast; v1 volume is small enough that manual entry is acceptable. |
| Auto-executing AI actions | v1 chat surfaces suggestions only; humans pull the trigger to avoid trust/safety failures early. |
| Mobile native app | Web-first dashboard sufficient for 3 internal users. |
| Cross-channel real-time inventory rebalancing | v1 captures snapshots, not active orchestration. |
| Multi-tenant SaaS | Single client; RLS is for role isolation, not tenant isolation. |
| Workloads beyond ~5,000 transactions/month | Schema and indexing tuned for current scale (CONSTR-data-volume). |
| Generative video / image content | AI is for matching, insights, and chat only. |
| Stripe / billing / customer-facing checkout | This is an internal operations tool, not a storefront. |
| OAuth login via Google/social providers (v1) | Supabase Auth email + password (and optional magic link) sufficient for 3 internal users. |
| Real-time WebSocket chat between users | Out of product scope; team is 3 people. |
| Image-match step (CLIP) in matching cascade for v1 | Mentioned in PRD §3.6 as part of the cascade but deferred until channel images are reliably available; the v1 cascade in WP-03 stops at LLM arbiter. Revisit in v2 once image availability is confirmed across ML + Dropi + WP. |

## Traceability

Every v1 requirement maps to exactly one phase. Coverage validated below.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DISC-01 | Phase 0 | Pending |
| DISC-02 | Phase 0 | Pending |
| DISC-03 | Phase 0 | Pending |
| DISC-04 | Phase 0 | Pending |
| FND-01 | Phase 1 | Pending |
| FND-02 | Phase 1 | Pending |
| FND-03 | Phase 1 | Pending |
| FND-04 | Phase 1 | Pending |
| FND-05 | Phase 1 | Pending |
| FND-06 | Phase 1 | Pending |
| FND-07 | Phase 1 | Pending |
| FND-08 | Phase 1 | Pending |
| WP-01 | Phase 2 | Pending |
| WP-02 | Phase 2 | Pending |
| WP-03 | Phase 2 | Pending |
| WP-04 | Phase 2 | Pending |
| WP-05 | Phase 2 | Pending |
| WP-06 | Phase 2 | Pending |
| PWA-01 | Phase 3 | Pending |
| PWA-02 | Phase 3 | Pending |
| PWA-03 | Phase 3 | Pending |
| PWA-04 | Phase 3 | Pending |
| PWA-05 | Phase 3 | Pending |
| PWA-06 | Phase 3 | Pending |
| MLD-01 | Phase 4 | Pending |
| MLD-02 | Phase 4 | Pending |
| MLD-03 | Phase 4 | Pending |
| MLD-04 | Phase 4 | Pending |
| MLD-05 | Phase 4 | Pending |
| MLD-06 | Phase 4 | Pending |
| AI-01 | Phase 5 | Pending |
| AI-02 | Phase 5 | Pending |
| AI-03 | Phase 5 | Pending |
| AI-04 | Phase 5 | Pending |
| AI-05 | Phase 5 | Pending |
| AI-06 | Phase 5 | Pending |
| FBP-01 | Phase 6 | Pending |
| FBP-02 | Phase 6 | Pending |
| FBP-03 | Phase 6 | Pending |
| FBP-04 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-13*
*Last updated: 2026-05-13 after initial roadmap creation from synthesized intel (PRD + ADR-001 LOCKED).*
