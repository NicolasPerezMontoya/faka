# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-13)

**Core value:** One trusted, sub-15-minute view of "what is selling, where, right now" across every channel — built on a unified catalog that the AI helps create, not just analyze.
**Current focus:** Phase 0 — Discovery & catalog normalization

## Current Position

Phase: 1 of 6 (Foundation)
Plan: 1.1.7 of 26 in current phase (Waves 0–1 of 5 complete)
Status: IN PROGRESS — Waves 0 + 1 complete (10 atomic commits). Wave 2 (connectors interface + skeletons + CSVConnector) next.
Last activity: 2026-05-13 — Phase 1 Wave 1 executed in 7 atomic commits: supabase init + 13 contiguous SQL migrations covering RAW + MASTER (incl. Mini-CRM stubs ADR-004) + FACTS (with idempotency unique constraint) + MARTS skeleton + INSIGHTS + messaging_log empty (ADR-003) + observability with connector_run_kind enum (W2 fix) + profiles + custom_access_token Auth Hook (ADR-002) + 19 SECURITY INVOKER per-role views + grants + reprocess versioning + seed.sql with 5 mapping profiles + TS Super Admin seeder.

Phase 0: PARTIAL — Claude-side deliverables shipped + ADRs 002/003/004 LOCKED; client-side blocked (questionnaire responses + CSVs). Does NOT block Phase 1 Foundation.

Progress: [████░░░░░░] Phase 1: 10 of 26 plans (38%); Waves 2–4 pending. 1463 LOC of SQL across 13 migrations + seed.

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

Last session: 2026-05-13 (Phase 1 Waves 0 + 1 execution)
Stopped at: 10 atomic commits landed (1.0.1–1.0.3, 1.1.1–1.1.7). Schema 100% done; runs `pnpm db:reset` once Supabase Docker is up. Next wave: Wave 2 (`@faka/schema` + `ChannelConnector` interface + 6 channel skeletons + real CSVConnector + helpers + integration tests) = 5 plans, ~14h. Resume with `/gsd-execute-phase 1 --wave 2`.
Resume file: None
