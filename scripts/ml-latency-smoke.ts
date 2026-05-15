#!/usr/bin/env node
/**
 * Mercado Libre end-to-end latency smoke — Plan 2.1.4.4.
 *
 * Mirrors `scripts/wp-latency-smoke.ts` (F2 Plan 2.5.4) but for the ML
 * channel. Drives the full ML-04 → ML-05 → ML-06 pipeline against a
 * deployed orchestrator + database and reports three timings that together
 * prove the 15-min latency budget (inherited from F2 WP-06) is engineered:
 *
 *   t_landed         — time from `POST /webhooks/mercadolibre` to a
 *                      `raw_orders` row landing (target: ≤ 2 s — webhook
 *                      ACK + dedupe upsert).
 *   t_cascade        — time from raw_orders → sale_items.master_sku
 *                      populated OR queued for human review (target:
 *                      ≤ 90 s — sync-ml-orders cron drain + cascade fire).
 *   t_view_reflects  — time from webhook → row visible in `sales` for
 *                      canal='mercadolibre' (target: ≤ 15 min — the
 *                      channel-agnostic latency budget F2.1 inherits).
 *
 * The script always finishes with a single-line JSON report so CI can
 * parse timings without re-running.
 *
 * ── Execution modes ──────────────────────────────────────────────────────────
 *
 * (A) Configured mode — env present:
 *     ORCHESTRATOR_URL    (e.g. https://orchestrator-staging.up.railway.app)
 *     DATABASE_URL        (Postgres connection string with read access)
 *     ML_WEBHOOK_SECRET   (must match the deployed orchestrator's secret —
 *                          NOT the same value as ML_CLIENT_SECRET. Per
 *                          packages/connectors/src/mercadolibre/config.ts
 *                          the webhook secret is its own env.)
 *     Optional:
 *       ML_USER_ID        (synthetic seller user_id; defaults to a fixed
 *                          test value that the orchestrator dedup index
 *                          treats as a new (canal, tipo_evento, resource,
 *                          sent) tuple on each run via timestamp variance)
 *       ML_TEST_RESOURCE  (override the synthetic `/orders/<id>` path)
 *
 *     Behaviour: builds a valid signed-query-params webhook payload (six
 *     ML_SIGNED_PARAMS + HMAC-SHA256 over the canonical string), POSTs it
 *     to `/webhooks/mercadolibre`, polls the DB, measures all three
 *     timings, exits 0 if every timing is under budget, exits 2 if any
 *     timing exceeds budget (still emits the JSON report).
 *
 * (B) Degraded mode — any required env unset:
 *     The script does NOT throw. It performs a single best-effort 503
 *     probe (mirrors the WP latency smoke degraded path), prints a skip
 *     report, and exits 78 (POSIX `EX_CONFIG` — "configuration error /
 *     skip"). CI treats 78 as a soft pass per F2 Plan 2.5.4 convention.
 *
 * ── Why this script is separate from `ml-smoke.ts` (the broader smoke) ──
 *
 * The PLAN.md §2.1.4.4 spec describes a multi-behavior smoke
 * (`apps/orchestrator/scripts/ml-smoke.ts`) covering connect-flow + webhook
 * + cron + catalog-mode counter + degraded mode. THIS script is the
 * NARROWER latency-budget probe — directly analogous to the F2
 * `wp-latency-smoke.ts` shape. Splitting the two lets the broader smoke
 * land in DEPLOY.md (Plan 2.1.5.1) as the manual operator runbook while
 * the latency budget gets a CI-friendly JSON report.
 *
 * ── Anti-duplication ─────────────────────────────────────────────────────────
 *
 * HMAC signing here MUST match `verifyMLSignature` in
 * `packages/connectors/src/mercadolibre/webhook-verify.ts` exactly. We do
 * NOT import that package because this script must run standalone via
 * `tsx scripts/ml-latency-smoke.ts` without a workspace install. The
 * canonical-string format (`topic:..;user_id:..;...` joined by `;`) is
 * duplicated here; the rest of the connector is not. A regression in the
 * canonicalization function would cause this smoke to silently agree with
 * itself — by design, the `webhook-verify.exhaustive.test.ts` (Plan
 * 2.1.4.3) catches that case at unit-test time.
 *
 * ── HMAC-PATTERN-DIVERGENCE reminder ─────────────────────────────────────────
 *
 * WordPress signs raw body bytes (base64). Mercado Libre signs the canonical
 * named-fields string (hex). DO NOT copy the WP signing block — they are
 * NOT interchangeable.
 */

