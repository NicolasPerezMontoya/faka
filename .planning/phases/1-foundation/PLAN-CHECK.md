# Phase 1 Foundation — Plan Verification Report

**Date:** 2026-05-13
**Subject:** `/home/mandark/faka/.planning/phases/1-foundation/PLAN.md`
**Verifier:** gsd-plan-checker (goal-backward analysis, adversarial stance)
**Scope:** 25 plans across 5 waves; ROADMAP F1 success criteria 1–5; FND-01..08; ADRs 001/002/003/004 LOCKED.

---

## TL;DR — Verdict

**REVISE** (1 BLOCKER + 6 WARNINGs)

The plan is exceptionally well-researched, traces every success criterion to specific tasks, and respects every LOCKED decision in substance. The schema design, RLS pattern, Auth Hook implementation, CSVConnector architecture, and idempotency/retry/observability story are all sound and ready for execution.

However, two material problems stop it from passing as-is:

1. **BLOCKER — Wave 2 plan-numbering inconsistency.** The execution-waves block, parallelism narrative, and Wave 2 intro reference plans `1.2.1..1.2.9` (or `1.2.7`) that do not exist; only 1.2.1–1.2.5 are actually defined. Same `CSVConnector real impl` is `1.2.3` in the body but `1.2.7` in the wave header and cross-references. Executors will read divergent dependency graphs.
2. **WARNINGs** on (a) duplicated commit-upload logic between 1.2.3 `ingestUpload` and 1.3.5 `commitUpload`, (b) Wave 3 serial chain breaks the W2/W3 parallel claim in the wave-table description, (c) Dashboard build (1.3.1) precedes auth (1.3.2) but middleware is referenced from layout, (d) cron-heartbeat enum mutation in 1.4.2 is a separate-wave additive migration that depends on Wave 1 having completed — this is fine, but the channel enum was originally locked to the discovery types.ts contract; PATTERNS §5.4 should have flagged the addition as a contract change requiring a re-export update in `scripts/discovery`, (e) missing CC entry for verifying `messaging_log` is truly empty / never written to in F1, (f) PROJECT.md `branch-specific Supabase projects` Open Question is resolved-by-recommendation but not marked RESOLVED; under strict Dimension 11 this is a borderline failure.

After fix-ups, the plan is genuinely ready for execution.

---

## 1. Goal-backward trace per Success Criterion

### SC1 — Full 5-layer schema deployed, zero pending migrations

**Status:** PASS (with cosmetic warning on migration count)

| Required artifact                                                                                                 | Plan(s)                                           | Notes                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| Extensions (pgcrypto, pg_trgm, vector)                                                                            | 1.1.1 migration 0001                              | ✅                                                             |
| Enums: channel (incl. falabella, csv-upload), match_method, csv_upload_status, user_role                          | 1.1.1 migration 0002                              | ✅ Channel enum matches PATTERNS §5.4 contract                 |
| RAW layer: `raw_csv_uploads`, `raw_csv_rows`, `csv_mapping_profiles`, `raw_orders`, `raw_products`, `raw_events`  | 1.1.1 migration 0003                              | ✅ — column shapes anchored to ADR-001 verbatim                |
| MASTER layer: `master_products`, `product_mappings`, `product_variants`, `master_categories`, `category_mappings` | 1.1.2 migration 0004                              | ✅                                                             |
| MASTER stubs (ADR-004 LOCKED): `customers`, `customer_external_links`, `customer_merge_log`                       | 1.1.2 migration 0004                              | ✅ — `customer_id` indexed for F4                              |
| FACTS: `sales` (with nullable `customer_id` FK + unique idempotency), `sale_items`, `inventory_snapshots`         | 1.1.3 migration 0005                              | ✅ — `unique (canal, external_order_id)` correctly placed      |
| MARTS skeleton (6 tables)                                                                                         | 1.1.4 migration 0006                              | ✅                                                             |
| INSIGHTS + `messaging_log` (ADR-003 LOCKED empty)                                                                 | 1.1.4 migration 0007                              | ✅ — explicit "EMPTY table" instruction + verify count=0       |
| Observability: `connector_runs`, `audit_log`, `dead_letter_queue`                                                 | 1.1.4 migration 0008                              | ✅ — audit_log columns match ADR-002:43 verbatim               |
| Profiles + Auth Hook                                                                                              | 1.1.5 migration 0011                              | ✅                                                             |
| RLS, role views, grants                                                                                           | 1.1.6 migrations 0012/0013/0014                   | ✅                                                             |
| Seed (mapping profiles + Super Admin)                                                                             | 1.1.7                                             | ✅                                                             |
| Additive: `raw_csv_rows.superseded_at` + `mapping_profile_version`                                                | 1.3.6 migration 0015                              | ✅ append-only — respects "migrations are append-only" Note 2  |
| Additive: extend `channel` enum with `cron-heartbeat`                                                             | 1.4.2 migration 0016                              | ⚠️ WARNING — see Scope-creep §3.4                              |
| `supabase db diff --linked` returns empty                                                                         | CC-1                                              | ✅                                                             |
| `supabase db reset` clean (16 migrations)                                                                         | CC-2                                              | ✅ — RESEARCH §10 forbids `db push` from CI; Plan 1.0.3 honors |
| Types regen + git diff exit-code                                                                                  | CC-3 (and 1.1.7 verify, 1.0.3 db-integration job) | ✅                                                             |

**Gap (warning, not blocker):** Plan does not include migrations 0009, 0010. The numbered run is 0001–0008, 0011–0016. Migrations 0009 and 0010 are deliberately skipped — but no plan calls this out. An executor may assume two migrations are "missing" and add them. **Recommend:** Plan 1.1.5 should note the deliberate numbering gap (0011 jumps after 0008 to keep `profiles_and_role_hook` ordered after observability) OR simply renumber to be sequential. PATTERNS §3.B uses 0001–0011 sequentially; the PLAN.md unilaterally jumps. Mild but concrete confusion risk.

