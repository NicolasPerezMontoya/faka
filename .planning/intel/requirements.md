# Requirements

Per-requirement extraction from PRDs. Each entry traces back to source. Where an ADR overrides a PRD requirement, the requirement is restated with the ADR applied and marked accordingly.

---

## REQ-context-and-assumptions

- **Source:** `docs/PRD.md` §1
- **Scope:** project context
- **Description:** Build an omnichannel sales dashboard + AI layer for a Colombian televentas client.
- **Acceptance criteria:**
  - Channels in scope at v1: WordPress, Mercado Libre Colombia, Dropi (proveedor), 2 POS físicos propios, WhatsApp Business.
  - Channel deferred (Phase 3/4): Falabella Marketplace Colombia (non-priority).
  - Volume sized for ~5,000 transactions/month consolidated.
  - 3 users at launch (developer, client, client's spouse).
  - Infrastructure budget cap: $150 USD/month.
  - Catalog: thousands of SKUs with variants, no cross-channel normalization, no confirmed common identifiers at start.
  - AI candidate: Kimi K2, open to alternatives; modes = autonomous (AM/PM) + on-demand chat.

---

## REQ-data-quality-as-primary-challenge

- **Source:** `docs/PRD.md` §2
- **Scope:** product strategy
- **Description:** Treat data-quality / catalog normalization as the largest project challenge; AI's primary day-one value is matching, not analytics.
- **Acceptance criteria:**
  - Roadmap reserves a dedicated Phase 0 for normalization before building analytics.
  - AI matching capability is available from Phase 0/1, not deferred to Phase 3.

---

## REQ-architecture-high-level

- **Source:** `docs/PRD.md` §3.1
- **Scope:** system architecture
- **Description:** Five components — sources/connectors, ingestion orchestrator, Supabase Postgres (5-layer schema), Next.js dashboard, AI layer.
- **Acceptance criteria:**
  - Channel connectors are modular and pluggable.
  - Orchestrator includes scheduler, modular connectors, normalizer, event queue.
  - Supabase Postgres holds raw, master, facts, marts, insights layers.
  - Dashboard reads from Postgres with RLS-enforced role-based access.
  - AI layer runs scheduled jobs + chat RAG + matching.

---

## REQ-stack-and-budget

- **Source:** `docs/PRD.md` §3.2
- **Scope:** infra and costs
- **Description:** Pin recommended stack with monthly cost envelope.
- **Acceptance criteria:**
  - DB/Auth/Storage/Realtime: Supabase ($0 free → $25 Pro).
  - Orchestrator: Node.js + TypeScript on Railway ($5–10).
  - Dashboard: Next.js 14 App Router on Vercel ($0).
  - AI: Kimi K2 via API with adapter, alternatives Claude Haiku, GPT-4o-mini, Gemini Flash ($20–50).
  - Monitoring: Better Stack or Axiom (free tier).
  - Total estimated: $50–85/month, leaving ~$65 headroom under the $150 cap.

---

## REQ-schema-raw-layer

- **Source:** `docs/PRD.md` §3.3 + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED)
- **Scope:** Supabase Postgres — RAW layer
- **Description:** Untransformed payloads per channel, plus immutable CSV upload history.
- **Acceptance criteria:**
  - Tables (from PRD): `raw_orders(canal, payload_json, fetched_at)`, `raw_products(canal, payload_json, fetched_at)`, `raw_events(canal, tipo_evento, payload_json, ocurrido_at)`.
  - **Tables added by ADR-001 (LOCKED):** `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles` with fields per AMENDMENT.
  - Original CSV payloads retained in Supabase Storage; `raw_csv_uploads.storage_path` references them.
  - Reprocessing supported via `csv_mapping_profiles.version` without losing original rows.

---

## REQ-schema-master-layer

- **Source:** `docs/PRD.md` §3.3
- **Scope:** Supabase Postgres — MASTER layer
- **Description:** Unified clean catalog.
- **Acceptance criteria:**
  - `master_products` (master_sku PK, nombre_canonico, categoria, marca, imagen_principal, costo_promedio, precio_sugerido, estado, confidence_score).
  - `product_mappings` (master_sku FK, canal, external_id, external_name, match_method, validado_humano).
  - `product_variants` (master_variant_sku, master_sku FK, atributos_json).
  - `product_mappings.canal` enum includes wordpress, mercadolibre, dropi, pos, whatsapp, falabella (and implicitly accepts CSV-uploaded sources via the channel they declare per ADR-001).

---

## REQ-schema-facts-layer

