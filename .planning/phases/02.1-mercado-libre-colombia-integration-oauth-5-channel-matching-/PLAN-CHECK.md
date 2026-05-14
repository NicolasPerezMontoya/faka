# Phase 2.1 — Plan-Check Report

**Checked:** 2026-05-15
**Plan file:** `.planning/phases/02.1-mercado-libre-colombia-integration-oauth-5-channel-matching-/PLAN.md` (22 plans · 6 waves · self-reported 70h / measured 74h)
**Reviewer mode:** goal-backward, adversarial

---

## VERDICT: **PASS** (with 7 warnings — none blocking execution)

The plan covers all six ML-NN requirements (ML-01 through ML-06) and all seven sub-requirements from RESEARCH §Phase Requirements (ML-OAUTH-01/02, ML-WEBHOOK-01, ML-ORDERS-01, ML-ITEMS-01, ML-STATE-01, ML-DEGRADED-01) with explicit, named plans. The credential-reality framing is honored throughout: degraded mode is wired into config.ts (2.1.2.3), index.ts (2.1.2.4), webhook route (2.1.3.1), all three crons (2.1.1.4 / 2.1.3.2 / 2.1.3.3), connect page (2.1.3.4), and an explicit smoke path (2.1.4.4). The F2 Wave 2 cascade dependency is called out with a `**BLOCKED ON F2 WAVE 2**` tag on Plan 2.1.3.2, an external-dependency node in the Mermaid graph, a wave-3 callout, and Notes #3. The OAuth refresh-token race condition is mitigated with a `pg_try_advisory_xact_lock` wrapper in `oauth.ts` (2.1.1.2) and a Promise.all race regression test in `mercadolibre-oauth.test.ts` (2.1.4.2). All ten declared invariants (W1, W2, CC-11, CC-12, CC-13, CC-14, F2-CASCADE-REUSE, F2-LLM-ADAPTER, HMAC-PATTERN-DIVERGENCE, F2.1-NEW Single MCO/seller) have at least one grep gate, test, or anti-duplication note enforcing them.

Seven warnings below describe quality / process concerns that should be addressed during execution but do not block kick-off.

---

## 1. Goal-backward verification

### CONTEXT.md "In Scope" → Plans

| Capability                                                                                                                                                                  | Plans that produce it                                                                                                                              | Verification                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **ML connector implementing LOCKED ChannelConnector interface from F1**                                                                                                     | 2.1.2.4 (full rewrite of `mercadolibre/index.ts`, replaces all `NOT_IMPLEMENTED_F4` throws)                                                         | grep gate: `NOT_IMPLEMENTED` returns 0      |
| **OAuth flow (app registration, code-exchange, refresh rotation, Postgres storage)**                                                                                        | 2.1.1.1 (`oauth_tokens` migration + service-role RLS), 2.1.1.2 (`oauth.ts` exchange/refresh + advisory lock), 2.1.3.4 (callback route + `oauth_state`) | unit test 2.1.4.2 (7 cases incl. rotation + race), RLS test 2.1.4.3 |
| **Orders sync every 15 min via REST `/orders/search` + idempotent UPSERT on `(canal, external_order_id)`**                                                                  | 2.1.2.1 (api-client `paginateOrders` + `from_id`), 2.1.2.4 (`fetchOrders` + `normalizeOrder`), 2.1.3.2 (15-min cron + cascade integration)        | grep gate: `onConflict.*canal.*external_order_id` ≥1 in 2.1.3.2 |
| **Products sync every 1 hour with attribute/variant extraction → `master_products` candidate flow**                                                                         | 2.1.2.1 (`paginateItems` + `scroll_id`), 2.1.2.2 (`variant-mapper.ts` + additive unique constraint), 2.1.2.4 (`fetchProducts`), 2.1.3.3 (60-min cron) | unit test 2.1.4.1 (hash stability + catalog-mode skip) |
| **5-level cascade integration WITHOUT duplicating F2 cascade work**                                                                                                         | 2.1.3.2 (calls `runMatchCascade` + `persistMatch` from `@faka/connectors/matching`). External blocker: F2 Wave 2 plans 2.2.2-2.2.5 must land.    | F2-CASCADE-REUSE grep gate (zero `matchByX` imports inside `packages/connectors/src/mercadolibre/`) |
| **Webhook receiver with signed-query-params verify + Hono `/webhooks/mercadolibre`**                                                                                        | 2.1.3.1 (`webhook-verify.ts` + route + `raw_events` dedup migration)                                                                              | integration test 2.1.4.3 (8 cases including tampered sig + duplicate `sent` dedup + CC-14 messages-drop) |
| **Cron heartbeat + `connector_runs` rows per pull/webhook**                                                                                                                 | 2.1.1.4 (refresh cron), 2.1.3.2 (orders cron), 2.1.3.3 (products cron) — all write `kind:"channel", canal:"mercadolibre"`                          | grep gate `cron-heartbeat` returns 0 in every ML cron file (W2 invariant) |
| **Dashboard "Hoy" + "Matching" already exist — ML rows appear via channel-agnostic F2 views**                                                                               | (No new plan — confirmed in Out-of-scope §) Only 2.1.3.4 adds the small `/operacion/conectar-mercadolibre` connect route.                          | CC-12 grep gate (no `v_ml_*` views) |
| **Operational env vars orchestrator-only (`ML_CLIENT_ID/SECRET/REDIRECT_URI/WEBHOOK_SECRET`)**                                                                              | 2.1.0.2 (env-var contract + `.env.example` × 3 + `railway.toml`), 2.1.0.3 (CC-11 eslint regex extension), 2.1.2.3 (`config.ts` validates four-var contract) | CC-11 lint regex test + grep gate (`NEXT_PUBLIC_ML_*` zero in dashboard/) |

