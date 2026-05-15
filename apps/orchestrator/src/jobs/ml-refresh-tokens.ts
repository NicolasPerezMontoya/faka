/**
 * Mercado Libre refresh-tokens cron — 5-hour safety net (Plan 2.1.1.4).
 *
 * The PRIMARY refresh path is lazy-refresh-on-401 inside the api-client
 * (Plan 2.1.2.1) + the `expires_at < now() + 60s` skew check inside
 * `loadAccessToken` (Plan 2.1.1.2). This cron is the SAFETY NET for the
 * narrow window when neither of those fire: a token that's been dormant
 * for >6 hours with no API traffic. We catch it before expiry and rotate,
 * so the next `sync-ml-orders` tick doesn't lose its first round-trip to
 * a 401 + lazy-refresh detour.
 *
 * Cadence: every 5 hours (the cron service entry sets the cron expression
 * with five fields: minute=0, hour=star-slash-5, day/month/dow=star). The
 * 5h cadence is calibrated to ML's 6h access-token TTL — we always have at
 * least 1h of headroom even if the cron itself is delayed by Railway's
 * scheduler jitter.
 *
 * ── W2 INVARIANT (connector_runs kind/canal coherence) ──────────────────────
 * Every recorded run uses `kind: "channel", canal: "mercadolibre"`. The
 * "cron differentiator" (`tipo: "refresh-tokens"`) lives in
 * `metadata_json`, NOT in the channel enum — same pattern WP uses for its
 * `tipo: "orders"` / `tipo: "products"` distinction.
 *
 * ── DEGRADED MODE (RESEARCH §Environment Availability) ──────────────────────
 * When `loadMercadoLibreConfig` returns `{ ok: false, missing }`:
 *   • Write a `connector_runs` row with `status: "succeeded"`,
 *     `records_processed: 0`, `errors_json: { reason: "not_configured",
 *     missing }`. We use `succeeded` (not `failed`) because the run did
 *     exactly what we asked of it: nothing, because nothing was wired.
 *     `failed` would page the operator during the pre-OAuth period.
 *   • `process.exit(0)` — Railway interprets non-zero as a service failure
 *     and will restart-on-failure, which is exactly the alarm-storm we
 *     want to avoid pre-OAuth.
 *
 * ── PARTIAL-BATCH RESILIENCE ────────────────────────────────────────────────
 * One user's refresh failure does NOT stop the others. Each `refreshToken`
 * call's `ok: false` increments `failed`, accumulates into `errors_json`,
 * and the loop continues. The final `connector_runs` row's `status` is:
 *   • `succeeded` — every refresh worked (`failed === 0`).
 *   • `partial` — at least one succeeded, at least one failed.
 *   • `failed` — all attempts failed.
 *
 * Exit code: `process.exit(0)` for `succeeded` / `partial` (Railway alarm
 * threshold sits at status=failed in connector_runs, NOT exit code).
 * `process.exit(1)` is reserved for truly-unhandled exceptions (i.e. the
 * cron file itself crashed before it could write a `connector_runs` row).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordConnectorRun } from "@faka/connectors";
// Import the OAuth + config helpers directly — we intentionally do NOT widen
// the `@faka/connectors/mercadolibre` barrel exports here. The F1 ML
// `index.ts` skeleton is frozen until Plan 2.1.2.4's rewrite (per Wave 1
// charter), so reaching past the barrel into the subpath is the explicit
// "I am consuming a Wave-1-only API surface" signal. Once 2.1.2.4 lands,
// these imports collapse back through the barrel.
import { refreshToken } from "@faka/connectors/mercadolibre/oauth.js";
import {
  loadMercadoLibreConfig,
  type LoadedMLConfig,
} from "@faka/connectors/mercadolibre/config.js";
import { log as orchestratorLog } from "../lib/log.js";
import { getSupabase } from "../lib/supabase.js";

/** How far ahead of `expires_at` we sweep (PLAN.md §2.1.1.4 — 1h). */
const REFRESH_LOOKAHEAD_MS = 60 * 60 * 1000;

export interface JobLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface MlRefreshTokensDeps {
  getSupabase?: () => SupabaseClient;
  loadConfig?: () => LoadedMLConfig;
  logger?: JobLogger;
  now?: () => Date;
}

export interface MlRefreshTokensResult {
  status: "succeeded" | "partial" | "failed" | "not_configured";
  candidates: number;
  refreshed: number;
  failed: number;
  duration_ms: number;
}

