# Phase 0 Context — Discovery y normalización de catálogo

## Goal

Understand the real catalog before construction; produce a CSV-driven baseline of automatic-vs-manual matching and resolve all pre-Phase-1 gating decisions.

ADR-001 (LOCKED) applies: catalog exports ingest via the same `CSVConnector` mechanism that will be used everywhere. Phase 0 produces the first stored mapping profiles (currently local JSON files; they'll move to the `csv_mapping_profiles` table in Phase 1).

## Why this phase exists

The PRD §2 is explicit: **without a normalized catalog, all analytics are noise**. If "Plancha X" is named differently in every channel and has no common SKU, we cannot say which product is hot or predict anything. This is the project's biggest risk — bigger than any technical challenge — and it gets resolved before we build any infrastructure.

Skipping Phase 0 means rebuilding the matching pipeline in 3 weeks when we discover the cliente actually has barcodes (or that 60% of the catalog needs human review and our validation UI is undersized).

## Scope

**IN scope:**

- Discovery questionnaire for the client covering catalog, volume, channel access, AI preferences, role decisions.
- CSV templates per channel specifying the exact format the client should export.
- Local exploratory matching script (no DB, no API required for stages 1–4).
- Baseline report with % automatic match and recommended starting LLM.
- Resolution of the 7 PRD §7 open decisions.

**OUT of scope:**

- Any Supabase schema work (Phase 1).
- Any channel connector implementation (Phase 2+).
- Dashboard UI (Phase 2+).
- Production-grade matching pipeline (Phase 2).

## Locked decisions affecting this phase

- **ADR-001** — CSV upload is a first-class data source. Phase 0 uses it for catalog ingestion, not as a fallback. The Jaccard-token-overlap proxy for embeddings in the local script is acceptable for discovery sizing; real embeddings (OpenAI/voyage) wire in during Phase 2.

## Deliverables (Claude-side, ready to ship)

1. `docs/discovery-questionnaire.md` — 11-block questionnaire (~45–60 min conversation + attachments list).
2. `docs/csv-templates/README.md` + 5 per-channel templates — exact column specs for client exports.
3. `scripts/discovery/match-explorer.ts` + supporting modules — runnable 5-stage cascade producing JSON + Markdown reports.
4. `scripts/discovery/profiles/<channel>-products.json` — pre-seeded mapping profiles for the 4 catalog-bearing channels.

## Deliverables (client-side, blocked on input)

1. Responses to all questionnaire blocks (A–K + attachments checklist).
2. Catalog CSVs for WordPress, ML, Dropi, and at least one POS, plus a WhatsApp orders sample.
3. Credentials (vía canal seguro) for WP, ML developer app, Dropi panel.
4. Confirmed decisions on the 7 PRD §7 items.

## Success criteria (from ROADMAP)

1. ✅ Client completed structured questionnaire — documented source inventory + credentials checklist.
2. ⏳ ≥1 historical CSV per current channel ingested via `CSVConnector` path with `csv_mapping_profiles` persisted.
3. ⏳ Baseline matching report published with recommended starting LLM.
4. ⏳ All 7 PRD §7 pre-Phase-1 decisions resolved and recorded in PROJECT.md Key Decisions.

> Note on (2): in Phase 0 the "CSVConnector path" is the local script + JSON profiles (no Supabase yet). The Phase 1 schema migrates these profiles into `csv_mapping_profiles` rows; the profile JSONs become the seed data for that migration.

## What can run today

```bash
cd scripts/discovery
npm install
npm run match:dry   # stages 1–4 only, no API required
```

When ANTHROPIC_API_KEY or OPENAI_API_KEY is available:

```bash
ANTHROPIC_API_KEY=... npm run match
```

## Handoff to Phase 1

When Phase 0 closes:

- `docs/discovery-report.md` is the artifact that informs Phase 1 sizing (validation queue capacity, LLM cost projection, schema constraints).
- `scripts/discovery/profiles/*.json` become seed inserts for `csv_mapping_profiles` in Phase 1.
- The questionnaire answers populate the 7 LOCKED entries in PROJECT.md Key Decisions.
