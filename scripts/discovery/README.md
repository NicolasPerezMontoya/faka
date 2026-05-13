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

## LLM provider configuration (multi-provider, env-driven)

Copy `.env.example` → `.env` and fill **one** of these blocks. The script reads `.env` automatically via Node's `--env-file-if-exists` flag (Node ≥ 22.7 required).

| Provider | API key env var | Default model | Notes |
|----------|-----------------|---------------|-------|
| Vercel AI Gateway (recommended) | `AI_GATEWAY_API_KEY` | `anthropic/claude-haiku-4-5` | Unified API, observability, automatic provider fallback. https://vercel.com/docs/ai-gateway |
| Anthropic Claude | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` | https://console.anthropic.com |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini` | https://platform.openai.com |
| Google Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.5-flash` | https://aistudio.google.com/apikey |
| Moonshot (Kimi K2) | `MOONSHOT_API_KEY` | `kimi-k2-0905-preview` | OpenAI-compatible, base URL auto-set |
| Any OpenAI-compatible | `OPENAI_COMPATIBLE_API_KEY` + `OPENAI_COMPATIBLE_BASE_URL` | depends | Together, Groq, Fireworks, self-hosted |

**Resolution order:**
1. CLI flag (`--provider X --model Y`) — always wins.
2. Explicit env (`LLM_PROVIDER=X` + `LLM_MODEL=Y`) — wins over auto-detect.
3. Auto-detection — picks the first provider whose API key is present, in this order: `gateway → anthropic → openai → google → moonshot → compatible`.

Examples:

```bash
# .env: AI_GATEWAY_API_KEY=...  → uses gateway, model anthropic/claude-haiku-4-5
npm run match

# .env: LLM_PROVIDER=openai LLM_MODEL=gpt-4o-mini OPENAI_API_KEY=...
npm run match

# .env: LLM_PROVIDER=moonshot MOONSHOT_API_KEY=...  → kimi-k2 via OpenAI-compat
npm run match

# Override at runtime (no .env edit)
npm run match -- --provider anthropic --model claude-sonnet-4-6

# Self-hosted / Together AI / Groq
# .env:
#   LLM_PROVIDER=compatible
#   LLM_MODEL=llama-3.1-70b-instruct
#   OPENAI_COMPATIBLE_API_KEY=...
#   OPENAI_COMPATIBLE_BASE_URL=https://api.together.xyz/v1
npm run match
```

## Running

**Fast pass (no API, deterministic only):**
```bash
npm run match:dry
```
Runs stages 1–4 only. No LLM calls, no API key required.

**Full pass:**
```bash
npm run match
```
Reads `.env`, detects provider, runs stages 1–4 + LLM arbiter on top ~100 hard cases.

**Flags (override env):**
- `--anchor <channel>` — channel to use as the anchor (default: `pos`).
- `--no-llm` — skip stage 5 even with an API key set.
- `--no-embeddings` — skip stage 4 (Jaccard) and stage 5.
- `--max-llm <n>` — cap LLM calls (default 100; also `LLM_MAX_CALLS=N` in `.env`).
- `--provider <name>` — `gateway|anthropic|openai|google|moonshot|compatible`.
- `--model <name>` — override default model for the provider.

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
