/**
 * Mercado Libre env loader + degraded-mode discriminant (Plan 2.1.2.3).
 *
 * Expands the W1 stub into the full PATTERNS-aligned config gate:
 *
 *   - Reads ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI, ML_WEBHOOK_SECRET.
 *   - Optional ML_SITE_ID (default "MCO"). Single-site invariant — multi-site
 *     is a future migration, not an env flip (PATTERNS §"F2.1-NEW — Single
 *     ML site hardcoded"), so the constant from types.ts is the source of
 *     truth; this env is only honored for forward-compat testing.
 *   - ML_CLIENT_ID MUST be a numeric string (e.g. "3933497047128728" — the
 *     real cliente app). Non-numeric values are treated as missing.
 *   - ML_REDIRECT_URI MUST parse as a URL AND use HTTPS (RESEARCH §Security
 *     V9). http:// is rejected at load time. Path-suffix mismatch (not
 *     ending in `/oauth/callback`) WARNS via the optional logger but does
 *     NOT fail — operators may use a different callback path in dev.
 *   - Whitespace-only values count as missing — matches WP's `nonEmpty`
 *     check.
 *
 * Discriminated-union return shape (`MLConfigStatus`):
 *   { ok: true, cfg: MLConfig } | { ok: false; reason: "not_configured"; missing: string[] }
 *
 * Degraded-mode behavior matrix (RESEARCH §Environment Availability):
 *   - Connector `healthCheck` returns `{ ok: false, last_error: "not configured" }`.
 *   - `fetchOrders` / `fetchProducts` return `[]` after logging.
 *   - Webhook route returns 503.
 *   - Crons exit 0 (don't pager-spam the cliente during the pre-OAuth window).
 *
 * ── Dashboard-facing helper (CC-11 invariant) ─────────────────────────────────
 *
 * `getMLConnectionStatus(supabase)` returns `{ connected, configured, user_id? }`
 * for the `/operacion/conectar-mercadolibre` connect page. It reads:
 *   - configured: derived from `loadMercadoLibreConfig` on the orchestrator side
 *     (the page's server action calls this).
 *   - connected:  EXISTS row in `oauth_tokens` where canal='mercadolibre'.
 *   - user_id:    the seller's ML user_id (text), if connected.
 *
 * It NEVER returns the access_token. The dashboard renders status pills;
 * fetching tokens is orchestrator-only. CC-11 enforcement.
 *
 * ── Backwards compat ─────────────────────────────────────────────────────────
 *
 * The W1 stub exported `loadMercadoLibreConfig` + types `MLConfigOk`,
 * `MLConfigMissing`, `LoadedMLConfig`. Those are kept here under their
 * original names so prior call sites (oauth.test.ts, refresh-tokens cron)
 * keep compiling. The new richer types add `reason` and `getMLConnectionStatus`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ML_SITE_ID, type MLConfig, type MLSiteId } from "./types.js";

// -----------------------------------------------------------------------------
// Discriminated-union return shapes
// -----------------------------------------------------------------------------

export interface MLConfigOk {
  ok: true;
  cfg: MLConfig & { siteId: MLSiteId | string };
}

export interface MLConfigMissing {
  ok: false;
  /** Discriminant for callers that want a stable string to switch on. */
  reason: "not_configured";
  /** Which env var(s) were missing/invalid. Ordered for stable error messages. */
  missing: string[];
}

export type LoadedMLConfig = MLConfigOk | MLConfigMissing;

/** Alias kept for API parity with the wider PLAN.md surface. */
export type MLConfigStatus = LoadedMLConfig;

// -----------------------------------------------------------------------------
// Validation helpers (pure)
// -----------------------------------------------------------------------------

const REQUIRED_KEYS = [
  "ML_CLIENT_ID",
  "ML_CLIENT_SECRET",
  "ML_REDIRECT_URI",
  "ML_WEBHOOK_SECRET",
] as const;

function nonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isNumericString(v: string): boolean {
  // Tolerate optional whitespace; reject anything non-digit including signs.
  return /^[0-9]+$/.test(v.trim());
}

interface ParsedRedirect {
  ok: boolean;
  reason?: string;
  url?: URL;
}

function parseRedirectUri(raw: string): ParsedRedirect {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "must be a parseable URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "must be https" };
  }
  return { ok: true, url };
}