### Requirements → Plans

| Req           | Description                                              | Plans                                                          | Status     |
| ------------- | -------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| **ML-01**     | Orders sync every 15 min + idempotent UPSERT             | 2.1.1.3, 2.1.2.1, 2.1.2.4, 2.1.3.2, 2.1.3.3, 2.1.4.1, 2.1.4.4 | COVERED   |
| **ML-02**     | Items sync + variants → product_variants                 | 2.1.2.1, 2.1.2.2, 2.1.2.4, 2.1.3.3, 2.1.4.1, 2.1.4.4          | COVERED   |
| **ML-03**     | Cascade integration WITHOUT re-impl                      | 2.1.3.2 (calls `runMatchCascade`)                              | COVERED — external blocker on F2 Wave 2 |
| **ML-04**     | OAuth code-exchange + rotation + advisory lock           | 2.1.0.2, 2.1.0.3, 2.1.1.1, 2.1.1.2, 2.1.1.4, 2.1.3.4, 2.1.4.2, 2.1.4.3, 2.1.5.1 | COVERED   |
| **ML-05**     | Webhook receiver + signed-query-params + idempotency     | 2.1.3.1, 2.1.4.3                                              | COVERED   |
| **ML-06**     | Degraded mode when env vars unset                        | 2.1.0.2, 2.1.2.3, 2.1.2.4, 2.1.3.1, 2.1.3.2, 2.1.3.3, 2.1.3.4, 2.1.4.4, 2.1.5.1 | COVERED   |

Sub-requirements from RESEARCH §Phase Requirements (ML-OAUTH-01/02, ML-WEBHOOK-01, ML-ORDERS-01, ML-ITEMS-01, ML-STATE-01, ML-DEGRADED-01) all appear in plan `Requirements:` fields. **No ML-NN requirement is unmapped.**

---

## 2. Blocker findings

**None.** All twelve hard gates from the assignment brief are satisfied:

