# Phase 0 Plan — Discovery y normalización

**Phase:** 0
**Goal:** Understand the real catalog before construction; produce CSV-driven matching baseline + resolve pre-Phase-1 gating decisions.
**Depends on:** Nothing (first phase).
**Requirements covered:** DISC-01, DISC-02, DISC-03, DISC-04.

## Plans

This phase has one plan because the work is mostly serial (Claude-side deliverables in parallel, then handoff to client, then incorporation of client responses into the final report).

### Plan 0.1 — Discovery deliverables and baseline

Status: PARTIAL — Claude-side done, client-side blocked.

#### Tasks

- [x] **0.1.1** — Write client discovery questionnaire covering all PRD §7 open decisions + 4 additional gating questions (volume, history, identifier audit, AI preferences).
  - File: `docs/discovery-questionnaire.md`
- [x] **0.1.2** — Write CSV export templates per channel with column specs, source notes, and quirks.
  - Files: `docs/csv-templates/{README,wordpress,mercadolibre,dropi,pos,whatsapp}.md`
- [x] **0.1.3** — Build local 5-stage matching cascade script (TypeScript, runnable without Supabase).
  - Files: `scripts/discovery/{match-explorer,cascade,normalize,load-csv,llm-arbiter,report,types}.ts`
  - Supporting: `scripts/discovery/{package.json,tsconfig.json,README.md}`
- [x] **0.1.4** — Pre-seed mapping profiles for the 4 catalog-bearing channels.
  - Files: `scripts/discovery/profiles/{wordpress,mercadolibre,dropi,pos}-products.json`
- [x] **0.1.5** — Document the phase context, handoff plan, and stage definitions.
  - Files: `.planning/phases/0-discovery/CONTEXT.md`, `scripts/discovery/README.md`
- [x] **0.1.6** — Verify the script compiles (tsc --noEmit clean).
- [ ] **0.1.7** — [BLOCKED on client] Receive completed questionnaire from client.
- [ ] **0.1.8** — [BLOCKED on client] Receive catalog CSVs for WP, ML, Dropi, POS, WhatsApp samples.
- [ ] **0.1.9** — Run `npm run match` with real CSVs; tune mapping profiles per actual export headers.
- [ ] **0.1.10** — Test LLM arbiter precision on ~50 manually-labeled pairs; pick starting model (Haiku 4.5 baseline, escalate if precision <90%).
- [ ] **0.1.11** — Write `docs/discovery-report.md` with finalized numbers, sample hard cases, and recommendation.
- [ ] **0.1.12** — Update `.planning/PROJECT.md` Key Decisions table with the 7 resolved decisions (locked entries with date and rationale).
- [ ] **0.1.13** — Commit the discovery-report.md + PROJECT.md updates with message `phase-0: discovery report and locked decisions`.

#### Handoff trigger

Phase 0 closes (and Phase 1 may start) when:

- Tasks 0.1.7 through 0.1.13 are all complete.
- `match_rate_automatic` ≥ 60% (below means catalog cleanup is needed before Phase 1; treat as a Phase-0.1 insertion, not a Phase 1 task).
- All 7 PRD §7 decisions are LOCKED in PROJECT.md.

#### What can go wrong

| Risk                                                       | Detection                                      | Response                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Client cannot export CSVs from a channel                   | First inspection of received attachments       | Schedule a screen-share where dev exports together; if a channel has zero structured data (e.g. WhatsApp), accept hand-typed 30-row sample |
| Mapping profile headers don't match real exports           | First `npm run match` errors out reading a CSV | Edit `profiles/<channel>-products.json` column_map values; re-run                                                                          |
| Stages 1–4 yield < 40% automatic match                     | Report output                                  | Run LLM arbiter on broader threshold (lower JACCARD_MID); if still poor, recommend a catalog-cleanup sub-phase before F1                   |
| LLM rejection rate > 30% with Haiku                        | Report output                                  | Re-run with `--model claude-sonnet-4-6` or `--provider openai --model gpt-4o`; document the cost/precision tradeoff                        |
| Client decisions on §7 reveal a contradiction with ADR-001 | Manual review                                  | Open a new ADR amendment; do not silently override                                                                                         |
