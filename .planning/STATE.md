# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-13)

**Core value:** One trusted, sub-15-minute view of "what is selling, where, right now" across every channel — built on a unified catalog that the AI helps create, not just analyze.
**Current focus:** Phase 0 — Discovery & catalog normalization

## Current Position

Phase: 0 of 6 (Discovery & catalog normalization)
Plan: 0.1 of 1 in current phase
Status: PARTIAL — Claude-side deliverables shipped; awaiting client input for tasks 0.1.7–0.1.13
Last activity: 2026-05-13 — Phase 0 Claude-side deliverables produced: discovery questionnaire (11 blocks), 5 channel CSV templates, runnable 5-stage match-explorer TS script with 4 pre-seeded mapping profiles, CONTEXT.md + PLAN.md.

Progress: [██████░░░░] 60% — 6 of 13 plan tasks done; remaining 7 blocked on client (questionnaire responses + catalog CSVs + 7 PRD §7 decisions).

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

Last session: 2026-05-13 (Phase 0 Claude-side execution)
Stopped at: Phase 0 deliverables (questionnaire + CSV templates + match-explorer script + mapping profiles + CONTEXT/PLAN) committed. Awaiting client input to close tasks 0.1.7–0.1.13. Phase 1 will not start until DISC-01..04 are complete.
Resume file: None