---

### SC2 — End-to-end CSV upload via Operación wizard + reprocess

**Status:** PASS

| Required behavior                                              | Plan(s)                                            | Notes                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 3-step wizard UI (Fuente/Mapeo/Validar) matching sketch        | 1.3.3 (step 1), 1.3.4 (step 2), 1.3.5 (step 3)     | ✅ — sketch line ranges cited per PATTERNS §5.7                                         |
| Multipart streaming to Storage with immutability + 20MB cap    | 1.3.4 `upload-csv.ts` Server Action                | ✅ — sanitization + size/type guards documented                                         |
| `raw_csv_uploads` + `raw_csv_rows` populated, payload retained | 1.3.4 (uploads insert) + 1.3.5 (rows chunk insert) | ✅                                                                                      |
| `audit_log` entry on creation + processing                     | 1.3.4 + 1.3.5                                      | ✅                                                                                      |
| Auto-detect for mapping                                        | 1.2.3 `auto-detect.ts` + 1.3.4 thin wrapper        | ✅                                                                                      |
| Dry-run with valid/warning/error counts                        | 1.2.3 `dry-run.ts` + 1.3.5 Server Action           | ✅ — projected.\* placeholders for F1 documented                                        |
| `CSVConnector.ingestUpload` engine                             | 1.2.3                                              | ✅                                                                                      |
| Reprocess action with versioned profile (FND-07)               | 1.3.6 + additive migration 0015                    | ✅ — supersedes prior rows; UPSERT idempotency on `(canal, external_order_id)` enforced |
| Storage payload immutability after reprocess                   | 1.3.6 anti-duplication note + CC-13                | ✅                                                                                      |
| Integration test for end-to-end + reprocess                    | 1.3.5 + 1.3.6 tests                                | ✅                                                                                      |

⚠️ WARNING — **Logical duplication between 1.2.3 `ingestUpload` and 1.3.5 `commitUpload`.** Both implement column-map parsing + chunk insert flow. RESEARCH §6 describes a single `commitUpload` Server Action that calls `csvConnector.ingestUpload(upload_id)` inline. The plan splits the work: 1.3.5 commit-upload parses rows from Storage and inserts into `raw_csv_rows`, then invokes `csvConnector.ingestUpload`, which (per 1.2.3) ALSO loads `raw_csv_rows` and ALSO applies the column map. This means rows pass through `applyColumnMap` twice and Zod validation runs in two places. **Fix:** clarify in 1.2.3 + 1.3.5 which side does what. Either (a) `commitUpload` parses CSV bytes → writes `raw_csv_rows` (raw payload only, no validation), then `ingestUpload` applies column map + validates + emits Normalized rows; OR (b) `commitUpload` does the full parse-+-validate and `ingestUpload` only reads pre-validated `raw_csv_rows`. The current text is ambiguous. Choosing (a) matches RESEARCH §6 closer.

---

### SC3 — 4 roles login; RLS + column views; secrets in env vars only

**Status:** PASS (strong — every locked ADR-002 column constraint is verifiable)

| Required behavior                                                | Plan(s)                                                                      | Notes                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 4 roles (super_admin/admin/manager/analista) in enum + JWT claim | 1.1.1 (enum) + 1.1.5 (hook + GRANT to supabase_auth_admin)                   | ✅ — Pitfall 2 GRANT explicit in 1.1.5                                               |
| `WITH (security_invoker = true)` on EVERY role view              | 1.1.6 + CC-12 lint                                                           | ✅ MANDATORY per RESEARCH Pitfall 1 — both task action AND verify command enforce it |
| Manager can NOT see customer columns                             | 1.1.6 view projection (`null::uuid as customer_id`) + 1.2.5 rls.test.ts      | ✅ — assertion explicit                                                              |
| Analista can NOT see $ OR customer columns                       | 1.1.6 view projection + test asserts `total IS NULL AND customer_id IS NULL` | ✅                                                                                   |
| Customers table hidden from Manager + Analista per ADR-004:65-69 | 1.1.6 (`customers_view_manager`/`_analista` return zero rows or all NULL)    | ✅ — explicit                                                                        |
| Base table SELECT revoked from `authenticated`                   | 1.1.6 grants 0014 + test asserts `permission denied`                         | ✅                                                                                   |
| Super Admin seeded with email `nicolasperezmontoya@gmail.com`    | 1.1.7                                                                        | ✅ — verifies idempotency + correct role                                             |
| Login UI + JWT middleware + role-routing                         | 1.3.2                                                                        | ✅ — ADR-002 matrix encoded in route table                                           |
| Forbidden landing for Analista on `/operacion`                   | 1.3.2 integration test                                                       | ✅                                                                                   |
| Secrets in env vars only — never in repo/client bundle           | CC-5 + CC-11 lint + 1.0.2 eslint custom rule + 1.4.4 vercel.json grep        | ✅ — defense-in-depth                                                                |

**Note:** ROADMAP SC3 text still says "3 roles (owner, developer, staff)" — legacy text superseded by ADR-002. PLAN.md correctly flags this in §"Goal-backward verification SC3" and ships the 4-role matrix. Acceptable supersession.

---

### SC4 — 6 connector skeletons compile; CSVConnector wired into upload

**Status:** PASS

| Required behavior                                                                    | Plan(s)                                 | Notes                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------- |
| `ChannelConnector` interface published with ADR-004 `extractCustomerHint?` hook      | 1.2.1                                   | ✅ — hook present (verify grep)                |
| 6 skeletons (WP/ML/Dropi/POS/WhatsApp/Falabella) compile + throw NOT_IMPLEMENTED_F\* | 1.2.2                                   | ✅ — per-channel phase tags (F2/F3/F4/F5.5/F6) |
| Falabella disabled per FND-04                                                        | 1.2.2 + 1.3.3 (disabled card in wizard) | ✅                                             |
| `CSVConnector` concrete, wired into upload                                           | 1.2.3 + 1.3.4/1.3.5 Server Actions      | ✅                                             |
| `buildRegistry` instantiates all 7 in orchestrator                                   | 1.4.1                                   | ✅ — `/connectors` endpoint exposes them       |
| Type-level conformance test                                                          | 1.2.5 skeletons.test.ts                 | ✅                                             |
| CC-6 compile + skeleton test green                                                   | CC-6                                    | ✅                                             |