- **Source:** `docs/PRD.md` §3.3
- **Scope:** Supabase Postgres — FACTS layer
- **Description:** Normalized sales facts.
- **Acceptance criteria:**
  - `sales(sale_id, canal, external_order_id, fecha, hora, cliente_externo_id, subtotal, descuento, total, costo_envio, moneda, estado, punto_venta_id)`.
  - `sale_items(sale_id FK, master_sku FK nullable, external_sku, cantidad, precio_unitario, descuento, costo_unitario_estimado)`.
  - `inventory_snapshots(master_sku, canal, cantidad, capturado_at)`.
  - `master_sku` is nullable in `sale_items` until matching resolves.

---

## REQ-schema-marts-layer

- **Source:** `docs/PRD.md` §3.3
- **Scope:** Supabase Postgres — MARTS layer
- **Description:** Materialized views for the dashboard.
- **Acceptance criteria:**
  - `mart_daily_sales`, `mart_product_velocity`, `mart_top_products_by_window`, `mart_channel_performance`, `mart_dead_stock`, `mart_promotion_candidates`.

---

## REQ-schema-insights-layer

- **Source:** `docs/PRD.md` §3.3
- **Scope:** Supabase Postgres — INSIGHTS layer
- **Description:** AI-generated content store.
- **Acceptance criteria:**
  - `ai_insights(id, generado_at, tipo, severidad, titulo, cuerpo_markdown, master_skus_afectados, canal_afectado, accion_sugerida, revisado_por_usuario, feedback)`.
  - `ai_conversations(id, user_id, mensajes_json, contexto_datos_json, created_at)`.

---

## REQ-channel-connector-interface

- **Source:** `docs/PRD.md` §3.4 + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED)
- **Scope:** orchestrator / connectors
- **Description:** Common `ChannelConnector` interface; CSV is a first-class implementation.
- **Acceptance criteria:**
  - Interface: `name`, `type ('pull'|'push'|'manual')`, `capabilities: Set<'orders'|'products'|'inventory'|'customers'>`, `fetchOrders(since)`, `fetchProducts(since)`, optional `fetchInventory()`, `normalizeOrder`, `normalizeProduct`, `healthCheck`.
  - **(LOCKED, ADR-001):** `CSVConnector` implements `ChannelConnector` with `name='csv-upload'`, `type='manual'`, and an `ingestUpload(uploadId)` method that emits `NormalizedOrder`/`NormalizedProduct` from a stored upload + mapping profile.

---

## REQ-channel-strategies

- **Source:** `docs/PRD.md` §3.4 (table) + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED)
- **Scope:** per-channel ingestion strategies
- **Description:** Strategy + cadence + notes per channel.
- **Acceptance criteria:**
  - **WordPress:** REST API + WooCommerce/plugin webhooks; realtime + 1h sync; confirm WC vs. custom.
  - **Mercado Libre CO:** Official MLM API with OAuth; orders 15 min, products 1h; requires developer app.
  - **Dropi:** Headless Playwright scraper of the proveedor panel; 30 min cadence; **fallback uses `CSVConnector` per ADR-001 (LOCKED) — same code path, no Dropi-specific CSV logic.**
  - **POS propio:** Webhooks → orchestrator; realtime; co-designed with POS programmer.
  - **WhatsApp:** Internal dashboard form (manual entry); no WhatsApp Business API for v1.
  - **Falabella:** Sellercenter API in Phase 3/4; skeleton in Phase 1.
  - **CSV upload (LOCKED, ADR-001):** First-class, channel-agnostic; any channel can contribute CSVs; declared via `raw_csv_uploads.canal_declarado`.

---

## REQ-orchestrator-patterns

- **Source:** `docs/PRD.md` §3.4
- **Scope:** orchestrator behavior
- **Description:** Patterns every connector must respect.
- **Acceptance criteria:**
  - **Idempotency:** `(canal, external_order_id)` is the unique ingestion key.
  - **Retries with backoff:** failed fetches retry 3× with exponential backoff.
  - **Dead-letter queue:** events failing all retries stored for review.
  - **Observability:** `connector_runs` table (timestamp, duración, registros procesados, errores) per run.
  - **Backfill:** manual command to repopulate history when a new channel comes online (and per ADR-001, CSV upload is the primary backfill mechanism).

---

## REQ-ai-autonomous-mode

- **Source:** `docs/PRD.md` §3.5
- **Scope:** AI layer — scheduled insights
- **Description:** Twice-daily autonomous insight generation.
- **Acceptance criteria:**
  - Jobs run at 8:00 AM and 6:00 PM Colombia time.
  - Inputs: mart snapshots (ventas del día, top productos, anomalías estadísticas, stock crítico, productos sin movimiento).
  - Builds structured prompt; calls LLM via `LLMProvider` adapter.
  - Parses response into `ai_insights` rows with type, severity, suggested action.
  - Dashboard surfaces feed as "Novedades del día" (AM) and "Cierre del día" (PM).

---

## REQ-ai-conversational-mode

