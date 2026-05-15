/**
 * OAuth callback receiver — F2.1 Plan 2.1.3.4.
 *
 * Receives `?code=...&state=...` from Mercado Libre after the operator
 * authorizes on `auth.mercadolibre.com.co/authorization`. Validates the
 * state nonce against `oauth_state`, exchanges the authorization code via
 * `exchangeCodeForToken` from `@faka/connectors/mercadolibre`, persists the
 * rotated token pair into `oauth_tokens`, then redirects back to
 * `/operacion/conectar-mercadolibre?status=success`.
 *
 * ── CC-11 caveat (TEMPORARY HOME) ───────────────────────────────────────────
 *
 * TODO(CC-11/Railway): this route runs on Vercel and needs `ML_CLIENT_SECRET`
 * server-side. Vercel holds the secret temporarily because Railway is not
 * deployed yet. Once Railway lands, this entire route moves to the
 * orchestrator at `apps/orchestrator/src/routes/mercadolibre-oauth.ts` and the
 * secret moves with it. The redirect URI on ML's dev console updates from
 * `https://<vercel>/api/oauth/callback` to
 * `https://orchestrator.fakawholesale.com/oauth/mercadolibre/callback`. The
 * dashboard's start-oauth action only ever reads `ML_CLIENT_ID` +
 * `ML_REDIRECT_URI` (already CC-11-safe), so nothing else has to change.
 *
 * ── Threat model ────────────────────────────────────────────────────────────
 *
 *   - CSRF: enforced via `state` round-trip against `oauth_state` table.
 *     Stale rows (>10 min) are rejected as expired.
 *   - Replay: each `state` row is deleted after first use (single-shot).
 *   - Secret exposure: `ML_CLIENT_SECRET` lives in env, never in any
 *     response body or log line.
 *
 * ── Persistence ─────────────────────────────────────────────────────────────
 *
 * UPSERT into `oauth_tokens` on `(canal, user_id)`. ML rotates BOTH tokens
 * server-side on every refresh, so v2 onwards the cron rewrites them; here
 * we plant the v1 row.
 */

import { NextResponse } from "next/server";
import { exchangeCodeForToken } from "@faka/connectors/mercadolibre";
import { loadMercadoLibreConfig } from "@faka/connectors/mercadolibre";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Next.js Route Handler — `force-dynamic` so the OAuth callback isn't ever
// cached. Each invocation is single-use.
export const dynamic = "force-dynamic";

function redirectToConnectPage(
  origin: string,
  params: Record<string, string>,
): NextResponse {
  const url = new URL("/operacion/conectar-mercadolibre", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 302);
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  // ML can redirect with `?error=access_denied` if the operator cancels.
  if (errParam) {
    return redirectToConnectPage(origin, {
      status: "error",
      reason: errParam,
    });
  }

  if (!code || !state) {
    return redirectToConnectPage(origin, {
      status: "error",
      reason: "missing_code_or_state",
    });
  }

  // [0] Config gate — env must be present to call ML's token endpoint.
  const cfg = loadMercadoLibreConfig();
  if (!cfg.ok) {
    return redirectToConnectPage(origin, {
      status: "error",
      reason: "not_configured",
    });
  }

  const supabase = createServiceRoleClient();

  // [1] Validate state — must exist, must be for this canal, must be unexpired.
  const stateLookup = await supabase
    .from("oauth_state")
    .select("state, canal, expires_at")
    .eq("state", state)
    .eq("canal", "mercadolibre")
    .maybeSingle();
  if (stateLookup.error || !stateLookup.data) {
    return redirectToConnectPage(origin, {
      status: "error",
      reason: "invalid_state",
    });
  }
  const stateRow = stateLookup.data as {
    state: string;
    canal: string;
    expires_at: string;
  };
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    // Expired — clean up + reject.
    await supabase.from("oauth_state").delete().eq("state", state);
    return redirectToConnectPage(origin, {
      status: "error",
      reason: "state_expired",
    });
  }

  // [2] Single-use: delete the state row before exchanging the code. Even if
  // the exchange fails, we never accept the same state twice (defense
  // against replay).
  await supabase.from("oauth_state").delete().eq("state", state);

  // [3] Exchange the code. NEVER logs the secret or the response body.
  const exchange = await exchangeCodeForToken(cfg.cfg, code, supabase);
  if (!exchange.ok) {
    return redirectToConnectPage(origin, {
      status: "error",
      reason: exchange.error,
    });
  }
  const tok = exchange.response;
  const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();

  // [4] UPSERT into oauth_tokens — single-seller invariant means we conflict
  // on (canal, user_id) and rotate the existing row if the same operator
  // re-authorizes the same ML account.
  const upsert = await supabase.from("oauth_tokens").upsert(
    {
      canal: "mercadolibre",
      user_id: String(tok.user_id),
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: expiresAt,
      scope: tok.scope ?? null,
    },
    { onConflict: "canal,user_id" },
  );
  if (upsert.error) {
    return redirectToConnectPage(origin, {
      status: "error",
      reason: `oauth_tokens_upsert_failed:${upsert.error.message}`,
    });
  }

  return redirectToConnectPage(origin, { status: "success" });
}
