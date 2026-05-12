# Discovery Match Explorer

Phase 0 exploration tool: load catalog CSVs from each channel and run the 5-stage matching cascade locally (no DB, no Supabase yet). Produces a baseline report estimating what % of the catalog will match automatically vs. need human review.

## Setup

```bash
cd scripts/discovery
npm install
```

## Input layout

The script reads CSVs from `<repo>/scratch/raw-csvs/<channel>/` (the `scratch/` dir is gitignored):

```
scratch/raw-csvs/
  wordpress/
    wordpress-products-2026-05-13.csv
  mercadolibre/
    mercadolibre-products-2026-05-13.csv
  dropi/
    dropi-products-2026-05-13.csv
  pos/
    pos1-products-2026-05-13.csv
    pos2-products-2026-05-13.csv
  whatsapp/
    whatsapp-orders-2026-05-13.csv     # whatsapp is orders-only; tool skips it for products matching
```

Drop the CSVs (received from client per `docs/csv-templates/`) into the corresponding folder.

## Mapping profiles

Each `profiles/<channel>-products.json` maps CSV columns → canonical fields. Edit before running:

- Set `column_map.X` to the exact header in the source CSV.
- Set to `null` (or omit) if the channel doesn't export that field.

Pre-seeded profiles match the most common export formats. The `_template.json` documents the full set of canonical fields.

## Running

**Fast pass (no API, deterministic only):**
```bash
npm run match:dry
```
Runs stages 1–4 only (barcode → supplier_code → sku → normalized_name → jaccard token overlap). No LLM calls.

**Full pass (with LLM arbiter):**
```bash
ANTHROPIC_API_KEY=sk-ant-... npm run match
```
Adds stage 5 (LLM arbiter on top ~100 hard cases). Default model: `claude-haiku-4-5-20251001`.

**Flags:**
- `--anchor <channel>` — channel to use as the anchor (default: `pos`). Pick the channel with the most barcodes/supplier_codes.
- `--no-llm` — skip stage 5 even with an API key.
- `--no-embeddings` — skip stage 4 (also disables 5).
- `--max-llm <n>` — cap LLM calls (default 100).
- `--provider openai|anthropic` — switch provider.
- `--model <name>` — override model (e.g. `gpt-4o-mini`, `kimi-k2`).

## Output

- `docs/discovery-report.json` — full structured report.
- `docs/discovery-report.md` — human-readable summary with method breakdown, sample unresolved cases, and recommendation.

## Stages

| # | Method | Description | Score |
|---|--------|-------------|-------|
| 1 | `barcode_exact` | Normalized barcode (digits only, ≥8 chars) match | 1.00 |
| 2 | `supplier_code_exact` | Supplier code match (case-insensitive) | 1.00 |
| 3 | `sku_exact` | SKU match (case-insensitive) | 0.95 |
| 4 | `normalized_name_exact` | After lowercase/strip-accents/strip-punct match | 0.90 |
| 5 | `embeddings_high` / `embeddings_mid` | Jaccard token overlap (proxy for embeddings until OpenAI embeddings are wired) | 0.45–0.99 |
| 6 | `llm_arbiter_match/reject` | LLM decides for hard cases that didn't pass stage 4 | model confidence |

> **Note:** stage 5 currently uses **Jaccard token overlap** as a proxy. Wiring real OpenAI/voyage embeddings is a Fase-2-time concern; for discovery, Jaccard suffices to size the validation queue. The cascade is structured so embeddings can drop in without touching cascade.ts callers.

## Interpreting the report

- **`match_rate_automatic` ≥ 80%** → matching pipeline can run with light human review queue. PRD success metric met.
- **60–80%** → validation UI is critical, queue will be busy week 1–2.
- **< 60%** → catalog needs preparatory cleanup (cliente debe normalizar nombres / cargar barcodes) **antes** de Fase 1, no después.

If LLM rejection rate > 30%, swap to a stronger model (Sonnet, GPT-4o) and re-run. Document the comparison in the report; the goal is finding the cheapest model that hits ≥ 90% precision on the arbiter step.
