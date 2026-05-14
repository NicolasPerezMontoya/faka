# Phase 2 — Plan-Check Report

**Checked:** 2026-05-14
**Plan file:** `.planning/phases/2-walking-skeleton-wp/PLAN.md` (25 plans · 6 waves · 84h)
**Reviewer mode:** goal-backward, adversarial

---

## VERDICT: **PASS** (with 7 warnings — none blocking execution)

The plan covers all 4 ROADMAP success criteria and all 6 WP-NN requirements with explicit, named plans. All seven LOCKED invariants (W1, W2, W5, CC-11, CC-12, CC-13, CC-14) are encoded as plan-level grep gates or test assertions. The demo path is CSV-driven and does NOT depend on client WordPress credentials. There is exactly ONE LLM adapter (`@faka/llm` extracted in 2.0.1; cascade level 5 wraps it). No circular dependencies. No CC-11 violations. Effort is bounded (≤6h/plan).

Seven warnings below describe quality / process concerns that should be addressed during execution but do not block kick-off.

---

## 1. Goal-backward verification

### ROADMAP Success Criteria → Plans

| SC | ROADMAP claim | Plans that produce it | Verification |
|----|---------------|-----------------------|--------------|
| **SC1** | WP orders flow into `sales` + `sale_items` with ≤15 min latency via REST + WC webhooks + 1h scheduled pull | **2.2.1** (REST client + webhook verify/dedupe + degraded mode) · **2.3.1** (webhook route: HMAC verify + dedupe + raw_orders insert + ACK fast) · **2.3.2** (async cron drains `raw_orders WHERE processed=false`, normalizes, UPSERTs, runs cascade) · **2.3.3** (hourly `sync-wp-orders` + `sync-wp-products` REST pulls) · **2.5.3** (webhook integration test) · **2.5.4** (`wp-latency-smoke.ts` end-to-end timer) | F2-CC-10, F2-CC-14, F2-CC-15 |
| **SC2** | Historical WP backfilled via `CSVConnector` and visible alongside live data | **2.0.3** (WP orders CSV mapping profile seeded) · **2.4.5** (10-row `wp-orders-sample.csv` fixture + wizard callout, reuses F1's `commitUpload`) | F2-CC-16; W1 invariant grep gate on `applyColumnMap` (F2-CC-3) |
| **SC3** | 5-level cascade (barcode → supplier_code → normalized_name → embeddings → LLM arbiter); items below threshold land in validation queue; humans flip `validado_humano=true` | **2.0.1** (`@faka/llm` extraction) · **2.1.1** (`product_embeddings` table + HNSW) · **2.2.2** (levels 1-3 + thresholds + `normalize_name` function/column) · **2.2.3** (level 4 embeddings + re-embed service) · **2.2.4** (level 5 LLM arbiter + token cap) · **2.2.5** (`runMatchCascade` + `persistMatch`) · **2.3.2** (cascade triggered post-ingest) · **2.3.4** (`re-cascade-unmatched` cron for stuck items) · **2.4.1** (queue list) · **2.4.2** (side-by-side detail + keyboard shortcuts) · **2.4.3** (validate/reject/bulk Server Actions + role gate excluding Analista) · **2.5.2** (cascade integration test — 12 cases) · **2.5.3** (validation test — `validado_humano=true` flip + audit_log + analista 403) | F2-CC-11, F2-CC-12, F2-CC-17 |
| **SC4** | "Hoy" view: totals + per-channel chart + top 10 + last-hour realtime feed; refreshed within 15-min budget | **2.1.2** (4 `v_hoy_*` views + `v_hoy_per_channel_analista` variant) · **2.4.4** (`/hoy` page with 4 panels + role-aware $ redaction) · **2.4.5** (Realtime live-feed Client Component) · **2.5.3** (`hoy/views.integration.test.ts` — 7 tests including timezone) | F2-CC-7, F2-CC-13, F2-CC-15 |

### Requirements → Plans

| Req | Description | Plans | Status |
|-----|-------------|-------|--------|
| **WP-01** | WP `ChannelConnector` live (REST + webhooks; 1h pull) | 2.0.2, 2.0.4, 2.2.1, 2.3.1, 2.3.3 | COVERED (degraded mode when creds absent) |
| **WP-02** | WP historical backfill via `CSVConnector` | 2.0.3, 2.4.5 | COVERED |
| **WP-03** | 5-level matching cascade end-to-end + queue routing | 2.0.1, 2.1.1, 2.2.2, 2.2.3, 2.2.4, 2.2.5, 2.3.2, 2.3.4 | COVERED |
| **WP-04** | Validation queue UI + `validado_humano=true` flip | 2.4.1, 2.4.2, 2.4.3, 2.5.3 | COVERED |
| **WP-05** | "Hoy" view MVP slice (totals + per-canal + top 10 + last-hour) | 2.1.2, 2.4.4, 2.4.5, 2.5.3 | COVERED |
| **WP-06** | ≤15 min day-sales latency end-to-end | 2.3.1, 2.3.2, 2.4.5, 2.5.4 | COVERED (live verification requires WP creds; CSV path validated regardless) |

**Coverage: 6/6 WP-NN requirements + 4/4 ROADMAP success criteria.**

---

## 2. Blocker findings

**None.** All hard gates from the assignment brief are satisfied:

- ✅ No plan depends on client WordPress credentials being delivered. WP-01 ships with degraded mode (`healthCheck → { ok: false, last_error: 'not configured' }`, `fetchOrders → []`, webhook route → 503). The demo path is CSV-driven (WP-02..WP-06 ship complete without WP REST creds).
- ✅ Exactly ONE LLM adapter. Plan 2.0.1 lifts `scripts/discovery/llm-arbiter.ts` into `@faka/llm` and turns the discovery script into a shim re-exporting from the package. Plan 2.2.4's anti-duplication note explicitly forbids `@ai-sdk/*` imports in cascade level 5. F2-CC-17 grep gate enforces this.
- ✅ `applyColumnMap` stays inside CSVConnector. WP normalizers (`normalize-order.ts`, `normalize-product.ts` in 2.2.1) map WC JSON directly. Anti-duplication note + W1 grep gate `grep -c 'applyColumnMap' packages/connectors/src/wordpress/*.ts == 0`. F2-CC-3 enforces it at phase boundary.
- ✅ Role check + auditLog where required. Plan 2.4.3 (validate/reject/bulk) calls `requireRole(supabase, ['super_admin','admin','manager'])` (excluding Analista) AND `auditLog` per action; bulk writes N audit rows (one per mapping) per RESEARCH §Security.
- ✅ `pnpm db:types` regeneration after migrations. Plan 2.1.3 regenerates `database.ts` after the two Wave 1 migrations and adds a CI gate `git diff --exit-code packages/db/types/database.ts`. (See WARNING-1 about additive migrations in later waves.)
- ✅ No `NEXT_PUBLIC_*SECRET/SERVICE/PRIVATE` vars. Plan 2.0.2 extends the F1 eslint regex to also reject `WORDPRESS|OPENAI|MOONSHOT|ANTHROPIC` patterns. Plan 2.4.5 (`live-feed.tsx`) uses anon key only. F2-CC-6 enforces.
- ✅ Every new view declares `with (security_invoker = true)`. Plan 2.1.2 includes a `grep -c 'create view' == grep -c 'security_invoker = true'` equality lint. F2-CC-7 enforces.
- ✅ No circular dependencies. W0 → W1/W2; W1 → W2/W3/W4; W2 → W3/W4; W3 → W5; W4 → W5. Within Wave 2: 2.2.5 strictly depends on 2.2.2 + 2.2.3 + 2.2.4 (cascade orchestrator integrates the levels). Mermaid diagram is acyclic.
- ✅ Atomicity is acceptable. 25 plans across 84h ⇒ ~3.4h/plan median. Largest plans: 2.2.1 (6h, 9 files — WP connector full impl), 2.4.4 (5h, 5 files — Hoy page with 4 sub-components). Both are inside the F1 PLAN's 6h-per-plan ceiling.
- ✅ Every plan has explicit `Effort:` and `Requirements:` fields. Verified by scanning all 25 plans.

---

## 3. Warning findings (non-blocking but should be addressed during execution)

### WARNING-1: Additive migrations in Waves 2/3/4 are not bundled with a types-regen task

**Plans affected:** 2.2.1 (`20260601000003_raw_events_dedup_index.sql` *"if needed"*), 2.2.2 (`...0004_master_products_nombre_normalizado.sql`), 2.2.4 (`...0005_connector_runs_metadata.sql` *"if not present"*), 2.2.5 (`...0006_product_mappings_metadata.sql` *"optionally"*), 2.3.1 (`...0007_raw_orders_processed_flag.sql` *"if needed"*), 2.3.2 (`...0008_sale_items_unique.sql` *"if not present"*), 2.4.2 (`...0009_product_mappings_rationale.sql` *"if not present"*).

**Issue:** Plan 2.1.3 regenerates `database.ts` only for migrations 14 + 15 (Wave 1). Plans 2.2.x / 2.3.x / 2.4.x that may add migrations 16-19 do not include a `pnpm --filter @faka/db run types && git diff --exit-code` step in their `Verifies:` section. Notes for executors §3 acknowledges the contiguous numbering but does not assign types-regen ownership for late-wave additive migrations. The strict CI types-committed gate will hard-fail on any of those late-wave commits unless the executor remembers manually.

**Fix:** Add an explicit verify-step to every plan that lists a migration file in `Files:` — `pnpm --filter @faka/db run types && git diff --exit-code packages/db/types/database.ts` exits 0 after migration applies. Best done by appending one sentence to each affected plan's `Verifies:` block during execution.

### WARNING-2: Multiple "optional" migrations claim the same number range without pre-verification

**Plans affected:** Same as WARNING-1. Numbers 16-19 are claimed by up to seven different plans on a first-come basis ("if not present").

**Issue:** When parallel-running Wave 2 plans (2.2.1 ║ 2.2.2 ║ 2.2.3 ║ 2.2.4) each say "optionally add migration NNNN if the constraint/column doesn't exist", two plans could race to claim migration 16. The plan-level instruction is to verify F1 schema before adding, but that verification step is informal.

**Fix:** Either (a) consolidate all "additive if missing" migrations into a single new plan (e.g., 2.1.4 — Additive schema patches) that runs serially after 2.1.3, OR (b) explicitly reserve migration numbers in PLAN.md so each Wave 2/3/4 plan gets a deterministic slot, OR (c) confirm via a one-shot inspection of F1 migrations 0001-0013 before Wave 2 starts which `if needed` clauses can be safely dropped.

### WARNING-3: Plan 2.0.3 contains a self-revision artifact

**Plan affected:** 2.0.3.

**Issue:** The `Task:` description starts by saying "Scaffold `packages/connectors/src/wordpress/` AND `packages/connectors/src/matching/` directories with empty placeholder files" and then mid-paragraph reverses itself: *"Revision: don't pre-create empty files for matching/wordpress that 2.2.X will overwrite — instead, just confirm the directories don't exist yet, and the plan's 'new files' list is the source of truth for which files to create. **This plan does only the WP CSV mapping profile extension below.**"*

**Fix:** During execution kick-off, rewrite 2.0.3 so the `Task:` block describes only the WP orders CSV profile insert (the actual scope). The scaffold-vs-not-scaffold debate should be removed. The intent is clear from the final sentence, but a fresh executor reading the plan top-to-bottom will be confused.

### WARNING-4: Plan 2.2.2 mixes connector code with a schema migration

**Plan affected:** 2.2.2.

**Issue:** Wave 2 is labelled "Connectors" but plan 2.2.2 includes a new SQL migration (`20260601000004_master_products_nombre_normalizado.sql`) that adds `unaccent` extension, `normalize_name(text)` function, generated column, and index. This breaks the wave model that promises W1 = schema, W2 = connectors. It also means `database.ts` types should regenerate after Wave 2 (compounding WARNING-1).

**Fix:** Move the `normalize_name` migration into Wave 1 (e.g., promote to Plan 2.1.2b or fold into 2.1.1). Then Plan 2.2.2 reduces to "TS code only" and Wave 2 stays connector-only.

### WARNING-5: Cost projection for embeddings + LLM arbiter is qualitative only

**Plans affected:** 2.2.3, 2.2.4 (embeddings + arbiter), 2.3.4 (reembed cron).

**Issue:** RESEARCH §Pitfall 7 cites $45/mo arbiter cost at 500 orders/day × 3 items × $0.001. The plan inherits the cost-runaway mitigations (sticky `validado_humano`, source_hash short-circuit, `LLM_DAILY_TOKEN_CAP=200000`, `<embeddingsMid` → skip arbiter) but never produces a concrete monthly projection or a dashboard/alert surface to monitor actual spend. `TokenBudgetTracker` in 2.2.4 aggregates `connector_runs.metadata_json->>'llm_tokens'` but no plan creates a UI to show daily spend.

**Fix:** Either (a) add a small task to 2.4.4 ("Hoy" page or a new "Inteligencia" tab) showing a daily token-burn chart from `connector_runs`, OR (b) document acceptable monthly cost ceiling in `DEPLOY.md` with the env-var levers (LLM_DAILY_TOKEN_CAP, MATCH_EMBED_HIGH, MATCH_EMBED_MID) so the operator has a runbook. Deferable to F5 (AI layer) where cost surfaces naturally.

### WARNING-6: Hoy `/hoy` `v_hoy_totals` role-redaction is inconsistent with `v_hoy_per_channel`

**Plan affected:** 2.4.4.

**Issue:** Plan 2.4.4 introduces two patterns for analista $ redaction:
- For `v_hoy_per_channel`: a SQL view variant `v_hoy_per_channel_analista` (with `null::numeric as ingresos`) is queried conditionally.
- For `v_hoy_totals`: NO view variant; the page applies `if (role === 'analista') totalsRow.ingresos_hoy = null;` in TS code.

This dual mechanism makes the column-redaction contract ambiguous. If a future contributor adds a new card on `/hoy` they won't know which pattern to follow, and a code-level redaction is easier to forget than a DB-level grant.

**Fix:** Pick one. Either (a) add `v_hoy_totals_analista` view variant in plan 2.1.2 (preferred — DB-level redaction matches ADR-002 spirit), OR (b) document the rationale for the split and add a server-side helper `redactForRole(row, role)` so the pattern is explicit at every callsite.

### WARNING-7: Plan 2.5.4 bundles three artifacts in 1h

**Plan affected:** 2.5.4.

**Issue:** Plan 2.5.4 covers three distinct artifacts in a single 1h estimate: `scripts/smoke-f2.sh` (bash extending F1 smoke), `scripts/wp-latency-smoke.ts` (Node script with HMAC signing + polling + multi-step latency assertion), and DEPLOY.md + ROADMAP.md updates. A latency-smoke that signs payloads, polls Supabase, and visits a dashboard URL is closer to 2-3h of careful work. Under-estimating this risks rushing the very script that proves WP-06.

**Fix:** Split 2.5.4 into 2.5.4a (smoke + DEPLOY/ROADMAP, 1h) and 2.5.4b (`wp-latency-smoke.ts` with full HMAC + polling + assertions, 2h). Or simply re-estimate to 3h.

---

## 4. Coverage summary

| Requirement | Covered? | By plans |
|-------------|----------|----------|
| WP-01 | YES | 2.0.2, 2.0.4, 2.2.1, 2.3.1, 2.3.3 |
| WP-02 | YES | 2.0.3, 2.4.5 |
| WP-03 | YES | 2.0.1, 2.1.1, 2.2.2, 2.2.3, 2.2.4, 2.2.5, 2.3.2, 2.3.4 |
| WP-04 | YES | 2.4.1, 2.4.2, 2.4.3, 2.5.3 |
| WP-05 | YES | 2.1.2, 2.4.4, 2.4.5, 2.5.3 |
| WP-06 | YES | 2.3.1, 2.3.2, 2.4.5, 2.5.4 (live verification needs WP creds; CSV path proves the pipeline end-to-end regardless) |

**No WP-NN requirement is unmapped.**

### Invariant gates (verified present in PLAN.md)

| Invariant | Check | Where enforced |
|-----------|-------|----------------|
| **W1** | `applyColumnMap` is CSV-only | 2.2.1 anti-duplication note + grep gate; F2-CC-3 phase-boundary check |
| **W2** | `cron-heartbeat` stays out of channel enum | 2.3.2/2.3.3/2.3.4 anti-duplication notes + grep gates; F2-CC-4 phase-boundary check |
| **W5** | Pages read `x-user-role` header, never `getUser()` | 2.4.1/2.4.2/2.4.4 anti-duplication notes; F2-CC-5 phase-boundary check |
| **CC-11** | No `NEXT_PUBLIC_*SECRET/SERVICE/PRIVATE/WORDPRESS/OPENAI/...` | 2.0.2 eslint regex extension + 2.4.5 grep gate; F2-CC-6 phase-boundary check |
| **CC-12** | Every new view declares `security_invoker = true` | 2.1.2 count-equality lint; F2-CC-7 phase-boundary check |
| **CC-13** | Storage payloads immutable | F2-CC-8 phase-boundary check (relies on F1 invariant; no F2 plan overwrites Storage objects) |
| **CC-14** | `messaging_log` stays empty in F2 | 2.3.1 webhook test (g) + 2.5.3 webhook test 8 + F2-CC-9 phase-boundary check |

All seven invariants have at least one grep gate, lint, or integration test.

---

## 5. Recommendation

**Verdict: PASS. Ready for execution.**

The plan is ready to kick off Wave 0 today. None of the seven warnings block initial execution — they are quality/process refinements that can be applied during the wave they affect:

- **Address before Wave 1 starts:** WARNING-3 (rewrite 2.0.3 task block to remove the self-revision artifact), WARNING-4 (move `normalize_name` migration into Wave 1 — small refactor that simplifies Wave 2).
- **Address before Wave 2 starts:** WARNING-1 + WARNING-2 (decide the migration-number reservation strategy; ideally consolidate "if not present" migrations into a single Wave 1 patch plan).
- **Address before Wave 4 starts:** WARNING-6 (decide $ redaction pattern for v_hoy_totals — either add the analista view variant or document the helper).
- **Address before Wave 5 starts:** WARNING-7 (re-estimate 2.5.4 or split it).
- **Defer to F5 (AI layer):** WARNING-5 (cost projection + monitoring UI; natural home is the Inteligencia view).

The plan demonstrates strong goal-backward discipline: every ROADMAP success criterion maps to specific plans, and the cross-cutting verification table (F2-CC-1 through F2-CC-17) provides a phase-gate harness. The credential-reality framing (WP-01 degraded; WP-02..WP-06 via CSV) directly addresses the brief's "demo path MUST be CSV-driven" requirement. The single-LLM-adapter mandate is enforced by lifting `scripts/discovery/llm-arbiter.ts` into `@faka/llm` (2.0.1) with a grep gate (F2-CC-17). All locked ADRs (001, 002, 003, 004) are honored — ADR-004's `extractCustomerHint` is exposed by the WP connector for future F4 consumption but is not wired anywhere in F2.

**Next action:** Execute Wave 0 (2.0.1 → 2.0.2 → 2.0.3 → 2.0.4, serial, ~10h). Apply WARNING-3 fix inline while editing 2.0.3.

---

**End of PLAN-CHECK.md**