- ✅ **Goal coverage** — every ML-01..ML-06 requirement maps to at least one plan; all seven sub-requirements (ML-OAUTH-01/02, ML-WEBHOOK-01, ML-ORDERS-01, ML-ITEMS-01, ML-STATE-01, ML-DEGRADED-01) appear in plan `Requirements:` fields.
- ✅ **Cascade dependency declared** — Plan 2.1.3.2 carries the explicit `**BLOCKED ON F2 WAVE 2**` tag in its header; the Mermaid graph shows `F2W2[F2 Wave 2 cascade<br/>EXTERNAL DEPENDENCY] --> W3`; Notes #3 documents the unblock conditions (wait for F2 W2 OR extract cascade into a standalone PR). Anti-duplication note explicitly forbids stubbing.
- ✅ **Degraded-mode coverage** — `loadMLConfig` (2.1.2.3) returns `{ok:false, missing}` when any of four vars unset; `healthCheck` (2.1.2.4) returns `ok:false`; webhook (2.1.3.1) returns 503; crons (2.1.1.4, 2.1.3.2, 2.1.3.3) exit 0 with `errors_json:{reason:"not_configured"}`; smoke (2.1.4.4) explicitly exercises the degraded path. Each Verifies block has runnable assertions (grep `process.exit(0) ≥2`, `curl 503`, etc.).
- ✅ **No duplicated work with F2** — `mercadolibre/index.ts` MUST NOT import from `@faka/connectors/matching` (grep gate in 2.1.2.4); cascade is called from the cron layer only (2.1.3.2); `@ai-sdk/*` direct imports forbidden phase-wide (F2-LLM-ADAPTER grep gate); WP's `webhook-verify.ts` NOT imported from ML's verifier (HMAC-PATTERN-DIVERGENCE grep gate); `applyColumnMap` stays CSV-only (W1 invariant grep gate). All five invariants have explicit anti-duplication notes and grep gates in the touching plans.
- ✅ **OAuth race condition mitigated** — Plan 2.1.1.2 mandates `pg_try_advisory_xact_lock(hashtext('ml-refresh-' || userId))` around the body of `refreshToken` + grep gate `≥1` match; Plan 2.1.4.2 case #7 is the `Promise.all([refreshToken(), refreshToken()])` regression that proves the lock works — with a grep gate on `advisory_lock` ≥1 in the test file. Anti-duplication note in 2.1.4.2 explicitly forbids mocking the production lock acquisition to always succeed.
- ✅ **Wave ordering valid** — Mermaid graph is acyclic: W0 → W1, W0 → W2, W1 → W2, W1 → W3, W2 → W3, W2 → W4, W3 → W4, W4 → W5. Within W3, plans 2.1.3.3 + 2.1.3.4 are parallelizable behind 2.1.3.1 (webhook route mounts first); 2.1.3.2 (cascade-blocked) is independently runnable when F2 W2 unblocks.
- ✅ **Anti-duplication notes present** — 22/22 plans include an Anti-duplication note (verified via grep `Anti-duplication note` count = 22).
- ✅ **Effort estimate within range** — 70h self-reported, 74h measured (see WARNING-1 below for the discrepancy). RESEARCH §Effort estimate range is 60-80h; both numbers fit. No single wave exceeds 28% of total (W2 = 20h ≈ 27%; W3 = 20h measured ≈ 27%).
- ✅ **No `NEXT_PUBLIC_ML_*` env vars anywhere** — every mention in PLAN.md is in a forbidden / grep-zero / anti-pattern context (8 of 8 occurrences validated); Plan 2.1.0.3 extends the F2 eslint regex to reject `NEXT_PUBLIC_ML_CLIENT`/`ML_REDIRECT`/`ML_WEBHOOK`/`MERCADOLIBRE`; Plan 2.1.0.2 adds the dashboard `.env.example` CC-11 reminder.
- ✅ **Out-of-scope section explicit** — PLAN.md §"Out of scope" lists nine excluded categories: other ML sites (MLA/MLM/MLB), multi-account, ML Shipments/Logistics, ML Messaging/Questions, ML Catalog Products mode, per-variant pricing schema change, dashboard ML-specific pages, shared `webhook-verify.ts` abstraction (deferred to F3), and changes to WP/CSV connectors. Each entry cross-references CONTEXT.md or RESEARCH.md.
- ✅ **Credential reality block** — PLAN header line 11 carries the dedicated "Credential reality:" paragraph stating the cliente has NOT registered the app yet, explicitly enumerating the degraded-mode behaviors per surface (healthCheck, fetchOrders/fetchProducts, webhook 503, callback 503, three crons exit 0, dashboard connect-page pill), and confirming "no code redeploy" on first credential delivery.
- ✅ **Verifies blocks runnable** — every plan's Verifies section ends in concrete commands (`grep -c`, `pnpm exec tsc --noEmit`, `pnpm filter test`, `psql -c`, `curl -i`, `pnpm exec next build`). Sampled all 22 plans — none have prose-only verifies; the 2.1.4.4 smoke explicitly emits a pass/fail report block.

---

## 3. Warning findings (non-blocking but should be addressed during execution)

### WARNING-1: Self-reported plan count (19) and Wave 3 / total effort numbers contradict the file contents

**Plans affected:** PLAN.md lines 8, 41, 533, 539; Plan 2.1.5.2 Task body + Verifies (`grep -c '19 plans' .planning/ROADMAP.md returns 1`).

