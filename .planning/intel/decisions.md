# Decisions (ADRs)

Source-of-truth decisions extracted from classified docs. Locked decisions cannot be auto-overridden by lower-precedence sources.

---

## ADR-001 — CSV Upload as first-class data source

- **Source:** `docs/AMENDMENT-csv-source.md`
- **Status:** LOCKED (Accepted, immutable without explicit supersession)
- **Decisor:** Nicolás (cliente/dev)
- **Date:** 2026-05-13
- **Precedence:** 0 (ADR, overrides PRD)
- **Amends:** `docs/PRD.md` §3.4 (Dropi "Plan B: ingesta de exports CSV manuales")

### Decision

CSV upload is a **permanent, channel-agnostic, first-class data source** — not a Dropi contingency.

### Scope

- CSV upload ingestion (all channels, not only Dropi)
- New RAW-layer tables: `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles`
- Generic `CSVConnector` implementing `ChannelConnector` interface
- Dashboard "Operación" view 3-step upload wizard
- Supabase Storage retention of original payloads (immutable)
- Mapping profiles with versioning for reprocessing
- Phase 0 (Discovery): catalog CSVs ingested via this mechanism, produces first mapping profiles
- Phase 1 (Foundation): schema + `CSVConnector` + upload endpoint are Phase 1 deliverables
- Phase 2 (WordPress walking skeleton): used for historical backfill before live sync
- Phase 4 (Dropi): scraper fallback uses same `CSVConnector` (zero extra code)

### Properties of the decision

1. Permanent functionality, not contingency.
2. Immutable raw history (`raw_csv_uploads` + Supabase Storage payload retention).
3. Auto-processed: upload triggers matching pipeline → marts updated.
4. Channel-agnostic: any channel can contribute CSVs (proveedores sin API, ferias, mayoristas, reconciliación contable, backfill).
5. Reprocessing supported via mapping profile versioning without data loss.

### Rationale

- Unblocks Phase 0: client historical exports cannot be loaded without it.
- Reduces risk: API breakage in MercadoLibre/Dropi → manual CSV keeps business running (zero data downtime).
- Enables unlimited backfill of multi-year history.
- Immutable raw payload supports re-running corrected mappings without data loss.

### Supersedes / overrides

- Overrides PRD §3.4 framing of CSV as "Plan B" Dropi fallback only. After this amendment, the "Plan B" framing is replaced by "first-class, used everywhere".
- Reshapes Phase 0, Phase 1, Phase 2, Phase 4 deliverables (see "Scope" above).

---