---

### SC5 — Cross-cutting orchestrator protocols (idempotency, retry+DLQ, connector_runs, audit_log)

**Status:** PASS

| Required behavior                                                          | Plan(s)                | Notes                                               |
| -------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------- |
| DB unique `(canal, external_order_id)` on `sales`                          | 1.1.3 migration 0005   | ✅                                                  |
| `connector_runs`, `audit_log`, `dead_letter_queue` tables                  | 1.1.4 migration 0008   | ✅                                                  |
| `idempotentUpsert` helper using ON CONFLICT                                | 1.2.4 idempotency.ts   | ✅                                                  |
| `withRetryAndDLQ` with `p-retry` exp backoff 3×                            | 1.2.4 retry.ts         | ✅                                                  |
| `recordConnectorRun` writes once at END (per RESEARCH §8)                  | 1.2.4 observability.ts | ✅ — anti-duplication note enforces "not per chunk" |
| `auditLog` helper + 64KB cap + truncation marker                           | 1.2.4 audit.ts         | ✅ — RESEARCH §6 audit pitfall addressed            |
| `audit_log` on user mutations (create/process/reprocess)                   | 1.3.4 + 1.3.5 + 1.3.6  | ✅ — three distinct actions wired                   |
| Cron heartbeat exercises `connector_runs`                                  | 1.4.2                  | ✅ — clean `process.exit(0)` per Pitfall 7          |
| Orchestrator integration tests for idempotency + retry+DLQ + observability | 1.4.3 + 1.2.5          | ✅                                                  |
| CC-9 covers all four protocols                                             | CC-9                   | ✅                                                  |

---

## 2. ADR compliance trace (each LOCKED decision → implementing tasks)

### ADR-001 (CSV first-class) — LOCKED

| ADR item                                                                           | Plan(s)                              | Status |
| ---------------------------------------------------------------------------------- | ------------------------------------ | ------ |
| Tables `raw_csv_uploads`/`raw_csv_rows`/`csv_mapping_profiles` part of base schema | 1.1.1                                | ✅     |
| `CSVConnector` implements `ChannelConnector` (not side-path)                       | 1.2.3                                | ✅     |
| 3-step Operación wizard is the upload entry point                                  | 1.3.3 + 1.3.4 + 1.3.5                | ✅     |
| Storage payload retention immutable                                                | 1.3.4 + 1.3.6 anti-dupe note + CC-13 | ✅     |
| Versioned mapping profile reprocess                                                | 1.3.6 + migration 0015               | ✅     |

### ADR-002 (4-role column-level matrix) — LOCKED

| ADR item                                                          | Plan(s)                                    | Status |
| ----------------------------------------------------------------- | ------------------------------------------ | ------ |
| 4 roles enum                                                      | 1.1.1 + 1.1.5                              | ✅     |
| Postgres views por rol w/ column grants                           | 1.1.6                                      | ✅     |
| Manager NO ve cliente; Analista NO ve $ ni cliente                | 1.1.6 view projections + 1.2.5 rls.test.ts | ✅     |
| JWT claim `role` propagation via middleware                       | 1.1.5 (hook) + 1.3.2 (middleware)          | ✅     |
| `audit_log` columns verbatim (`user_id`, `role_at_time`, ...)     | 1.1.4 migration 0008                       | ✅     |
| Super Admin CLI seeder email `nicolasperezmontoya@gmail.com`      | 1.1.7                                      | ✅     |
| `security_invoker = true` on every view (RESEARCH says MANDATORY) | 1.1.6 task + verify + CC-12 lint           | ✅     |

### ADR-003 (WhatsApp split) — LOCKED

| ADR item                            | Plan(s)                                                       | Status |
| ----------------------------------- | ------------------------------------------------------------- | ------ |
| F1 does NOT include WA Cloud API    | Out-of-scope §; 1.2.2 WA skeleton throws NOT_IMPLEMENTED_F5.5 | ✅     |
| F1 does NOT include internal form   | Out-of-scope §; 1.2.2 WA skeleton throws NOT_IMPLEMENTED_F3   | ✅     |
| `messaging_log` table created EMPTY | 1.1.4 migration 0007 + verify `select count(*) = 0`           | ✅     |

⚠️ WARNING — **No CC entry verifies that `messaging_log` is never written to during F1 execution.** A future plan could accidentally insert a row. Recommend adding to CC: `select count(*) from messaging_log` returns 0 AFTER all integration tests pass. Low-risk but cheap to add.

### ADR-004 (Mini-CRM stubs) — LOCKED

| ADR item                                                                         | Plan(s)                                           | Status                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------- |
| `customers`, `customer_external_links`, `customer_merge_log` created empty in F1 | 1.1.2 migration 0004                              | ✅ — column shapes verbatim |
| `sales.customer_id` nullable FK from day one                                     | 1.1.3 migration 0005 + verify `is_nullable=YES`   | ✅                          |
| Matching logic deferred to F4                                                    | Out-of-scope § + PATTERNS §5.5 anti-dupe in 1.1.2 | ✅                          |
| `extractCustomerHint?` hook on ChannelConnector                                  | 1.2.1 interface + 1.2.3 CSVConnector basic impl   | ✅                          |

---

## 3. Scope-creep flags

### 3.1 None on locked-deferred items — Strong PASS

