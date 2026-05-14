/**
 * WordPress connector config loader (Plan 2.2.1).
 *
 * The four-env contract:
 *   WORDPRESS_API_URL          — base URL of the WP/WooCommerce site
 *   WORDPRESS_API_KEY          — WooCommerce REST consumer key (ck_…)
 *   WORDPRESS_API_SECRET       — WooCommerce REST consumer secret (cs_…)
 *   WORDPRESS_WEBHOOK_SECRET   — secret configured on the WC webhook for HMAC
 *
 * If ANY of the four is missing or empty → `{ ok: false, reason: "not_configured" }`.
 * This is the **degraded-mode discriminant**: the connector surface stays
 * available but every fetch returns `[]` and healthCheck returns `ok:false`.
 * No exceptions are raised on missing config — callers always receive a
 * connector instance.
 *
 * Invariant CC-11: these env vars stay orchestrator-only — the dashboard
 * MUST NOT import `@faka/connectors/wordpress` directly. Imports flow through
 * `apps/orchestrator/src/*`.
 */

export interface WordPressConfig {
  ok: true;
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
}

export interface WordPressConfigMissing {
  ok: false;
  reason: "not_configured";
}

export type LoadedWordPressConfig = WordPressConfig | WordPressConfigMissing;

const ENV_KEYS = [
  "WORDPRESS_API_URL",
  "WORDPRESS_API_KEY",
  "WORDPRESS_API_SECRET",
  "WORDPRESS_WEBHOOK_SECRET",
] as const;

function nonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function loadWordPressConfig(
  env: NodeJS.ProcessEnv = process.env,
): LoadedWordPressConfig {
  const values = ENV_KEYS.map((k) => env[k]);
  if (!values.every(nonEmpty)) {
    // not_configured — degraded mode
    return { ok: false, reason: "not_configured" };
  }
  const [apiUrl, apiKey, apiSecret, webhookSecret] = values as string[];
  return {
    ok: true,
    apiUrl: apiUrl!,
    apiKey: apiKey!,
    apiSecret: apiSecret!,
    webhookSecret: webhookSecret!,
  };
}