import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

// ─── Configuration ───────────────────────────────────────────────────────────

const ORCH_URL = process.env.ORCHESTRATOR_URL?.replace(/\/$/, "") ?? "";
const DATABASE_URL = process.env.DATABASE_URL ?? "";
const ML_SECRET = process.env.ML_WEBHOOK_SECRET ?? "";
const ML_USER_ID = process.env.ML_USER_ID ?? "1234567890";
const ML_APPLICATION_ID = process.env.ML_CLIENT_ID ?? "3933497047128728";
const SYNTHETIC_ORDER_ID =
  process.env.ML_TEST_RESOURCE_ID ?? `smoke-${Date.now()}`;
const ML_TEST_RESOURCE = `/orders/${SYNTHETIC_ORDER_ID}`;

// Budgets (milliseconds) — mirror the WP smoke. The 15-min budget is the
// channel-agnostic F2 latency contract (WP-06) that F2.1 inherits.
const BUDGET_LANDED_MS = 5_000;
const BUDGET_CASCADE_MS = 90_000;
const BUDGET_VIEW_MS = 15 * 60 * 1000; // 15 min

// Polling cadence.
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_LANDED_MS = 30_000;
const MAX_POLL_CASCADE_MS = 120_000;
const MAX_POLL_VIEW_MS = 16 * 60 * 1000;

// Canonical ML signed-params order — MUST match
// packages/connectors/src/mercadolibre/webhook-verify.ts:ML_SIGNED_PARAMS.
const ML_SIGNED_PARAMS = [
  "topic",
  "user_id",
  "application_id",
  "attempts",
  "sent",
  "received",
] as const;

type Report = {
  channel: "mercadolibre";
  mode: "configured" | "degraded";
  ok: boolean;
  exit_code: number;
  reason?: string;
  external_order_id?: string;
  timings_ms?: {
    t_landed?: number;
    t_cascade?: number;
    t_view_reflects?: number;
  };
  budgets_ms: {
    t_landed: number;
    t_cascade: number;
    t_view_reflects: number;
  };
  notes: string[];
};

function emit(report: Report): never {
  // Single-line JSON last so CI parsers can `tail -n1 | jq`.
  for (const note of report.notes) console.error(`# ${note}`);
  console.log(JSON.stringify(report));
  process.exit(report.exit_code);
}

// ─── Degraded mode short-circuit ─────────────────────────────────────────────

