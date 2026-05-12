# Constraints

Technical contracts, schemas, NFRs, and protocol-level constraints extracted from the source docs. Constraints inherit the precedence of their source; ADR-derived constraints (LOCKED) cannot be overridden by lower-precedence docs.

---

## CONSTR-budget-cap

- **Source:** `docs/PRD.md` §1, §3.2
- **Type:** nfr (cost)
- **Constraint:** Monthly infrastructure + services spend MUST stay within $150 USD/month.
- **Target operating point:** $50–85/month (Supabase + Railway + Vercel + LLM + monitoring), leaving ~$65 headroom.

---

## CONSTR-data-volume

- **Source:** `docs/PRD.md` §1
- **Type:** nfr (scale)
- **Constraint:** System sized for ~5,000 consolidated transactions/month at launch. Architecture and indexing decisions must not assume large-scale (Mn+/month) workloads.

---

## CONSTR-supabase-tier

- **Source:** `docs/PRD.md` §3.2
- **Type:** infra
- **Constraint:** Supabase Postgres ($0 free → $25 Pro) is the SoT. Includes Auth, Storage, Realtime. Tier choice gated on data volume but not expected to exceed Pro at launch.

---

## CONSTR-orchestrator-runtime

- **Source:** `docs/PRD.md` §3.2
- **Type:** infra
- **Constraint:** Orchestrator MUST run as Node.js + TypeScript on Railway. Cron jobs and workers in-process or as Railway services.

---

## CONSTR-dashboard-runtime

- **Source:** `docs/PRD.md` §3.2
- **Type:** infra
- **Constraint:** Dashboard MUST be Next.js 14 (App Router) on Vercel free tier.

---

## CONSTR-channel-connector-interface

- **Source:** `docs/PRD.md` §3.4
- **Type:** api-contract (internal)
- **Constraint:** All channel connectors MUST implement:

```typescript
interface ChannelConnector {
  name: string;
  type: 'pull' | 'push' | 'manual';
  capabilities: Set<'orders' | 'products' | 'inventory' | 'customers'>;

  fetchOrders(since: Date): Promise<RawOrder[]>;
  fetchProducts(since: Date): Promise<RawProduct[]>;
  fetchInventory?(): Promise<RawInventory[]>;

  normalizeOrder(raw: RawOrder): NormalizedOrder;
  normalizeProduct(raw: RawProduct): NormalizedProduct;

  healthCheck(): Promise<HealthStatus>;
}
```

New channels MUST conform without modifying existing connectors.

---

## CONSTR-csv-connector (LOCKED — ADR-001)

- **Source:** `docs/AMENDMENT-csv-source.md`
- **Type:** api-contract (internal)
- **Precedence:** 0 (LOCKED ADR overrides PRD §3.4 "Plan B" framing)
- **Constraint:** A generic `CSVConnector` MUST exist as a first-class `ChannelConnector` implementation:

```typescript
class CSVConnector implements ChannelConnector {
  name = 'csv-upload';
  type = 'manual';
  // Receives upload + mapping profile, emits NormalizedOrder/NormalizedProduct
  async ingestUpload(uploadId: string): Promise<IngestResult>;
}
```

- One implementation; used by every channel that needs CSV ingestion (not Dropi-specific).
- Lives in the orchestrator; not in any per-channel connector module.

---

## CONSTR-idempotency-key

- **Source:** `docs/PRD.md` §3.4 (Orchestrator patterns)
- **Type:** protocol
- **Constraint:** Ingestion idempotency key is `(canal, external_order_id)` across all connectors. Re-ingesting the same order MUST be a no-op.

---

## CONSTR-retry-policy

- **Source:** `docs/PRD.md` §3.4
- **Type:** protocol
- **Constraint:** Failed external fetches MUST retry 3× with exponential backoff. Final failure routes to dead-letter queue, not lost.

---

## CONSTR-connector-observability

- **Source:** `docs/PRD.md` §3.4
- **Type:** observability
- **Constraint:** Every connector run MUST write a row to `connector_runs(timestamp, duración, registros_procesados, errores)`. Dashboard "Operación" surfaces this.

---

## CONSTR-rls-required

- **Source:** `docs/PRD.md` §3.7
- **Type:** nfr (security)
- **Constraint:** Row-Level Security MUST be enabled on Postgres for all user-readable tables. Token leakage MUST NOT exceed role boundaries.