- **Source:** `docs/PRD.md` §3.5
- **Scope:** AI layer — chat with data
- **Description:** Natural language Q&A over consolidated data.
- **Acceptance criteria:**
  - Router step decides which data to load.
  - Context assembled from pre-computed summaries, not raw DB.
  - LLM called with role-defining system prompt.
  - Optional suggested action (v1: suggestion only, never auto-executed).

---

## REQ-llm-provider-adapter

- **Source:** `docs/PRD.md` §3.5
- **Scope:** AI integration
- **Description:** Pluggable `LLMProvider` interface (mirrors the connector pattern).
- **Acceptance criteria:**
  - Supports Kimi K2, Claude Haiku 4.5, GPT-4o-mini, Gemini 2.5 Flash.
  - Provider selectable via environment variable.
  - No call site changes required to swap providers.

---

## REQ-product-matching-cascade

- **Source:** `docs/PRD.md` §3.6
- **Scope:** product matching pipeline
- **Description:** Cascade from most-reliable to least-reliable matching method.
- **Acceptance criteria:**
  1. EAN/barcode exact match → score 1.0.
  2. Internal supplier code exact match → score 1.0.
  3. Normalized name match (lowercase, no accents, no special chars) → score 0.9.
  4. Text embeddings match (name + description) → variable score with calibrated threshold.
  5. Image match (CLIP or similar) → variable score (when channel images available).
  6. LLM arbitration on remaining candidates.
  - Items not crossing high-confidence threshold land in a human validation queue.
  - Human validations feed back into rules.

---

## REQ-security-and-permissions

- **Source:** `docs/PRD.md` §3.7
- **Scope:** auth, RLS, audit
- **Description:** Supabase Auth + RLS + audit log.
- **Acceptance criteria:**
  - Auth via Supabase Auth (email + password; magic link optional).
  - Roles: `owner` (cliente + esposa, full read), `developer` (full + tech logs), `staff` (future per-POS scope).
  - Row-Level Security policies enforce role boundaries in Postgres.
  - Channel API keys stored in Railway env vars only — never in Supabase or frontend.
  - `audit_log` records who-did-what-when.

---

## REQ-dashboard-view-hoy

- **Source:** `docs/PRD.md` §4 ("Hoy")
- **Scope:** dashboard — Hoy
- **Acceptance criteria:**
  - [MVP] Daily consolidated sales + progress bar vs. last-30-days same-weekday avg.
  - [MVP] Per-channel breakdown (bar chart).
  - [MVP] Top 10 products sold today.
  - [MVP] Last-hour realtime transaction feed.
  - [v2] Daily ticket average + comparison.
  - [IA] Morning/evening AI insights card.
  - [v2] Active alerts (low stock, anomalies).

---

## REQ-dashboard-view-productos

- **Source:** `docs/PRD.md` §4 ("Productos")
- **Scope:** dashboard — Productos
- **Acceptance criteria:**
  - [MVP] Master SKU list with filters by categoría, canal, estado.
  - [MVP] Hot by window (día/semana/mes) — three simultaneous rankings.
  - [v2] Rotation velocity (units/day avg over 7/30/90 days).
  - [v2] Accelerating vs. declining trend.
  - [v2] Days-of-inventory remaining projection.
  - [IA] Promotion candidates with rationale.
  - [IA] Hidden-star products (good rotation in one channel, absent elsewhere).
  - [v2] Per-SKU detail with channel history, avg price, margins.

---

## REQ-dashboard-view-canales

- **Source:** `docs/PRD.md` §4 ("Canales")
- **Scope:** dashboard — Canales
- **Acceptance criteria:**
  - [MVP] Per-channel comparison (day/week/month).
  - [v2] Channel mix over time (stacked area).
  - [v2] Per-channel performance: ingresos, # órdenes, ticket promedio, conversión.
  - [v2] Cannibalization detection (same customer + same product across channels).
  - [IA] Per-channel AI diagnosis.

---

## REQ-dashboard-view-inteligencia

- **Source:** `docs/PRD.md` §4 ("Inteligencia")
- **Scope:** dashboard — Inteligencia
- **Acceptance criteria:**
  - [IA] Insight feed (reviewable cards with útil/no-útil feedback).
  - [IA] Chat with data.
  - [v2] Statistical anomaly detection.
  - [v2] 30/60/90-day rebuy cohorts.
  - [v3] Demand prediction (Prophet or similar — non-generative).

---

## REQ-dashboard-view-operacion

- **Source:** `docs/PRD.md` §4 ("Operación") + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED)
- **Scope:** dashboard — Operación
- **Acceptance criteria:**
  - [MVP] Connector health check (last sync, errors).
  - [MVP] Pending matching queue (products without master_sku).
  - [v2] Insight feedback log.
  - **(LOCKED, ADR-001) [MVP/F1]** "Subir CSV" button → 3-step wizard:
    1. Pick canal + tipo + (optional) existing mapping profile.
    2. Preview with column auto-detection; user confirms/adjusts.
    3. Validation + dry-run + confirmation.
  - **(LOCKED, ADR-001) [MVP/F1]** Historical uploads table with status, row count, raw link, reprocess action.

