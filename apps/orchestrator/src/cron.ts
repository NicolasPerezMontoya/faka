/**
 * Cron entry — Railway invokes this on schedule (railway.toml).
 *
 * F1 shipped a heartbeat-only cron. F2 (Plan 2.3.2) branches on argv[2] so a
 * single binary handles every scheduled job: the heartbeat keeps proving the
 * cron infrastructure is alive, the per-channel jobs do real work.
 *
 * Subcommands wired here:
 *   - `heartbeat`         → write a `connector_runs` row with kind=cron-heartbeat
 *                            (F1 behavior, kept verbatim).
 *   - `process-wp-events` → drain `raw_orders WHERE canal='wordpress' AND
 *                            processed=false` via the async event processor
 *                            (Plan 2.3.2). Writes ONE `connector_runs` row with
 *                            kind=channel + canal=wordpress per tick.
 *   - `sync-wp-orders`    → hourly REST pull of `/orders?modified_after=...`
 *                            as insurance against missed webhooks (Plan 2.3.3).
 *                            metadata_json.tipo='orders'.
 *   - `sync-wp-products`  → hourly REST pull of `/products?modified_after=...`
 *                            keeping master_products + product_mappings fresh
 *                            for the cascade (Plan 2.3.3). metadata_json.tipo='products'.
 *   - `reembed-products`  → daily refresh of `product_embeddings` for the
 *                            master_products catalog (Plan 2.3.4). Uses the
 *                            sha256(source_text) short-circuit so unchanged
 *                            rows skip the OpenAI API entirely.
 *   - `re-cascade-unmatched` → every 6h, retry the cascade for
 *                            `sale_items.master_sku IS NULL` rows < 7d old
 *                            (Plan 2.3.4). Gated by LLM_DAILY_TOKEN_CAP.
 *
 * RESEARCH §7 + Pitfall 7:
 *   - Process MUST `process.exit(0)` cleanly on success. Railway cron keeps
 *     the container alive until exit; hung processes get killed.
 *   - Minimum schedule granularity is 5 minutes (Railway constraint).
 *   - Schedule is UTC-only.
 *
 * W2 invariant (migration 0008 + connectors/observability.ts):
 *   - kind='cron-heartbeat' requires canal=null. Heartbeat enforces this.
 *   - kind='channel'        requires canal to be a real channel. process-wp-events
 *                            uses canal='wordpress'. recordConnectorRun throws
 *                            if the rule is violated.
 */

import { recordConnectorRun } from "@faka/connectors";
import { log } from "./lib/log.js";
import { getSupabase } from "./lib/supabase.js";
import { runProcessWpEvents } from "./jobs/process-wp-events.js";
import { runSyncWpOrders } from "./jobs/sync-wp-orders.js";
import { runSyncWpProducts } from "./jobs/sync-wp-products.js";
import { runReembedJob } from "./jobs/reembed-products.js";
import { runRecascadeJob } from "./jobs/re-cascade-unmatched.js";

type Subcommand =
  | "heartbeat"
  | "process-wp-events"
  | "sync-wp-orders"
  | "sync-wp-products"
  | "reembed-products"
  | "re-cascade-unmatched";

const KNOWN: Subcommand[] = [
  "heartbeat",
  "process-wp-events",
  "sync-wp-orders",
  "sync-wp-products",
  "reembed-products",
  "re-cascade-unmatched",
];

function parseSubcommand(): Subcommand {
  // Default to the F1 heartbeat so an unconfigured cron service keeps doing
  // the original infrastructure check rather than silently no-op'ing.
  const arg = (process.argv[2] ?? "heartbeat").trim();
  if ((KNOWN as string[]).includes(arg)) return arg as Subcommand;
  log.warn(
    { argv: process.argv.slice(2), valid: KNOWN },
    "cron.unknown_subcommand",
  );
  return "heartbeat";
}

async function runHeartbeat(): Promise<void> {
  const startedAt = new Date();
  const supabase = getSupabase();

  log.info({ ts: startedAt.toISOString() }, "cron.heartbeat.start");

  await recordConnectorRun(supabase, {
    kind: "cron-heartbeat",
    canal: null,
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    status: "succeeded",
    records_processed: 0,
    records_failed: 0,
    retry_count: 0,
    errors_json: null,
    duration_ms: Date.now() - startedAt.getTime(),
    metadata_json: { source: "railway-cron", node_version: process.version },
  });

  log.info("cron.heartbeat.done");
}

async function main(): Promise<void> {
  const sub = parseSubcommand();
  log.info({ subcommand: sub }, "cron.start");

  try {
    switch (sub) {
      case "heartbeat":
        await runHeartbeat();
        process.exit(0);
        break;

      case "process-wp-events": {
        const result = await runProcessWpEvents();
        log.info({ result }, "cron.process-wp-events.summary");
        // `failed` (zero processed, some failures) still exits 0 — Railway's
        // restart-on-failure is the wrong response when the issue is bad
        // data, not a broken process. The connector_runs row with
        // status='failed' is the operator's signal.
        process.exit(0);
        break;
      }

      case "sync-wp-orders": {
        const result = await runSyncWpOrders();
        log.info({ result }, "cron.sync-wp-orders.summary");
        // Same exit policy as process-wp-events: partial/failed status is
        // surfaced via `connector_runs.status`, not via the process exit
        // code, so Railway doesn't loop on bad-data conditions.
        process.exit(0);
        break;
      }

      case "sync-wp-products": {
        const result = await runSyncWpProducts();
        log.info({ result }, "cron.sync-wp-products.summary");
        process.exit(0);
        break;
      }

      case "reembed-products": {
        const result = await runReembedJob();
        log.info({ result }, "cron.reembed-products.summary");
        // Same exit policy: partial/failed status surfaces via
        // `connector_runs.status`, not via the process exit code, so
        // Railway doesn't loop on bad-data conditions (e.g. an OpenAI
        // outage that resolves in the next tick).
        process.exit(0);
        break;
      }

      case "re-cascade-unmatched": {
        const result = await runRecascadeJob();
        log.info({ result }, "cron.re-cascade-unmatched.summary");
        process.exit(0);
        break;
      }
    }
  } catch (err) {
    log.error(
      { err: (err as Error).message, subcommand: sub },
      "cron.failed",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  log.fatal({ err: (err as Error).message }, "cron.fatal");
  process.exit(1);
});