**Issue:** PLAN.md self-reports "19 plans across 6 waves" in four places (header line 8 implicitly via "the 19 plans" callouts in Notes #15 and Revision log; plan 2.1.5.2 explicitly tells the executor to write `**Plans:** 19 plans` into ROADMAP.md). The actual count is **22 plans**: W0 has 4 (2.1.0.1..4), W1 has 4 (2.1.1.1..4), W2 has 4 (2.1.2.1..4), W3 has 4 (2.1.3.1..4), W4 has 4 (2.1.4.1..4), W5 has 2 (2.1.5.1..2) — total 22. The Wave-subtotal table at line 41 also reports W3 = 16h, but the four W3 plan efforts are 5h + 5h + 4h + 6h = 20h. The "Total: 70h" claim therefore under-counts by 4h; the corrected total is 74h. RESEARCH §Effort still says 60-80h so the actual 74h is in-range — only the bookkeeping is wrong.

Plan 2.1.5.2's Verifies block (`grep -c '19 plans' .planning/ROADMAP.md returns 1`) will hard-fail the executor unless the count is corrected before that plan runs.

**Fix:** During Wave 0 kick-off, sweep PLAN.md for "19 plans" / "Total: 70h" / "W3 ~16h" and correct to "22 plans" / "Total: 74h" / "W3 ~20h" respectively. Adjust Plan 2.1.5.2's Task body and Verifies grep gate to expect 22. The Wave 3 hours line at line 41 should also be corrected. This is purely arithmetic — no scope change.

### WARNING-2: Notes #4 says "F2.1 adds three new migrations" but the plan actually adds four

**Plans affected:** Notes for executors §4 (line 511); cross-impacts Plan 2.1.5.2 (memoria stub references migration list) and Plan 2.1.5.1 (DEPLOY.md F2.1 section may copy the wrong count).

**Issue:** PLAN.md Notes #4 reads "F2.1 adds three new migrations: `20260615000001_oauth_tokens.sql`, `20260615000002_product_variants_unique.sql`, `20260615000003_raw_events_dedup.sql`, `20260615000004_oauth_state.sql`." — the prose says "three" but the list has four. The fourth migration is real and is created in Plan 2.1.3.4 (the CSRF state table that the OAuth callback writes nonce rows into).

**Fix:** Correct Notes #4 to "F2.1 adds four new migrations". Verify Plan 2.1.5.1 and 2.1.5.2 reference all four in their derived artifacts (DEPLOY.md migration list + memoria F2.1-PROGRESO.md schema-changes section).

### WARNING-3: Wave 2 / Wave 3 plans add migrations but rely on Plan 2.1.3.1 for one of the regens — split-ownership risk

**Plans affected:** 2.1.2.2 (creates `20260615000002_product_variants_unique.sql` + regens `database.ts`), 2.1.3.1 (creates `20260615000003_raw_events_dedup.sql` + regens `database.ts`), 2.1.3.4 (creates `20260615000004_oauth_state.sql` + regens `database.ts`).

**Issue:** Three different waves write `database.ts` in atomic commits with their respective migrations. This pattern is correct (matches F2 Plan 2.1.3's regen-with-migration discipline). However, the F1 CI rule (`git diff --exit-code packages/db/src/database.ts` after running types codegen) hard-fails on any commit where the migration applies but `database.ts` was not regenerated. The plans correctly call out the regen step in `Files:` (e.g., "packages/db/src/database.ts (regenerate)"), but the **Verifies** section of these plans does NOT include `pnpm --filter @faka/db run types && git diff --exit-code packages/db/src/database.ts`. The CI gate will catch the regression at PR time, but the in-plan verify is silent on it.

This is identical to F2 PLAN-CHECK.md WARNING-1 — same pattern, same fix.

**Fix:** Append to the Verifies section of 2.1.2.2, 2.1.3.1, 2.1.3.4: `pnpm --filter @faka/db run types && git diff --exit-code packages/db/src/database.ts` exits 0. This catches forgotten regens locally before CI does.

### WARNING-4: Wave 2 / Wave 3 plans claim wave-parallelism that the wave-table contradicts

**Plans affected:** Wave 2 (table line 40) says "2.1.2.1 ║ 2.1.2.2 ║ 2.1.2.3 → 2.1.2.4"; Wave 3 (table line 41) says "2.1.3.1 → 2.1.3.2 ║ 2.1.3.3 ║ 2.1.3.4".

**Issue:** Plan 2.1.2.2's `Depends on:` line says "2.1.1.1 (regenerated database.ts is the baseline for the new migration), 2.1.1.2 (types)" — i.e., it depends on Wave 1 plans, not on 2.1.2.1 or 2.1.2.3. That's correct; 2.1.2.1/2/3 share no files and are truly parallel-after-W1. However, Plan 2.1.2.2's migration `20260615000002_product_variants_unique.sql` (number 0002) AND Plan 2.1.3.1's migration `20260615000003_raw_events_dedup.sql` (number 0003) — there is no migration `20260615000002` claimed by anyone else, so the number reservation is implicit-but-clean. Wave 3's parallel triad (2.1.3.2 ║ 2.1.3.3 ║ 2.1.3.4) similarly: 2.1.3.4 owns migration 0004, 2.1.3.1 owns migration 0003, no overlap. The risk is one of *executor confusion*: a parallel-running executor on 2.1.3.4 might accidentally write `database.ts` while 2.1.3.1's commit on the same file is mid-flight.

**Fix:** Add an explicit note in the wave-3 callout (line 47) that 2.1.3.2 / 2.1.3.3 / 2.1.3.4 are file-disjoint EXCEPT for `database.ts` and `apps/orchestrator/src/server.ts` — those two files are touched by both 2.1.3.1 and 2.1.3.4 (server.ts mount; database.ts regen). Recommend serial commits for those two, even if the rest of the work runs parallel.

### WARNING-5: Open Decisions in RESEARCH.md don't use the `(RESOLVED)` convention — divergence from gsd convention

**File affected:** `.planning/phases/02.1-mercado-libre-colombia-integration-oauth-5-channel-matching-/RESEARCH.md` §"Open Decisions (planner must commit)".

**Issue:** The standard plan-checker dimension 11 expects a `## Open Questions (RESOLVED)` section header on RESEARCH.md to confirm the planner closed each open item. F2.1's RESEARCH.md instead has `## Open Decisions (planner must commit)` with five numbered items, each labelled `Recommend: X`. The planner DID adopt all five recommendations explicitly:
1. Catalog Products vs Items mode → items-mode v1 (declared in Out-of-scope + 2.1.2.2 catalog skip);
2. Single ML user vs multi-account → single user v1 (PATTERNS §"Single ML seller account v1" + `limit 1` in 2.1.2.4);
3. OAuth bootstrap UX → dashboard-side route (Plan 2.1.3.4);
4. Shared webhook-verify abstraction → defer to F3 (Out-of-scope + Notes #9);
5. Pagination strategy → `from_id` + `search_type=scan` (Plan 2.1.2.1).

Every decision is honored in the plan, but the convention divergence means a reflexive plan-checker run looking for `## Open Questions (RESOLVED)` will miss the resolution.

**Fix:** Cosmetic — either (a) rename the section to `## Open Decisions (RESOLVED)` and annotate each item with `RESOLVED: <choice>` inline, OR (b) leave as-is and document in PLAN.md Revision log that the format diverges intentionally. Recommend (a) for forward consistency with F3+ research files.

### WARNING-6: ROADMAP.md F2.1 entry currently has 0 plans / TBD requirements — Plan 2.1.5.2 fixes this AT THE END, not at the START

**File affected:** `.planning/ROADMAP.md` lines 69-77.

**Issue:** ROADMAP.md still reads `**Goal:** [Urgent work - to be planned]`, `**Requirements**: TBD`, `**Plans:** 0 plans`, `- [ ] TBD (run /gsd-plan-phase 02.1 to break down)`. Plan 2.1.5.2 is the one that fixes these placeholders, but it runs LAST. For ~3 weeks (the plan-execution window), any teammate or automation reading ROADMAP.md will see stale placeholders despite PLAN.md being complete. F2's analogous plan (2.5.x docs/deploy) updates ROADMAP at the end too — but F2's ROADMAP entry was already populated with requirements WP-01..WP-06 from the start, so the placeholder problem didn't arise.

**Fix:** Either (a) split out a tiny "Wave 0.5" plan that updates ROADMAP.md Phase 2.1 placeholders to the real Goal/Requirements/Plans counts on day 1, OR (b) accept the staleness and run Plan 2.1.5.2 as an OPTIONAL Wave 5 pre-commit step. Recommend (a) — it's 15 minutes of work and prevents a fortnight of confusion.

### WARNING-7: Plan 2.1.3.4 server-action authorize URL — port + scheme assumptions not declared

**Plan affected:** 2.1.3.4 (`/operacion/conectar-mercadolibre` connect page + server action).

**Issue:** The server action `start-oauth.ts` builds `https://auth.mercadolibre.com.co/authorization?...&redirect_uri=${encodeURIComponent(ML_REDIRECT_URI)}` and the Verifies block grep-checks for `auth.mercadolibre.com.co`. ML's docs note that the authorize host is **per-site** (`auth.mercadolibre.com.co` for MCO, `auth.mercadolibre.com.ar` for MLA, etc.). For MCO-only v1 the hardcode is correct (CONTEXT.md "Out of scope: Other ML sites"), but the value lives inline in the server action's URL string with no const reference back to `ML_SITE_ID` or a site-keyed map. If a future maintainer adds MLA support, they must remember to update three different locations (api-client `site_id=MCO`, types.ts `ML_SITE_ID = "MCO"`, AND the dashboard server action's `.co` host). The first two are caught by the `ML_SITE_ID` constant; the dashboard server action's host string is the loose end.

**Fix:** Either (a) move the per-site authorize host into `packages/connectors/src/mercadolibre/types.ts` as `export const ML_AUTHORIZE_HOST = "https://auth.mercadolibre.com.co"` and import it server-side from the dashboard server action, OR (b) add an inline `// SITE-LOCK: matches ML_SITE_ID=MCO; update both if multi-site support is added` comment. The grep-gate in Verifies should look for the constant import, not the raw `auth.mercadolibre.com.co` literal.

---

## 4. Per-criterion verdict table

| #  | Criterion (from prompt)                                                                                          | Status                                            | Notes |
| -- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----- |
| 1  | Goal coverage — every ML-01..ML-06 maps to ≥1 plan                                                               | PASS                                              | All 6 ML-NN + 7 sub-requirements covered; no orphan. |
| 2  | Cascade dependency declared with clear unblock condition                                                         | PASS                                              | Plan 2.1.3.2 carries `**BLOCKED ON F2 WAVE 2**` tag; Mermaid graph + Notes #3 spell out unblock paths (wait OR extract to standalone PR; do NOT stub). |
| 3  | Degraded-mode coverage in code AND verifies                                                                      | PASS                                              | 9 plans wire degraded mode; Verifies use runnable assertions (`grep process.exit(0) ≥2`, `curl 503`, etc.). |
| 4  | No re-implementation of F1/F2 LOCKED primitives                                                                  | PASS                                              | Five distinct anti-duplication invariants enforced via grep gates: cascade, LLM adapter, HMAC verifier, applyColumnMap, audit/requireRole. |
| 5  | OAuth race-condition mitigated (advisory lock + regression test)                                                 | PASS                                              | 2.1.1.2 mandates `pg_try_advisory_xact_lock` + verify; 2.1.4.2 case #7 is the Promise.all race regression with grep gate on `advisory_lock`. |
| 6  | Wave ordering valid (no cycles; W2/W3 parallelism reasonable)                                                    | PASS                                              | DAG acyclic; W3 has clean cascade-block isolation (2.1.3.2 only is gated). See WARNING-4 for a soft serial-commit recommendation on shared files. |
| 7  | Anti-duplication notes present on every plan                                                                     | PASS                                              | 22/22 plans have an Anti-duplication block. |
| 8  | Effort within RESEARCH 60-80h; no wave swallows the rest                                                         | PASS                                              | Measured 74h; largest wave 20h (27%). See WARNING-1 — bookkeeping shows 70h, not 74h. |
| 9  | No `NEXT_PUBLIC_ML_*` env vars anywhere (CC-11)                                                                  | PASS                                              | All 8 mentions are in forbidden/anti-pattern context; eslint regex extended in 2.1.0.3; dashboard grep gates in 2.1.3.4. |
| 10 | Out-of-scope section explicit                                                                                    | PASS                                              | 9 categories enumerated with cross-references to CONTEXT.md / RESEARCH.md. |
| 11 | Credential reality block in PLAN header                                                                          | PASS                                              | Line 11 has a dedicated paragraph stating the cliente has NOT registered the app + full degraded-mode behavior matrix + "no code redeploy" once envs land. |
| 12 | Verifies blocks runnable (grep / curl / SQL / `pnpm exec tsc`)                                                   | PASS                                              | All 22 plans end Verifies with concrete commands; smoke (2.1.4.4) emits a pass/fail report block. |

---

## 5. Coverage summary

| Requirement (ROADMAP / CONTEXT) | Covered? | By plans                                                                       |
| ------------------------------- | -------- | ------------------------------------------------------------------------------ |
| ML-01 (orders sync)             | YES      | 2.1.1.3, 2.1.2.1, 2.1.2.4, 2.1.3.2, 2.1.3.3, 2.1.4.1, 2.1.4.4                  |
| ML-02 (items sync)              | YES      | 2.1.2.1, 2.1.2.2, 2.1.2.4, 2.1.3.3, 2.1.4.1, 2.1.4.4                           |
| ML-03 (cascade integration)     | YES      | 2.1.3.2 (external blocker on F2 W2)                                            |
| ML-04 (OAuth lifecycle)         | YES      | 2.1.0.2, 2.1.0.3, 2.1.1.1, 2.1.1.2, 2.1.1.4, 2.1.3.4, 2.1.4.2, 2.1.4.3, 2.1.5.1 |
| ML-05 (webhook)                 | YES      | 2.1.3.1, 2.1.4.3                                                               |
| ML-06 (degraded mode)           | YES      | 2.1.0.2, 2.1.2.3, 2.1.2.4, 2.1.3.1, 2.1.3.2, 2.1.3.3, 2.1.3.4, 2.1.4.4, 2.1.5.1 |

**Sub-requirements from RESEARCH §Phase Requirements:** ML-OAUTH-01 (2.1.1.2, 2.1.4.2) · ML-OAUTH-02 (2.1.1.1, 2.1.4.3) · ML-WEBHOOK-01 (2.1.3.1, 2.1.4.3) · ML-ORDERS-01 (2.1.2.1, 2.1.3.2) · ML-ITEMS-01 (2.1.2.1, 2.1.2.2, 2.1.4.1) · ML-STATE-01 (2.1.1.3, 2.1.4.1) · ML-DEGRADED-01 (2.1.2.3). All covered.

**No ML-NN requirement is unmapped.**

### Invariant gates (verified present in PLAN.md)

| Invariant                       | Check                                                                                     | Where enforced                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **W1**                          | `applyColumnMap` is CSV-only                                                              | 2.1.1.3 / 2.1.2.4 anti-duplication notes + grep gates                                     |
| **W2**                          | All ML crons write `kind:"channel", canal:"mercadolibre"`; never `cron-heartbeat`         | 2.1.1.4 / 2.1.3.2 / 2.1.3.3 anti-duplication notes + grep gates                            |
| **CC-11**                       | No `NEXT_PUBLIC_ML_*` / `NEXT_PUBLIC_MERCADOLIBRE_*`                                      | 2.1.0.3 eslint regex extension + 2.1.0.2 dashboard `.env.example` reminder + 2.1.2.3 grep gate + 2.1.3.4 server-action grep gate |
| **CC-12**                       | F2.1 adds ZERO new views                                                                  | Out-of-scope + 2.1.1.1 anti-duplication (no `v_oauth_tokens_*`) + 2.1.3.4 anti-duplication (no `v_ml_*`) |
| **CC-13**                       | `raw_orders.payload_json` + `raw_events.payload_json` append-only                          | 2.1.3.1 + 2.1.3.2 anti-duplication notes                                                 |
| **CC-14**                       | `messaging_log` stays empty in F2.1 — topic `messages` logged + dropped                   | 2.1.3.1 (drop logic) + 2.1.4.3 test #8 (explicit tripwire)                                |
| **F2-CASCADE-REUSE**            | No `matchByX` / cascade fns imported into `packages/connectors/src/mercadolibre/`         | 2.1.2.1 / 2.1.2.4 / 2.1.3.2 anti-duplication notes + grep gates                            |
| **F2-LLM-ADAPTER**              | No direct `@ai-sdk/*` imports                                                             | 2.1.2.1 / 2.1.2.4 / 2.1.3.2 grep gates                                                    |
| **HMAC-PATTERN-DIVERGENCE**     | ML's `webhook-verify.ts` is structurally distinct from WP's; not shared in F2.1           | 2.1.3.1 anti-duplication note + 2.1.4.3 grep gate (no `wordpress/webhook-verify` import) |
| **F2.1-NEW Single MCO + seller**| `ML_SITE_ID="MCO"` const; `oauth_tokens` reads via `limit 1`                              | 2.1.1.2 types.ts const + 2.1.2.4 connector `limit 1`                                      |

All ten invariants have at least one grep gate, lint, or integration test.

---

## 6. Recommendation

**Verdict: PASS. Ready for execution.**

The plan is ready to kick off Wave 0 today. None of the seven warnings block initial execution — they are quality/process refinements that can be applied during or before the wave they affect:

- **Address before Wave 0 starts (15 min total):** WARNING-1 (sweep "19 plans" → "22 plans", "70h" → "74h", "W3 ~16h" → "W3 ~20h"; also fix Plan 2.1.5.2's Verifies grep to expect `'22 plans'`). WARNING-2 (correct Notes #4 to "four new migrations"). WARNING-6 (add a Wave-0.5 ROADMAP placeholder-replacement step OR move 2.1.5.2's ROADMAP edit forward).
- **Address before Wave 2 starts:** WARNING-3 (append `pnpm db:types && git diff --exit-code packages/db/src/database.ts` to the Verifies sections of 2.1.2.2, 2.1.3.1, 2.1.3.4). WARNING-4 (add a serial-commit note for shared files `database.ts` + `server.ts` in the wave-3 callout).
- **Address before Wave 3 starts:** WARNING-7 (extract authorize host into a const importable from `types.ts`; update Plan 2.1.3.4 grep gate to verify the import, not the literal).
- **Cosmetic, defer:** WARNING-5 (rename RESEARCH §Open Decisions to use `(RESOLVED)` convention).

The plan demonstrates strong goal-backward discipline: each ML-NN requirement maps to specific plans; sub-requirements from RESEARCH §Phase Requirements all have dedicated test plans; the credential-reality framing is end-to-end (degraded behavior at every touchpoint, smoke that explicitly exercises the missing-creds path); the cascade-reuse boundary is enforced by grep gates on multiple sides (no cascade imports in connector files; only `runMatchCascade` + `persistMatch` allowed in the cron); the OAuth race condition is mitigated by both a production-code advisory lock AND a dedicated race regression test.

**Plans needing extra eyes during execution:**

- **2.1.3.2 (sync-ml-orders.ts)** — the load-bearing cascade integration. Will hard-fail TypeScript compile until F2 Wave 2 lands `runMatchCascade`. The executor should not work this plan until `pnpm --filter @faka/connectors exec tsc --noEmit` passes against an `import { runMatchCascade } from "@faka/connectors/matching"` line in a scratch file.
- **2.1.1.2 (oauth.ts)** — the single most complex plan in the phase (4h estimate; rotation + lazy refresh + advisory lock + retry). The race regression in 2.1.4.2 is the safety net but production review should re-read the rotation logic line-by-line against PATTERNS §2.
- **2.1.3.4 (connect page + callback)** — spans three layers (dashboard server action, orchestrator route, new migration). The state-CSRF nonce + service-role write path is the security-critical part; manual review recommended.
- **2.1.2.4 (connector index.ts rewrite)** — large file rewrite (7h, replaces the F1 skeleton). The factory shell + helpers hoisting + `healthCheck` never-throws all have to land in one atomic plan. Recommend pair-review on first attempt.

**Dependencies that must close first:**

1. **F2 Wave 2 plans 2.2.2-2.2.5** must land `packages/connectors/src/matching/cascade.ts` exporting `runMatchCascade` + `persistMatch` BEFORE Plan 2.1.3.2 executes. Per recent commit `04697cb`, F2 is paused at Wave 2 pending. F2.1 Wave 0, 1, 2, 4, 5 + Wave 3 plans 2.1.3.1 / 2.1.3.3 / 2.1.3.4 can all proceed without this — only 2.1.3.2 blocks. Net effect: ~85% of F2.1 can run in parallel with F2 Wave 2.
2. **Cliente ML developer-app registration** is NOT a code dependency (degraded mode covers the gap), but is a hard dependency for the smoke run in 2.1.4.4 to exercise the live OAuth + webhook paths. The smoke degrades gracefully (still exercises degraded-mode path) when envs are unset, so this is observable-quality only, not execution-blocking.

**Next action:** Apply WARNING-1 + WARNING-2 + WARNING-6 fixes inline (≤15 min sweep), then execute Wave 0 (2.1.0.1 → 2.1.0.2 → 2.1.0.3 → 2.1.0.4, serial, ~5h). Wave 1 may begin in parallel as soon as 2.1.0.4 lands the fixtures.

---

**End of PLAN-CHECK.md**
