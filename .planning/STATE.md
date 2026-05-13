# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-13)

**Core value:** One trusted, sub-15-minute view of "what is selling, where, right now" across every channel — built on a unified catalog that the AI helps create, not just analyze.
**Current focus:** Phase 0 — Discovery & catalog normalization

## Current Position

Phase: 1 of 6 (Foundation)
Plan: 1.2.4 of 26 in current phase (Waves 0–1 + 4/5 of Wave 2 complete)
Status: IN PROGRESS — 14 atomic commits. Wave 2 plan 1.2.5 (integration tests) deferred until Supabase local is verified. Wave 3 (dashboard) next once Wave 2 closes.
Last activity: 2026-05-13 — Phase 1 Wave 2 executed in 4 atomic commits: @faka/schema (11 source files w/ Zod) + @faka/connectors interface (ChannelConnector contract + NotImplementedError), 6 channel skeletons (each throws literal NOT_IMPLEMENTED_F<N>), real CSVConnector (ingestUpload streaming + applyColumnMap + Zod safeParse + UPSERT on idempotency keys + auto-detect + dry-run), cross-cutting helpers (idempotency, retry+DLQ via p-retry, recordConnectorRun w/ kind/canal coherence enforcement, auditLog w/ 64KB truncation).

Phase 0: PARTIAL — Claude-side deliverables shipped + ADRs 002/003/004 LOCKED; client-side blocked (questionnaire responses + CSVs). Does NOT block Phase 1 Foundation.

Progress: [██████░░░░] Phase 1: 14 of 26 plans (54%); 1463 LOC SQL + 1894 LOC TypeScript so far. Wave 2 plan 1.2.5 (tests) + Wave 3 (dashboard) + Wave 4 (orchestrator) pending.

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: — (no data yet)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- **ADR-001 (LOCKED, 2026-05-13)**: CSV Upload as first-class, channel-agnostic data source — reshapes Phases 0, 1, 2, 4 deliverables. New RAW tables + generic `CSVConnector` + Operación-view wizard. Source: `docs/AMENDMENT-csv-source.md`. Immutable.
- **Stack pinned (2026-05-13)**: Supabase + Railway (Node/TS) + Vercel (Next.js 14) + Kimi K2 baseline via `LLMProvider` adapter. Total target $50–85/mo, hard cap $150/mo.
- **Matching cascade locked (2026-05-13)**: barcode → supplier code → normalized name → embeddings → LLM arbiter; image-match (CLIP) deferred to v2.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- **Phase-1 gate (PRD §7)**: 7 open decisions must close in Phase 0 before Phase 1 starts — product identifiers; POS programmer stack + webhook willingness; WordPress is WC vs custom; ML developer-app credentials; Dropi panel user/pass via secure env vars; AI feed format (dashboard cards only, or also email/WhatsApp summary); initial LLM (Kimi K2 vs Claude Haiku 4.5 starter). Tracked as DISC-04.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Cascade | Image-match (CLIP) step in matching cascade | Deferred to v2 (channel-image availability not confirmed across ML/Dropi/WP at v1) | 2026-05-13 |
| Channel | Falabella Marketplace activation | Deferred to Phase 6 (optional; non-priority per client) | 2026-05-13 |

## Session Continuity

Last session: 2026-05-13 (Phase 1 Waves 0 + 1 + Wave 2 plans 1.2.1–1.2.4)
Stopped at: 14 atomic commits landed (1.0.1–1.0.3, 1.1.1–1.1.7, 1.2.1–1.2.4). Code-side of F1 essentially complete: schema + interface + skeletons + CSVConnector + helpers all compile against the contract. Remaining: 1.2.5 integration tests (deferred until local Supabase verified), Wave 3 dashboard (6 plans / 28h), Wave 4 orchestrator (4 plans / 14h). Resume with `/gsd-execute-phase 1 --wave 3` once Wave 2 finalized.
Resume file: None
