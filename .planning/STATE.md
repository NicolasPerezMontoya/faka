# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-13)

**Core value:** One trusted, sub-15-minute view of "what is selling, where, right now" across every channel — built on a unified catalog that the AI helps create, not just analyze.
**Current focus:** Phase 0 — Discovery & catalog normalization

## Current Position

Phase: 1 of 6 (Foundation)
Plan: 1.3.6 of 26 in current phase (Waves 0–1–2(4/5)–3 complete)
Status: IN PROGRESS — 20 of 26 plans done (77%). Wave 4 (Hono orchestrator + Railway deploy) is the last remaining wave. Tests deferred (1.2.5) until Supabase local verified.
Last activity: 2026-05-13 — Phase 1 Wave 3 executed in 6 atomic commits: Next.js dashboard scaffold + @faka/ui (10 primitives + UserBadge), @faka/auth (role matrix + middleware + JWT claims + requireRole + sign-in/out) + login UI + auth-aware topbar (W5), Operación landing + wizard host, Step 1 channel/tipo/profile picker, Step 2 dropzone + preview + mapping table + Storage upload via uploadCsvAction (filename sanitization + 20MB cap), Step 3 dry-run + commit-upload (W1 boundary — applyColumnMap calls = 0), Historial page with DataTable + reprocess modal (idempotent UPSERT preserves dedup).

Phase 0: PARTIAL — Claude-side deliverables shipped + ADRs 002/003/004 LOCKED; client-side blocked (questionnaire responses + CSVs). Does NOT block Phase 1 Foundation.

Progress: [████████░░] Phase 1: 20 of 26 plans (77%); ~6970 total LOC across SQL + TypeScript + CSS + JSON. Wave 4 (orchestrator + deploy) = 4 plans / ~14h pending.

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

Last session: 2026-05-13 (Phase 1 Waves 0 + 1 + 2(4/5) + 3)
Stopped at: 20 plans landed across 5 waves. Dashboard fully scaffolded — wizard end-to-end with Steps 1/2/3 + historial + reprocess + W5 auth-aware topbar. Wave 4 (orchestrator skeleton + Railway/Vercel deploy config) = 4 plans / ~14h pending. Resume with `/gsd-execute-phase 1 --wave 4`.

**Environment note (2026-05-13)**: tried to run `pnpm install` + `supabase start` + `pnpm db:reset` from this WSL2 environment. Network connectivity to registry.npmjs.org is unstable — curl gets HTTP 200 in 2s but pnpm's parallel fetcher times out on ~95% of requests (both IPv4 and IPv6 routing tried). Only 23 of ~500 dependencies resolved. THREE real version mismatches discovered during the attempt and committed in `2cb0b70`:
  - packageManager pin pnpm@11.1.1 → 10.28.1 (matches installed; was causing corepack hang)
  - @supabase/supabase-js ^2.105.4 → ^2.105.1 (2.105.4 doesn't exist; latest is 2.105.1)
  - @typescript-eslint/* ^8.18.0 → 8.18.0 exact (^ resolved to 8.59.3 which has a missing sibling subpackage)

Install will work in GitHub Actions (db-integration job), Vercel preview builds, or any environment with stable npm registry connectivity. Schema verification via `pnpm db:reset` is therefore deferred to first deploy.

Resume file: None
