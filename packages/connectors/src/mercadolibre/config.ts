/**
 * Mercado Libre env loader + degraded-mode discriminant (Plan 2.1.1.4 stub;
 * full surface lands in Plan 2.1.2.3).
 *
 * STUB scope (this commit):
 *   • `loadMercadoLibreConfig` — reads ML_CLIENT_ID / ML_CLIENT_SECRET /
 *     ML_REDIRECT_URI / ML_WEBHOOK_SECRET and returns a discriminated-union
 *     of either `{ ok: true, cfg }` or `{ ok: false, missing }`. Mirrors
 *     the WordPress connector's `loadWordPressConfig` shape (PATTERNS §15
 *     env contract reuse).
 *
 *   • Whitespace-only values count as missing — matches WP's `nonEmpty`
 *     check (apps/orchestrator's env validation pattern from F1).
 *
 *   • `http://` redirect URIs are accepted at this stub stage; Plan
 *     2.1.2.3 layers the HTTPS-only validation per RESEARCH §Security V9.
 *     The 5h refresh cron does not consume `redirectUri` so the loose
 *     check is safe in W1; the dashboard's connect page is what would
 *     drag a bad URL into prod and that lives in W3.
 *
 *   • `getMLConnectionStatus` is NOT added here — Plan 2.1.2.3 owns the
 *     dashboard-facing helper. The cron only needs to know whether all
 *     four envs are present.
 *
 * INVARIANTS (PATTERNS §"CC-11 carried forward"):
 *   - This file reads from `process.env` (or a passed-in env object for
 *     tests). NEVER from `NEXT_PUBLIC_*` — those are forbidden for ML
 *     credentials per the eslint gate (Plan 2.1.0.3).
 *   - `ML_CLIENT_SECRET` and `ML_WEBHOOK_SECRET` are orchestrator-only;
 *     the dashboard never imports this module.
 */

import type { MLConfig } from "./types.js";

export interface MLConfigOk {
  ok: true;
  cfg: MLConfig;
}

export interface MLConfigMissing {
  ok: false;
  missing: string[];
}

export type LoadedMLConfig = MLConfigOk | MLConfigMissing;

const ENV_KEYS = [
  "ML_CLIENT_ID",
  "ML_CLIENT_SECRET",
  "ML_REDIRECT_URI",
  "ML_WEBHOOK_SECRET",
] as const;

function nonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Read all four ML envs and return the degraded-mode envelope.
 *
 * Returns `{ ok: false, missing: [...] }` listing whichever envs are unset
 * or whitespace-only. Callers (the cron, the connector, the webhook route)
 * branch on `ok` and run the no-op path in the missing case.
 */
export function loadMercadoLibreConfig(
  env: NodeJS.ProcessEnv = process.env,
): LoadedMLConfig {
  const missing: string[] = [];
  const values: Record<string, string> = {};
  for (const k of ENV_KEYS) {
    const v = env[k];
    if (!nonEmpty(v)) {
      missing.push(k);
    } else {
      values[k] = v;
    }
  }
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    cfg: {
      clientId: values.ML_CLIENT_ID,
      clientSecret: values.ML_CLIENT_SECRET,
      redirectUri: values.ML_REDIRECT_URI,
      webhookSecret: values.ML_WEBHOOK_SECRET,
    },
  };
}