// -----------------------------------------------------------------------------
// loadMercadoLibreConfig
// -----------------------------------------------------------------------------

export interface LoadOpts {
  /** Optional logger for non-fatal warnings (e.g. unusual redirect path). */
  logger?: {
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Read all four ML envs (+ optional ML_SITE_ID) and return the degraded-mode
 * envelope. NEVER throws. Caller branches on `ok` and runs the no-op path
 * when missing.
 */
export function loadMercadoLibreConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: LoadOpts = {},
): LoadedMLConfig {
  const missing: string[] = [];
  const values: Record<string, string> = {};

  for (const k of REQUIRED_KEYS) {
    const v = env[k];
    if (!nonEmpty(v)) {
      missing.push(k);
    } else {
      values[k] = v.trim();
    }
  }

  // Type-level validation — runs only on present values, but any failure
  // contributes a descriptive marker to `missing[]` so the operator sees
  // why the load failed.
  if (values.ML_CLIENT_ID && !isNumericString(values.ML_CLIENT_ID)) {
    missing.push("ML_CLIENT_ID (must be a numeric string)");
    delete values.ML_CLIENT_ID;
  }

  if (values.ML_REDIRECT_URI) {
    const parsed = parseRedirectUri(values.ML_REDIRECT_URI);
    if (!parsed.ok) {
      missing.push(`ML_REDIRECT_URI (${parsed.reason ?? "invalid"})`);
      delete values.ML_REDIRECT_URI;
    } else if (
      parsed.url &&
      !parsed.url.pathname.endsWith("/oauth/callback") &&
      !parsed.url.pathname.endsWith("/oauth/mercadolibre/callback")
    ) {
      // Path-suffix mismatch is a soft warning — operators may use a custom
      // path in dev. The cliente's prod redirect is the canonical suffix.
      opts.logger?.warn("ml.config.redirect_path_unusual", {
        pathname: parsed.url.pathname,
      });
    }
  }

  if (missing.length > 0) {
    return { ok: false, reason: "not_configured", missing };
  }

  const rawSiteId = env.ML_SITE_ID;
  const siteId =
    nonEmpty(rawSiteId) && rawSiteId !== ML_SITE_ID
      ? rawSiteId.trim()
      : ML_SITE_ID;

  return {
    ok: true,
    cfg: {
      clientId: values.ML_CLIENT_ID!,
      clientSecret: values.ML_CLIENT_SECRET!,
      redirectUri: values.ML_REDIRECT_URI!,
      webhookSecret: values.ML_WEBHOOK_SECRET!,
      siteId,
    },
  };
}

// -----------------------------------------------------------------------------
// Dashboard helper — getMLConnectionStatus (CC-11)
// -----------------------------------------------------------------------------

export interface MLConnectionStatus {
  /** True iff `loadMercadoLibreConfig(env).ok === true`. */
  configured: boolean;
  /** True iff there is at least one `oauth_tokens` row for canal='mercadolibre'. */
  connected: boolean;
  /** ML seller `user_id` (text — DB column is text per migration 0001). */
  user_id?: string;
}

/**
 * Server-side helper the dashboard's `/operacion/conectar-mercadolibre`
 * server action calls to derive the pill state.
 *
 * Reads `oauth_tokens` via the service-role client (the caller must pass
 * one — anon-key clients see nothing because RLS is enabled with no SELECT
 * policy). Returns a structured envelope; NEVER returns access_token /
 * refresh_token — CC-11 invariant.
 *
 * Optionally accepts an `env` override so the dashboard can pass its own
 * process.env reference (the dashboard runs as a separate Next.js process
 * but reads from the same Vercel env in v1 — see DEPLOY.md).
 */
export async function getMLConnectionStatus(
  supabase: SupabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MLConnectionStatus> {
  const loaded = loadMercadoLibreConfig(env);
  const configured = loaded.ok;

  // Even when not configured, we still check the table — operators might
  // have a stale token row from a previous configuration; surfacing it
  // helps them recognize the disconnect-then-reconfigure flow.
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("user_id")
    .eq("canal", "mercadolibre")
    .limit(1)
    .maybeSingle();

  if (error) {
    // Read errors → treat as not-connected; never throw to the dashboard.
    return { configured, connected: false };
  }

  if (!data) {
    return { configured, connected: false };
  }

  const row = data as { user_id: string };
  return {
    configured,
    connected: true,
    user_id: row.user_id,
  };
}