---

## CONSTR-secret-storage

- **Source:** `docs/PRD.md` §3.7
- **Type:** nfr (security)
- **Constraint:** Channel API keys + provider keys MUST live in Railway environment variables. Forbidden: storing secrets in Supabase tables, in the frontend bundle, in source control.

---

## CONSTR-audit-log

- **Source:** `docs/PRD.md` §3.7
- **Type:** observability
- **Constraint:** `audit_log` table MUST record who-did-what-when for user-initiated mutations (uploads, match validations, override of auto-matches, etc.).

---

## CONSTR-llm-provider-adapter

- **Source:** `docs/PRD.md` §3.5
- **Type:** api-contract (internal)
- **Constraint:** LLM access MUST go through a single `LLMProvider` adapter interface (mirrors the connector pattern). Concrete providers: Kimi K2, Claude Haiku 4.5, GPT-4o-mini, Gemini 2.5 Flash. Provider swap MUST be via env var only.

---

## CONSTR-mvp-latency

- **Source:** `docs/PRD.md` §5 (Fase 1 success metric)
- **Type:** nfr (performance)
- **Constraint:** Day-sales MUST reflect in the dashboard within 15 minutes of the source transaction.

---

## CONSTR-matching-coverage

- **Source:** `docs/PRD.md` §5 (Fase 1 success metric)
- **Type:** nfr (data quality)
- **Constraint:** ≥80% of products in `sale_items` MUST have a non-null `master_sku` by end of Phase 1.

---

## CONSTR-ai-insight-usefulness

- **Source:** `docs/PRD.md` §5 (Fase 3 success metric)
- **Type:** nfr (product quality)
- **Constraint:** ≥70% of generated insights MUST be flagged "útil" after 2 weeks of use.

---

## CONSTR-raw-csv-schema (LOCKED — ADR-001)

- **Source:** `docs/AMENDMENT-csv-source.md`
- **Type:** schema
- **Precedence:** 0 (LOCKED)
- **Constraint:** Postgres MUST include:

```
raw_csv_uploads
  - upload_id          PK UUID
  - canal_declarado    wordpress | mercadolibre | dropi | pos | whatsapp | otro
  - tipo               orders | products | inventory | mixto
  - filename
  - bytes
  - row_count
  - uploaded_by        FK user
  - uploaded_at
  - storage_path       Supabase Storage URI
  - mapping_profile_id FK csv_mapping_profiles
  - status             uploaded | validating | processed | failed
  - error_log_json

raw_csv_rows
  - upload_id          FK
  - row_number
  - payload_json       fila tal cual, sin transformar
  - processed          bool
  - target_table       raw_orders | raw_products | ...

csv_mapping_profiles
  - id                 PK
  - nombre             ej "Dropi pedidos v2"
  - canal
  - tipo
  - column_map_json    {"Fecha":"fecha","SKU vendedor":"external_sku",...}
  - reglas_json        transformaciones, defaults, validaciones
  - creado_por
  - version
```

Original CSV payload MUST be retained in Supabase Storage and addressable via `raw_csv_uploads.storage_path`. Re-running a corrected mapping profile against an existing upload MUST be supported without re-uploading.

---

## CONSTR-csv-ingest-pipeline (LOCKED — ADR-001)

- **Source:** `docs/AMENDMENT-csv-source.md`
- **Type:** protocol
- **Precedence:** 0 (LOCKED)
- **Constraint:** On CSV upload, the file MUST be:
  1. Stored verbatim to Supabase Storage.
  2. Exploded into `raw_csv_rows` with payload preserved as `payload_json`.
  3. Passed through the matching pipeline.
  4. Reflected in marts (sales/inventory) per declared `tipo`.
- Reprocessing with a versioned `csv_mapping_profile` MUST be a single user action from the Operación view.

---

## CONSTR-csv-channel-agnostic (LOCKED — ADR-001)

- **Source:** `docs/AMENDMENT-csv-source.md`
- **Type:** product
- **Precedence:** 0 (LOCKED)
- **Constraint:** CSV ingestion MUST work for any declared `canal` (wordpress, mercadolibre, dropi, pos, whatsapp, otro). Use cases that MUST be supported:
  - Initial historical load per channel before live connectors come online.
  - Channels without an API (future suppliers, ferias, wholesale).
  - Manual backfill when a live connector fails.
  - Monthly accounting reconciliation.

---