- No matching cascade (deferred to F2) — explicitly forbidden in 1.1.2 anti-dupe note + 1.2.3 anti-dupe note ("DO NOT port the Jaccard match logic from `cascade.ts` into `dry-run.ts` projections").
- No real WP/ML/Dropi/POS/WA impls — 1.2.2 skeletons throw NotImplementedError.
- No WA form / WA Cloud API — `messaging_log` empty; WA skeleton throws.
- No "Hoy"/"Productos"/"Canales"/"Inteligencia" views — Wave 3 explicitly ships only "Operación".
- No AI/LLM in F1 — 1.4.1 anti-dupe note explicitly EXCLUDES `ANTHROPIC_API_KEY` and LLM env vars; PATTERNS §5.1 LLM adapter callout respected.
- No Playwright e2e — `.env.example` lint + RESEARCH §9 testing strategy honored.

### 3.2 ⚠️ Channel enum extension in 1.4.2 — borderline

Plan 1.4.2 adds `cron-heartbeat` to the `channel` enum via additive migration 0016. The discovery `types.ts:1` contract is `wordpress | mercadolibre | dropi | pos | pos1 | pos2 | whatsapp | csv-upload | falabella` (PATTERNS §5.4). Adding `cron-heartbeat` mutates the enum's semantic meaning from "real channels" to "channels + cron sentinel". This is **functionally correct** (Postgres enum can grow), but:

- The `scripts/discovery/types.ts` will diverge from the production enum unless 1.2.1 re-export is updated to include `cron-heartbeat`.
- PATTERNS §5.4 says "DO NOT rename `pos1`/`pos2` or split them into a separate `pos_location` enum" — it doesn't forbid extension, but the spirit is "the enum is a stable contract".
- An alternative (RESEARCH §7 implies but doesn't mandate): use a separate `text` column or different table for cron heartbeats so the real-channel enum stays clean.

⚠️ WARNING — Recommend Plan 1.4.2 do ONE of:

1. Use `connector_runs.canal = 'csv-upload'` (existing) with a `canal_label='cron-heartbeat'` ancillary text column.
2. Create a separate `cron_runs` table.
3. If keeping enum extension: update PATTERNS §5.4 + `scripts/discovery/types.ts` re-export contract to include `cron-heartbeat`, and document why the "real channels only" rule is being relaxed.

Not blocking; current approach works at the DB level. But the planner skipped the architectural call.

### 3.3 No other scope creep detected

- Plans 1.1.5/1.1.6 only ship Auth Hook + RLS + role views (no UI for role management — defer is implicit, OK).
- Plan 1.4.4 includes `DEPLOY.md` runbook and `scripts/smoke.sh` — both are reasonable infra deliverables for F1 closure.
- Plan 1.3.1 mentions placeholder nav for `/hoy`, `/productos`, etc. — those are NOT real pages, just sidebar links. OK.

---

## 4. Coverage gaps

### 4.1 FND requirement coverage — PASS (8/8)

| Req    | Covering plan(s)                                              | Status |
| ------ | ------------------------------------------------------------- | ------ |
| FND-01 | 1.0.1, 1.0.2, 1.0.3, 1.3.1, 1.4.1, 1.4.4                      | ✅     |
| FND-02 | 1.1.1, 1.1.2, 1.1.3, 1.1.4, 1.1.7                             | ✅     |
| FND-03 | 1.1.5, 1.1.6, 1.1.7, 1.2.5, 1.3.2                             | ✅     |
| FND-04 | 1.2.1, 1.2.2, 1.4.1, 1.4.2                                    | ✅     |
| FND-05 | 1.2.3, 1.2.5                                                  | ✅     |
| FND-06 | 1.3.3, 1.3.4, 1.3.5                                           | ✅     |
| FND-07 | 1.3.6                                                         | ✅     |
| FND-08 | 1.1.3, 1.1.4, 1.2.4, 1.2.5, 1.3.4, 1.3.5, 1.3.6, 1.4.2, 1.4.3 | ✅     |

### 4.2 Success criterion coverage — PASS (5/5)

All 5 SCs traced in §"Goal-backward verification" of the plan and verified independently above.

### 4.3 ⚠️ Open Question — Dimension 11 borderline

RESEARCH.md `## Open Questions` is NOT marked `(RESOLVED)`. Each of the four questions has an inline "Recommendation:" which acts as a resolution-by-default, and Plan 1.0.3 honors Q1's recommendation (no `db push` from CI). Plan 1.4.4 honors Q1 (PRs share staging Supabase project). Q2 is deferred to F2; Q3 (`public.profiles`) and Q4 (cookie defaults) are silently implemented.

Strict reading: this fails Dimension 11 (no `(RESOLVED)` suffix). Pragmatic reading: all questions are decisively resolved in prose.

⚠️ WARNING — Recommend the planner re-title the section to `## Open Questions (RESOLVED)` with each item explicitly suffixed `**Decision (RESOLVED):**` rather than `**Recommendation:**`. 5-minute fix.

### 4.4 No missing PROJECT.md requirement

Checked PROJECT.md / REQUIREMENTS.md — all FND-\* requirements mapped, no other Phase 1 requirements exist.

---

## 5. Wave-dependency analysis

### 5.1 Plan numbering inconsistency — **BLOCKER**

The plan body defines Wave 2 plans as `1.2.1` through `1.2.5`. However, multiple references claim Wave 2 contains `1.2.1..1.2.9`:

| Reference location             | What it says                                                                                                                                                | Actual                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Mermaid graph line 17          | `W2[Wave 2: Connectors<br/>1.2.1 → ║ 1.2.2..1.2.7 ║ → 1.2.8 → 1.2.9]`                                                                                       | Only 1.2.1–1.2.5 exist                                                                              |
| Wave table line 33             | `1.2.1 (interface) → 1.2.2..1.2.7 (6 skeletons + CSVConnector real) parallel after interface → 1.2.8 (helpers) → 1.2.9 (tests)`                             | Helpers are in 1.2.4 (not 1.2.8); tests in 1.2.5 (not 1.2.9); skeletons in 1.2.2 (not 1.2.2..1.2.7) |
| Cross-wave parallelism line 39 | "Plan 1.2.7 is gated on Wave 1 completing migration 0003 + 0008"                                                                                            | Plan 1.2.7 does not exist; the actual CSVConnector plan is 1.2.3                                    |
| Wave 2 intro line 167          | "1.2.2..1.2.7 (6 skeletons + CSVConnector real impl run in parallel). 1.2.7 (CSVConnector real impl) additionally depends on Wave 1 migrations 0003 + 0008" | Mismatched                                                                                          |
| Wave 4 intro line 388          | "W4 cannot start until W1 (migrations) + W2.1 (interface) are done"                                                                                         | Should reference 1.2.1; ambiguous notation                                                          |

**Impact:** An executor reading the dependency graph cannot reliably tell which plan ID is "the CSVConnector real impl that's gated on migration 0003+0008": it's `1.2.3` in the body but `1.2.7` in three other places. Same for tests (`1.2.5` vs `1.2.9`) and helpers (`1.2.4` vs `1.2.8`). This will silently break parallel execution decisions in `/gsd-execute-phase`.

🔴 **BLOCKER fix required:**

- Either renumber Wave 2 plans to 1.2.1, 1.2.2 (skeletons), 1.2.3 (CSVConnector real), 1.2.4 (helpers), 1.2.5 (tests) — **and update the mermaid + wave table + parallelism narrative to match** — or
- Renumber to 1.2.1, 1.2.2–1.2.7 (one per skeleton + CSVConnector), 1.2.8 (helpers), 1.2.9 (tests) — but the body currently fuses the 6 skeletons into a single plan 1.2.2 ("This plan can be parallelized across the 6 skeleton files"). If a single plan = single executor commit, then 1.2.2 is fine and the wave-table is wrong.

Recommended fix: keep 1.2.1–1.2.5 (current body), update all cross-references.

### 5.2 ⚠️ Wave 3 vs Wave 2 parallelism

Wave-table line 32 says Wave 1 depends_on Wave 0; Wave 2 depends_on Wave 1 (migrations 0003 + 0008); Wave 3 depends_on Wave 1 + Wave 2; Wave 4 depends_on Wave 1 + Wave 2.

User-prompt directive #1: "Wave 2 (connectors) blocks Wave 3 (dashboard) since wizard depends on CSVConnector being callable."

✅ This is honored. Plan 1.3.4 explicitly `depends on 1.2.3 (CSVConnector + auto-detect), 1.2.4 (audit helper), Wave 1 migrations 0003 + 0008`. Plan 1.3.5 depends on 1.3.4 + 1.2.3 + 1.2.4. Plan 1.3.6 depends on 1.3.5 + Wave 1.

User-prompt directive #1 also says: "Wave 4 (orchestrator) can parallel with 2/3 in places."

⚠️ WARNING — Plan 1.4.4 says `Depends on: 1.4.1, 1.4.2, 1.3.x (dashboard built)`. The "1.3.x (dashboard built)" dependency forces Wave 4's terminal plan to wait for ALL of Wave 3. This is more conservative than necessary — Plan 1.4.4 is the smoke test, and the dashboard URL is only needed for the smoke step. The Dockerfile + railway.toml could ship without waiting for Wave 3. This isn't wrong (it just serializes more than needed), but the wave-table claim "W4 can parallel with W2/W3 in places" is only partly true. Minor.

### 5.3 ⚠️ Plan 1.3.1 layout vs 1.3.2 middleware ordering

Plan 1.3.1 creates `app/layout.tsx` with sidebar + topbar showing "user email + avatar". Reading the user email implies `getUser()` which requires the Supabase server client, which is created in 1.3.1 (`lib/supabase/server.ts`). But the middleware that gates `/operacion` is in 1.3.2 — a user without the middleware will still be able to render the dashboard layout. Plan 1.3.1 verifies "Visit `/operacion` while logged in as admin" — but 1.3.2 hasn't shipped yet at that point.

This is **resolvable at execution time**: 1.3.1's layout reads `user` from a server-side Supabase call (which returns null if no session); the sidebar shows nothing or "Iniciar sesión"; the route is publicly accessible until middleware lands. 1.3.1 verify command says "boots; curl /api/health returns ok" — does NOT require logged-in flow. So **the plan as written works** but the verify step for 1.3.1 could mislead an executor.

⚠️ WARNING — Plan 1.3.1's verify "sidebar layout renders the 5 nav items with 'Operación' highlighted" is achievable without auth. The misleading bit is that Plan 1.3.3's verify references the user being "logged in as admin" — this requires 1.3.2 to have shipped. Plan 1.3.3 properly lists `Depends on: 1.3.1, 1.3.2`, so the dependency graph is correct; just the layout-reads-user concern is silent.

### 5.4 Other dependencies — PASS

- 1.1.1 → 1.1.2 → 1.1.3 → 1.1.4: ✅ FK chain order respected.
- 1.1.5 (Auth Hook) doesn't depend on FACTS — only on having a `user_role` enum (1.1.1) and the ability to create `public.profiles`. Plan 1.1.5 implicitly depends on 1.1.1 (enum) but not on 1.1.2/1.1.3/1.1.4. The plan body says `Plans 1.1.5/1.1.6/1.1.7 layer atop after 1.1.4` — overly conservative but harmless.
- 1.2.4 helpers depend on Wave 1 migrations 0005 + 0008: ✅ correctly stated.
- 1.4.1 registry depends on Wave 2 (1.2.1, 1.2.2, 1.2.3): ✅.
- 1.4.2 cron + enum migration 0016 — see §3.2 for enum extension concern; otherwise dependency is correct.

---

## 6. Other dimension checks

### Dimension 5 — Scope sanity

| Plan                              | Tasks                               | Files                                                                                       | Verdict                                               |
| --------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Avg per plan                      | 1 task each (compound but cohesive) | varies                                                                                      | ✅                                                    |
| Largest: 1.3.1 dashboard scaffold | 1 compound task, ~25 files          | ⚠️ borderline (>15 files) but unavoidable for Next.js scaffold + UI primitives. Acceptable. |
| 1.1.4 (3 migrations in 1 plan)    | 3 migrations bundled                | 3 files                                                                                     | ✅ — bundling minor migrations by layer is reasonable |
| 1.1.6 (3 migrations in 1 plan)    | 3 migrations bundled                | 3 files                                                                                     | ✅ — same family (RLS+views+grants)                   |

**Total effort: 88h.** RESEARCH band 76–96h, +15% buffer = 87–110h. Plan claims "84h (within 76–96h range)" at line 37 but the actual sum is 88h (3+2+3+4+3+2+3+3+4+3+4+3+5+3+3+5+5+4+5+5+5+4+2+3+3). Discrepancy of 4h is rounding; the user's 76–110h target band is met.

⚠️ Minor cosmetic warning: PLAN.md line 37 says total 84h, actual sum is 88h. Update the line.

### Dimension 6 — must_haves derivation

The plan does not use a YAML frontmatter `must_haves:` field but instead encodes the equivalent in three places: (a) the cross-cutting verification table CC-1..CC-13 (truths), (b) per-plan **Files** lists (artifacts), (c) per-plan **Verifies** sections (which connect artifacts to truths). The format works but the gsd-plan-checker expects structured frontmatter. Since this plan is single-file (not split into per-plan files), the frontmatter convention doesn't strictly apply.

✅ Pass on substance: every CC-\* entry is user-observable, every artifact maps to a verifiable command, and key_links between artifacts (e.g., `Chat.tsx → /api/chat`) are explicit in plans 1.3.4/1.3.5 wire-ups.

### Dimension 7 — Context compliance

CONTEXT.md (loaded above) defines LOCKED decisions, Claude's Discretion, and Deferred Ideas. All four locked ADRs are honored verbatim (see §2). All deferred items (magic link, edge functions, e2e Playwright, real connector impls, matching cascade, Mini-CRM logic, WA Cloud API, IA jobs, dashboard views beyond Operación) are absent from the plan, with explicit out-of-scope acknowledgment at lines 473–489. Stack choices (pnpm 11.1.1, Supabase CLI, TypeScript strict, no Prisma, no Bun, no JS) all respected.

✅ PASS.

### Dimension 7b — Scope reduction detection

Scanned every `<action>`/Task block for "v1", "simplified", "static for now", "future enhancement", "placeholder", "stub", etc.

Findings:

1. 1.2.3 says `dry-run.ts` projected.\* fields are "placeholder zeros (F2 wires real cascade calls)" — ✅ legitimate scope handoff per PATTERNS §3.C and the matching cascade being F2.
2. 1.4.2 says cron schedule is "`*/30 * * * *` placeholder" — ✅ legitimate, F1 just needs cron service to exist + exit cleanly.
3. 1.1.7 says WhatsApp products row is "placeholder ... `is_active=false`" — ✅ matches FND-04 Falabella-disabled spirit.
4. Various out-of-scope notes describe what's "deferred to F2/F3/F4/F5/F5.5/F6" — these are NOT scope reductions of F1 decisions; they're explicit deferrals already in CONTEXT.md Deferred Ideas.

**No actual scope reduction detected.** Every CONTEXT.md decision is delivered in full. Plans neither water down ADR-001 (CSV first-class) into "metadata-only" nor reduce ADR-002 (4-role column-level) to "3-role row-only". ✅ PASS.

### Dimension 7c — Architectural tier compliance

Cross-checked against RESEARCH.md `## Architectural Responsibility Map`:

| Capability                            | Map says                                      | Plan assigns to                                        | Match |
| ------------------------------------- | --------------------------------------------- | ------------------------------------------------------ | ----- |
| Schema migrations                     | DB / CI                                       | 1.1.\* migrations + 1.0.3 CI                           | ✅    |
| Role-based isolation                  | DB (views+RLS) / API (JWT)                    | 1.1.6 views + 1.1.5 hook + 1.3.2 middleware            | ✅    |
| JWT custom claim                      | DB Postgres fn                                | 1.1.5 `custom_access_token_hook`                       | ✅    |
| Auth session middleware               | Frontend Server (Next.js)                     | 1.3.2 `apps/dashboard/middleware.ts`                   | ✅    |
| CSV upload (multipart→Storage)        | Frontend Server                               | 1.3.4 Server Action                                    | ✅    |
| CSV parse + persist `raw_csv_rows`    | Frontend Server                               | 1.3.5 `commitUpload` Server Action                     | ✅    |
| `ChannelConnector` interface          | API / Backend (orchestrator) + Shared package | 1.2.1 (`packages/connectors`) + 1.4.1 instantiates     | ✅    |
| `CSVConnector`                        | Shared / Frontend Server                      | 1.2.3 in `packages/connectors`, callable from 1.3.5    | ✅    |
| Cron skeleton                         | API / Backend (Railway Cron)                  | 1.4.2 + 1.4.4 railway.toml `orchestrator-cron` service | ✅    |
| `connector_runs` + `audit_log` writes | DB + helpers                                  | 1.2.4 helpers + 1.1.4 tables                           | ✅    |
| Idempotency                           | DB unique + UPSERT                            | 1.1.3 constraint + 1.2.4 helper                        | ✅    |
| Retry + DLQ                           | API + DB table                                | 1.2.4 `p-retry` + 1.1.4 `dead_letter_queue`            | ✅    |
| Secrets                               | Infra (Railway/Vercel env)                    | 1.4.4 + CC-5 + CC-11                                   | ✅    |

✅ PASS.

### Dimension 9 — Cross-plan data contracts

Two shared data pipelines:

1. CSV bytes (Storage) flow through `commitUpload` (1.3.5) → `raw_csv_rows` → `ingestUpload` (1.2.3) → `sales`/`master_products`.
2. `csv_mapping_profiles.column_map_json` consumed by both `applyColumnMap` in 1.2.3 (`column-map.ts`) and `commitUpload` parse step in 1.3.5.

**Conflict potential** (see SC2 WARNING in §1 above): The mapping profile is read in both places; if 1.3.5 trims/normalizes a field that 1.2.3 expects raw, downstream Zod parse will fail silently. Plan 1.3.5 anti-dupe note acknowledges this: "DO NOT … this plan only handles the first-time commit path. … 1.3.6 handles reprocess." But the row-shape handoff between 1.3.5 (writes `raw_csv_rows.payload_json`) and 1.2.3 (reads `raw_csv_rows`, applies column_map) is not specified explicitly.

⚠️ WARNING — Plan 1.2.3 and 1.3.5 should declare the contract: `raw_csv_rows.payload_json` is the **raw CSV row** (Record<string,string>) and column_map application happens in `ingestUpload` only. Otherwise duplicate work or missed transforms. See also §1 SC2 warning.

### Dimension 10 — CLAUDE.md compliance

RESEARCH.md §"Project Constraints" line 1709 explicitly states "No `CLAUDE.md` exists in the repo root at the time of research." Verified — `/home/mandark/faka/CLAUDE.md` does not exist. SKIPPED.

### Dimension 11 — Research resolution

See §4.3 — Open Questions section lacks `(RESOLVED)` suffix but all four questions have inline recommendations that act as resolutions. ⚠️ WARNING.

### Dimension 12 — Pattern compliance

Every plan task references PATTERNS.md sections explicitly (e.g., `PATTERNS §3.B`, `§5.4`, `§5.6`, `§5.7`, `§5.9`). Sampled:

- 1.1.1 cites PATTERNS §3.B (table inventory), §5.4 (channel enum), §5.3 (column-map shape). ✅
- 1.2.1 cites PATTERNS §5.2 (CanonicalProduct elevate), §5.6 (normalize.ts port), §5.8 (NormalizedOrder superset). ✅
- 1.3.3 cites PATTERNS §5.7 (wizard labels verbatim). ✅
- Every plan has an explicit `Anti-duplication note:` enforcing PATTERNS rules. ✅
- The four PATTERNS anti-duplication callouts the user listed (LLM adapter, CanonicalProduct, normalize.ts, Jaccard) are all addressed: 1.4.1 anti-dupe (LLM adapter not in F1), 1.2.1 anti-dupe (CanonicalProduct elevate move not copy), 1.2.1 anti-dupe (normalize.ts port verbatim), 1.2.3 anti-dupe (Jaccard NOT ported into dry-run.ts). ✅

✅ PASS.

---

## 7. Specific user checks (from prompt)

| Check                                                                                        | Status                                              | Notes                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Wave dependencies correct (W0→W1, W1→W2/3/4, W2→W3)                                       | ✅ in dependency lists; ❌ in narrative numbering   | BLOCKER §5.1 — narrative numbering inconsistency                                                                                                    |
| 2. Every plan task has a verification check                                                  | ✅                                                  | Every plan has `Verifies:` line with concrete commands                                                                                              |
| 3. Anti-duplication notes from PATTERNS.md                                                   | ✅                                                  | All four called out: LLM (1.4.1), CanonicalProduct (1.2.1), normalize.ts (1.2.1), Jaccard (1.2.3)                                                   |
| 4. Effort estimates total 76–110h                                                            | ✅ 88h (plan claims 84h, actual sum 88h — cosmetic) | Within band                                                                                                                                         |
| 5. All 8 FND requirements mapped                                                             | ✅                                                  | See §4.1                                                                                                                                            |
| 6. CSV architecture matches RESEARCH §6 (Server Actions, not orchestrator)                   | ✅                                                  | 1.3.4 + 1.3.5 use Server Actions; 1.4.1 anti-dupe explicitly forbids `/ingest/csv-upload` orchestrator endpoint                                     |
| 7. `security_invoker = true` mentioned in role-views task                                    | ✅                                                  | 1.1.6 task body + anti-dupe + verify command + CC-12 lint — multiple layers                                                                         |
| 8. CI workflow covers `supabase db reset` on every PR                                        | ✅                                                  | 1.0.3 `db-integration` job runs `supabase db reset` per push + PR                                                                                   |
| 9. Seeders cover both mapping profiles AND Super Admin (email nicolasperezmontoya@gmail.com) | ✅                                                  | 1.1.7 seed.sql for profiles + `seed-super-admin.ts` with exact email                                                                                |
| 10. `apps/orchestrator` Railway deploy with healthcheck; cron is separate Railway service    | ✅                                                  | 1.4.1 `/health` + 1.4.4 `railway.toml` declares `orchestrator-web` (healthcheck `/health`) + `orchestrator-cron` (separate service per RESEARCH §7) |

---

## 8. Issues summary

### BLOCKERS (must fix before execution)

```yaml
issue:
  id: B1
  dimension: dependency_correctness + task_completeness
  severity: blocker
  description: |
    Wave 2 plan-numbering inconsistency. Mermaid graph (line 17), wave table (line 33),
    cross-wave parallelism narrative (line 39), Wave 2 intro (line 167), and Wave 4 intro
    (line 388) reference plans 1.2.6, 1.2.7, 1.2.8, 1.2.9 that do not exist. Body defines
    only 1.2.1-1.2.5. Cross-references say "CSVConnector real impl 1.2.7" but actual is 1.2.3.
  affected_locations:
    - line 17 (mermaid)
    - line 33 (wave table row)
    - line 39 (parallelism narrative)
    - line 167 (Wave 2 intro)
    - line 388 (Wave 4 intro)
  fix_hint: |
    Choose ONE convention and update all 5 references:
    Option A (recommended): Keep body as 1.2.1-1.2.5. Update mermaid + table + narrative
    to say "1.2.1 → ║ 1.2.2 (skeletons) ║ 1.2.3 (CSVConnector) ║ → 1.2.4 (helpers) → 1.2.5 (tests)".
    Option B: Split 1.2.2 (6 skeletons) into 1.2.2-1.2.7 (one per channel), then renumber
    1.2.3→1.2.8 helpers, 1.2.4→1.2.9 tests. Higher executor cost, no clear benefit.
```

### WARNINGS (should fix; execution may proceed)

```yaml
issues:
  - id: W1
    dimension: cross_plan_data_contracts
    severity: warning
    description: |
      Duplicated column-map application between 1.2.3 ingestUpload and 1.3.5 commitUpload.
      Both load mapping profile and apply column_map; row-shape contract for raw_csv_rows.payload_json
      is not explicit. Risk: double Zod parse or missed transform.
    fix_hint: |
      In 1.2.3 + 1.3.5 anti-dupe notes, declare explicitly that raw_csv_rows.payload_json
      is the RAW row (Record<string,string>) and column_map application happens ONLY in
      ingestUpload. Update 1.3.5 commitUpload step 4 ("Validate each row against mapping
      profile") to "Persist raw row as-is; deferred validation runs in ingestUpload".

  - id: W2
    dimension: scope_reduction (false positive — but worth a note)
    severity: warning
    description: |
      Plan 1.4.2 extends the `channel` enum to include 'cron-heartbeat' (migration 0016).
      The discovery types.ts contract (PATTERNS §5.4) defines the channel enum as
      real-channels-only; adding a sentinel value mutates the contract without updating
      the re-export in scripts/discovery.
    fix_hint: |
      Either:
      (a) use a separate canal_label TEXT column on connector_runs and keep the enum clean;
      (b) update 1.2.1 + scripts/discovery/types.ts re-export to include 'cron-heartbeat'
          and document the relaxed convention in PATTERNS §5.4.

  - id: W3
    dimension: verification_derivation
    severity: warning
    description: |
      No CC entry verifies that messaging_log is never written to during F1.
      A future task could accidentally insert; ADR-003 requires it to stay empty.
    fix_hint: |
      Add CC-14: after full integration test suite, `select count(*) from messaging_log` = 0.

  - id: W4
    dimension: dependency_correctness
    severity: warning
    description: |
      1.4.4 depends_on includes "1.3.x (dashboard built)" — overly conservative. Smoke test
      needs the dashboard URL but Dockerfile + railway.toml don't. The wave-table claim
      "W4 can parallel with W2/W3 in places" is only partly delivered.
    fix_hint: |
      Split 1.4.4 into 1.4.4a (Dockerfile + railway.toml + vercel.json + DEPLOY.md;
      depends_on: 1.4.1, 1.4.2) and 1.4.4b (smoke test; depends_on: 1.4.4a + 1.3.6).
      Allows infra config to ship in parallel with Wave 3.

  - id: W5
    dimension: task_completeness
    severity: warning
    description: |
      1.3.1 layout reads user email in topbar, but middleware (1.3.2) hasn't shipped.
      Verify step says "sidebar layout renders the 5 nav items" — achievable but layout
      will silently render with null user until 1.3.2.
    fix_hint: |
      Add to 1.3.1 verify: "Visiting `/` (root) when not logged in does NOT crash;
      topbar shows 'Iniciar sesión' link (until 1.3.2 ships middleware redirect)."

  - id: W6
    dimension: research_resolution
    severity: warning
    description: |
      RESEARCH.md ## Open Questions section is not marked (RESOLVED); each item has an
      inline "Recommendation:" not "Decision (RESOLVED):". Strict Dimension 11 fail.
    fix_hint: |
      Re-title to `## Open Questions (RESOLVED)`. Change each `**Recommendation:**`
      preamble to `**Decision (RESOLVED):**`. 5-minute fix.

  - id: W7
    dimension: cosmetic
    severity: warning
    description: |
      PLAN.md line 37 claims total 84h; actual sum of Effort fields is 88h.
    fix_hint: Update line 37 to "Total: **88h** (within 76–96h range)."

  - id: W8
    dimension: cosmetic
    severity: warning
    description: |
      Migration numbering jumps 0008 → 0011 (skips 0009/0010). Plan does not note why.
    fix_hint: |
      Either renumber migrations 0011-0014 to 0009-0012 (sequential), OR add a note in
      1.1.5 that migration numbers are timestamp-based so gaps are expected. Current
      timestamp format `20260513000011` is fine; the trailing sequence is what jumps.
```

---

## 9. Verdict

**REVISE** — fix BLOCKER B1 (Wave 2 numbering), then re-submit. Plan can move to execution once the 5 narrative references in §5.1 are reconciled to the actual plan body. WARNINGs W1–W8 are non-blocking but worth a single revision pass to avoid drift during execution.

**Why not BLOCK:** The substance of the plan is correct. Every locked ADR is implemented faithfully. Every success criterion is traceable. The scope is honest (no creep, no reduction). The architecture (Server Actions for CSV ingestion, Hono orchestrator with no `/ingest/csv-upload`, SECURITY INVOKER views with the mandatory flag, profiles table feeding the JWT hook) matches RESEARCH §3/§4/§6/§7 verbatim. The 88h effort fits the 76–110h target band. The pattern reuse from `scripts/discovery/` is respected (CanonicalProduct elevated, normalize.ts ported, Jaccard NOT ported, LLM adapter deferred to F5).

**Why not PASS:** The plan-numbering inconsistency in Wave 2 is exactly the kind of issue that, if left unaddressed, will cause an executor to pick the wrong dependency edge and either (a) block waiting for a plan that doesn't exist, or (b) start a downstream plan before its actual upstream finishes. The cost of clarifying the numbering is 10 minutes; the cost of debugging mis-parallelized execution is hours. Per the prompt directive "Lean toward REVISE rather than PASS if anything material is uncertain" — and dependency numbering for parallel execution IS material — REVISE is the right call.

**On re-submission:** Plan-checker will rapidly re-verify the Wave 2 references (Bash grep) and the WARNINGs that the planner chose to address. If only B1 is fixed and W1–W8 are left, the verdict will flip to PASS (warnings do not block execution).