---

## REQ-phase-0-discovery

- **Source:** `docs/PRD.md` §5 (Fase 0) + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED)
- **Scope:** Phase 0 — Discovery & normalization
- **Duration:** 1–2 weeks
- **Acceptance criteria:**
  - Source inventory with real per-channel product counts.
  - Confirmation of common identifiers (barcode, supplier code).
  - Structured catalog export per channel.
  - First manual + AI cross-match to estimate easy-vs-hard match ratio.
  - **(LOCKED, ADR-001):** Catalog exports ingest via `CSVConnector` from day one; Phase 0 produces the **first mapping profiles** stored in `csv_mapping_profiles`.

---

## REQ-phase-1-foundation-mvp

- **Source:** `docs/PRD.md` §5 (Fase 1) + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED)
- **Scope:** Phase 1 — Foundation / MVP
- **Duration:** 3–4 weeks
- **Acceptance criteria:**
  - Supabase schema deployed (raw + master + facts + marts + insights skeleton).
  - Orchestrator on Railway with connectors: **WordPress, POS propio, WhatsApp (manual form)**.
  - Matching pipeline: barcode → exact name → embeddings → LLM arbiter.
  - Match validation queue.
  - Dashboard with Hoy, Productos (basic), Operación views.
  - Auth + roles + RLS.
  - **(LOCKED, ADR-001) Phase 1 deliverables include:**
    - `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles` tables.
    - `CSVConnector` implementation.
    - Upload endpoint + Operación-view wizard.
  - **Success metric:** day-sales reflected with <15 min latency; ≥80% of products have a master_sku.

---

## REQ-phase-2-channels-and-analytics

- **Source:** `docs/PRD.md` §5 (Fase 2) + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED)
- **Scope:** Phase 2 — Remaining channels & advanced analytics
- **Duration:** 2–3 weeks
- **Acceptance criteria:**
  - Connectors: **Mercado Libre Colombia, Dropi**.
  - Additional marts: velocity, trends, days of inventory, cannibalization.
  - Full "Canales" view.
  - Reactive email alerts (low stock, anomalies).
  - Falabella connector skeleton (disabled).
  - **(LOCKED, ADR-001):** WordPress historical backfill performed via `CSVConnector` before live sync activates.
  - **Success metric:** 5 current channels reporting; ≥3 actionable alerts in week 1.

---

## REQ-phase-3-ai-layer

- **Source:** `docs/PRD.md` §5 (Fase 3)
- **Scope:** Phase 3 — AI layer
- **Duration:** 2–3 weeks
- **Acceptance criteria:**
  - `LLMProvider` adapter with Kimi K2, Claude, GPT support.
  - Morning + evening insight jobs.
  - Insights feed in dashboard with feedback capture.
  - Conversational chat (RAG over marts).
  - Versioned, testable prompts.
  - **Success metric:** 70% of insights marked "útil" after 2 weeks of use.

---

## REQ-phase-4-prediction-and-falabella

- **Source:** `docs/PRD.md` §5 (Fase 4) + `docs/AMENDMENT-csv-source.md` (ADR-001, LOCKED)
- **Scope:** Phase 4 — Prediction + Falabella
- **Duration:** 2 weeks (optional)
- **Acceptance criteria:**
  - Activate Falabella connector when client is ready.
  - Demand prediction model (Prophet or similar).
  - Replenishment recommender.
  - **(LOCKED, ADR-001):** Dropi scraper fallback uses the same `CSVConnector` — no additional code path required.

---

## REQ-open-decisions-pre-phase-1

- **Source:** `docs/PRD.md` §7
- **Scope:** Phase-1 entry gate
- **Acceptance criteria (all must resolve before Phase 1 starts):**
  1. Product identifiers — confirm any common code (barcode, supplier code); else assume AI matching from day one.
  2. POS propio — programmer's stack + willingness to emit webhooks.
  3. WordPress — confirm WooCommerce vs. custom.
  4. Mercado Libre credentials — register developer app, share keys.
  5. Dropi access — panel user/pass via secure env vars.
  6. AI feed format — dashboard cards only, or also email/WhatsApp summary?
  7. Initial AI model — start with Kimi K2 or Claude Haiku while Kimi is contracted?

---

## REQ-overall-timeline

- **Source:** `docs/PRD.md` §5 summary
- **Scope:** delivery
- **Acceptance criteria:**
  - Total estimated 10–14 weeks end-to-end.
  - Usable MVP in 4–6 weeks.

---