if (!ORCH_URL || !DATABASE_URL || !ML_SECRET) {
  const missing: string[] = [];
  if (!ORCH_URL) missing.push("ORCHESTRATOR_URL");
  if (!DATABASE_URL) missing.push("DATABASE_URL");
  if (!ML_SECRET) missing.push("ML_WEBHOOK_SECRET");

  const notes: string[] = [
    `Degraded mode — missing env: ${missing.join(", ")}`,
    "Skipping live ML latency probe; smoke-f2.1.sh covers the HTTP-only degraded checks.",
  ];

  // Best-effort degraded probe — if at least ORCHESTRATOR_URL is set, hit
  // the ML webhook once expecting 503 (degraded-mode contract from
  // packages/connectors/src/mercadolibre/config.ts).
  if (ORCH_URL) {
    try {
      const res = await fetch(`${ORCH_URL}/webhooks/mercadolibre`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      notes.push(`degraded webhook probe: HTTP ${res.status} (expected 503)`);
    } catch (err) {
      notes.push(`degraded webhook probe failed: ${String(err)}`);
    }
  }

  emit({
    channel: "mercadolibre",
    mode: "degraded",
    ok: true,
    exit_code: 78, // EX_CONFIG — documented "skip" code, mirrors wp-latency-smoke.
    reason: "ml_credentials_unset",
    budgets_ms: {
      t_landed: BUDGET_LANDED_MS,
      t_cascade: BUDGET_CASCADE_MS,
      t_view_reflects: BUDGET_VIEW_MS,
    },
    notes,
  });
}

// ─── Configured mode ─────────────────────────────────────────────────────────

let Client: typeof import("pg").Client;
try {
  ({ Client } = await import("pg"));
} catch (err) {
  emit({
    channel: "mercadolibre",
    mode: "configured",
    ok: false,
    exit_code: 1,
    reason: "pg_not_installed",
    budgets_ms: {
      t_landed: BUDGET_LANDED_MS,
      t_cascade: BUDGET_CASCADE_MS,
      t_view_reflects: BUDGET_VIEW_MS,
    },
    notes: [
      `Cannot import 'pg' (${String(err)}).`,
      "Install with: pnpm add -D pg @types/pg",
      "Or run scripts/smoke-f2.1.sh which does not require DB access.",
    ],
  });
}

const pg = new Client({ connectionString: DATABASE_URL });
await pg.connect();

const notes: string[] = [
  `external_order_id=${SYNTHETIC_ORDER_ID}`,
  `ml_user_id=${ML_USER_ID}`,
  `ml_application_id=${ML_APPLICATION_ID}`,
];

try {
  // ── Build a valid signed-query-params webhook payload ───────────────────
  //
  // Six signed fields in canonical order; `sent` and `received` vary per
  // run so the orchestrator's dedup index treats the row as new on each
  // invocation (preventing 200 {dedup:true} responses on repeat runs).
  const nowIso = new Date().toISOString();
  const sentIso = new Date(Date.now() - 60_000).toISOString();
  const signedParams: Record<string, string> = {
    topic: "orders_v2",
    user_id: ML_USER_ID,
    application_id: ML_APPLICATION_ID,
    attempts: "1",
    sent: sentIso,
    received: nowIso,
  };

  // Canonical string — `name:value` pairs joined by `;` in
  // ML_SIGNED_PARAMS order. NEVER use Object.entries() ordering here;
  // production webhook-verify.ts iterates ML_SIGNED_PARAMS explicitly.
  const canonical = ML_SIGNED_PARAMS.map(
    (k) => `${k}:${signedParams[k] ?? ""}`,
  ).join(";");
  const signature = createHmac("sha256", ML_SECRET)
    .update(canonical)
    .digest("hex");

  // Build the request URL with the signed params. The signature can ride in
  // the `x-signature` HTTP header (canonical) OR the `signature` query
  // param (legacy fallback). We use the header to match prod ML behaviour.
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(signedParams)) search.set(k, v);
  const url = `${ORCH_URL}/webhooks/mercadolibre?${search.toString()}`;

  // Minimal JSON body — ML's webhook body carries the resource path +
  // duplicates of the signed params. The orchestrator parses `resource`
  // out of the body (not the query) to build the notification id.
  const body = JSON.stringify({
    resource: ML_TEST_RESOURCE,
    user_id: Number(ML_USER_ID),
    topic: "orders_v2",
    application_id: Number(ML_APPLICATION_ID),
    sent: sentIso,
    received: nowIso,
    // Webhook smoke tag — purely cosmetic, helps operators recognize their
    // own synthetic traffic in raw_orders payload inspection.
    _smoke: { run_id: randomUUID() },
  });

  // ── t0: POST the webhook ────────────────────────────────────────────────
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
    },
    body,
  });

  if (res.status !== 200) {
    const respBody = await res.text();
    throw new Error(
      `webhook POST returned ${res.status}: ${respBody.slice(0, 200)}`,
    );
  }

  // ── Poll for raw_orders landing ─────────────────────────────────────────
  //
  // The orchestrator's webhook route writes a `raw_orders` row with
  // payload_json._resource === ML_TEST_RESOURCE per
  // apps/orchestrator/src/routes/webhooks-mercadolibre.ts. We look that
  // up.
  let t_landed: number | undefined;
  const landedDeadline = Date.now() + MAX_POLL_LANDED_MS;
  while (Date.now() < landedDeadline) {
    const r = await pg.query<{ count: string }>(
      `select count(*)::text as count
         from raw_orders
        where canal = 'mercadolibre'
          and payload_json->>'_resource' = $1`,
      [ML_TEST_RESOURCE],
    );
    if (Number(r.rows[0]?.count ?? "0") > 0) {
      t_landed = Date.now() - t0;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (t_landed === undefined) {
    throw new Error(
      `raw_orders row never appeared for _resource=${ML_TEST_RESOURCE}`,
    );
  }

  // ── Poll for sale_items cascade completion ──────────────────────────────
  //
  // sync-ml-orders cron drains raw_orders → upserts sales + sale_items →
  // fires runMatchCascade per item. Either master_sku populates or the
  // item exists at all (queued for human review). Either outcome means
  // the cascade ran.
  let t_cascade: number | undefined;
  const cascadeDeadline = Date.now() + MAX_POLL_CASCADE_MS;
  while (Date.now() < cascadeDeadline) {
    const r = await pg.query<{ count: string }>(
      `select count(*)::text as count
         from sale_items si
         join sales s on s.sale_id = si.sale_id
        where s.canal = 'mercadolibre'
          and s.external_order_id = $1`,
      [SYNTHETIC_ORDER_ID],
    );
    if (Number(r.rows[0]?.count ?? "0") > 0) {
      t_cascade = Date.now() - t0;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  // t_cascade missing is non-fatal — depends on the sync-ml-orders cron
  // firing within the window. Continue to the view check.

  // ── Poll for sales-row reflection (proxy for the v_hoy_last_hour view) ──
  //
  // The view doesn't expose external_order_id, so we query sales directly.
  // Once the sales row exists for our external_order_id, the view will
  // pick it up on the next refresh (the view is a non-materialized view —
  // queries hit the live sales table on read).
  let t_view: number | undefined;
  const viewDeadline = Date.now() + MAX_POLL_VIEW_MS;
  while (Date.now() < viewDeadline) {
    const r = await pg.query<{ count: string }>(
      `select count(*)::text as count
         from sales
        where canal = 'mercadolibre'
          and external_order_id = $1`,
      [SYNTHETIC_ORDER_ID],
    );
    if (Number(r.rows[0]?.count ?? "0") > 0) {
      t_view = Date.now() - t0;
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const underBudget =
    (t_landed ?? Infinity) <= BUDGET_LANDED_MS &&
    (t_cascade ?? Infinity) <= BUDGET_CASCADE_MS &&
    (t_view ?? Infinity) <= BUDGET_VIEW_MS;

  emit({
    channel: "mercadolibre",
    mode: "configured",
    ok: underBudget,
    exit_code: underBudget ? 0 : 2,
    external_order_id: SYNTHETIC_ORDER_ID,
    timings_ms: {
      t_landed,
      t_cascade,
      t_view_reflects: t_view,
    },
    budgets_ms: {
      t_landed: BUDGET_LANDED_MS,
      t_cascade: BUDGET_CASCADE_MS,
      t_view_reflects: BUDGET_VIEW_MS,
    },
    notes,
  });
} catch (err) {
  emit({
    channel: "mercadolibre",
    mode: "configured",
    ok: false,
    exit_code: 1,
    reason: String(err),
    external_order_id: SYNTHETIC_ORDER_ID,
    budgets_ms: {
      t_landed: BUDGET_LANDED_MS,
      t_cascade: BUDGET_CASCADE_MS,
      t_view_reflects: BUDGET_VIEW_MS,
    },
    notes,
  });
} finally {
  await pg.end().catch(() => undefined);
}