interface PerUserError {
  user_id: string;
  message: string;
}

function defaultLogger(): JobLogger {
  return {
    debug: (obj, msg) => orchestratorLog.debug(obj, msg),
    info: (obj, msg) => orchestratorLog.info(obj, msg),
    warn: (obj, msg) => orchestratorLog.warn(obj, msg),
    error: (obj, msg) => orchestratorLog.error(obj, msg),
  };
}

export async function runMlRefreshTokens(
  deps: MlRefreshTokensDeps = {},
): Promise<MlRefreshTokensResult> {
  const log = deps.logger ?? defaultLogger();
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const cfg = (deps.loadConfig ?? (() => loadMercadoLibreConfig()))();

  const supabase = (deps.getSupabase ?? getSupabase)();

  // [1] Degraded mode — no creds → write skipped-but-clean run + clean return.
  if (!cfg.ok) {
    const completedAt = new Date();
    await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "mercadolibre",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      status: "succeeded",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "not_configured", missing: cfg.missing },
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      metadata_json: { tipo: "refresh-tokens", source: "ml-refresh-cron" },
    });
    log.warn(
      { missing: cfg.missing },
      "cron.ml-refresh-tokens.degraded:not_configured",
    );
    return {
      status: "not_configured",
      candidates: 0,
      refreshed: 0,
      failed: 0,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
    };
  }

  // [2] Find token rows that will expire within the lookahead window.
  // The index oauth_tokens_canal_expires_idx covers this query.
  const horizonIso = new Date(now().getTime() + REFRESH_LOOKAHEAD_MS).toISOString();
  const { data: candidates, error: queryErr } = await supabase
    .from("oauth_tokens")
    .select("user_id, expires_at")
    .eq("canal", "mercadolibre")
    .lt("expires_at", horizonIso);

  if (queryErr) {
    log.error(
      { err: queryErr.message },
      "cron.ml-refresh-tokens.query_failed",
    );
    const completedAt = new Date();
    await recordConnectorRun(supabase, {
      kind: "channel",
      canal: "mercadolibre",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      status: "failed",
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      errors_json: { reason: "query_failed", message: queryErr.message },
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      metadata_json: { tipo: "refresh-tokens", source: "ml-refresh-cron" },
    });
    return {
      status: "failed",
      candidates: 0,
      refreshed: 0,
      failed: 0,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
    };
  }

  const rows = (candidates ?? []) as Array<{
    user_id: string;
    expires_at: string;
  }>;

  log.info(
    { count: rows.length, horizon: horizonIso },
    "cron.ml-refresh-tokens.candidates",
  );

  // [3] Iterate — partial-batch resilient.
  let refreshed = 0;
  let failed = 0;
  const errors: PerUserError[] = [];

  for (const row of rows) {
    const result = await refreshToken(supabase, cfg.cfg, row.user_id);
    if (result.ok) {
      refreshed += 1;
      // Intentionally NO log line here — even a "refresh succeeded" message
      // is one slip away from accidentally logging a token if a future
      // change adds `result` to the log payload. The connector_runs row is
      // the audit trail.
    } else {
      failed += 1;
      errors.push({ user_id: row.user_id, message: result.error });
      log.warn(
        { user_id: row.user_id, error: result.error },
        "cron.ml-refresh-tokens.user_failed",
      );
    }
  }

  // [4] Single connector_runs row per tick (W2 invariant).
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  const status: "succeeded" | "partial" | "failed" =
    failed === 0
      ? "succeeded"
      : refreshed === 0
        ? "failed"
        : "partial";

  await recordConnectorRun(supabase, {
    kind: "channel",
    canal: "mercadolibre",
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    status,
    records_processed: refreshed,
    records_failed: failed,
    retry_count: 0,
    errors_json: errors.length > 0 ? { errors } : null,
    duration_ms: durationMs,
    metadata_json: {
      tipo: "refresh-tokens",
      source: "ml-refresh-cron",
      candidates: rows.length,
      refreshed,
      failed,
    },
  });

  log.info(
    {
      job: "ml-refresh-tokens",
      candidates: rows.length,
      refreshed,
      failed,
      duration_ms: durationMs,
    },
    "cron.ml-refresh-tokens.done",
  );

  return {
    status,
    candidates: rows.length,
    refreshed,
    failed,
    duration_ms: durationMs,
  };
}
