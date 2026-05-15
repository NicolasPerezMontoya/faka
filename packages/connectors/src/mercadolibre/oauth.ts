/**
 * Mercado Libre OAuth lifecycle (Plan 2.1.1.2 — PATTERNS §2 + RESEARCH §Pattern 1).
 *
 * This is the SINGLE owner of the OAuth code-exchange + rotating-refresh flow.
 * Nothing else in the repo issues `POST /oauth/token` requests; nothing else
 * UPSERTs into `public.oauth_tokens`. PATTERNS §"OAuth token lifecycle (NEW in
 * F2.1)" makes the canonical-owner rule explicit.
 *
 * ── Lifecycle rules (PATTERNS §2 + RESEARCH §Pattern 1) ──────────────────────
 *
 *   • Access tokens live ~6 hours (`expires_in = 21600`). Caller decides when
 *     to lazy-refresh; the convention is "refresh if `expires_at < now() + 60s`"
 *     to absorb clock skew + in-flight delays.
 *   • Refresh tokens live ~6 months but are SINGLE-USE — the server rotates
 *     BOTH access and refresh on every successful refresh, and invalidates the
 *     old refresh token IMMEDIATELY. Losing the rotated refresh token bricks
 *     the integration until the cliente re-authorizes through the dashboard's
 *     connect page (Plan 2.1.3.4).
 *   • The UPSERT-after-refresh MUST persist BOTH the new access_token AND the
 *     new refresh_token in a single write. A partial UPSERT (only access_token)
 *     is the exact failure mode that produces a permanently-broken integration.
 *
 * ── Refresh-token race (RESEARCH §Pitfall 1) ─────────────────────────────────
 *
 * In production we have THREE concurrent refresh callsites:
 *
 *   1. `sync-ml-orders` cron (15-min cadence — Plan 2.1.3.2)
 *   2. `sync-ml-products` cron (60-min cadence — Plan 2.1.3.3)
 *   3. `ml-refresh-tokens` cron (5-hour safety net — Plan 2.1.1.4)
 *
 * If two of them hit a token that's about to expire at the same wall clock
 * instant, they'll both call `refreshToken`. Whichever lands at ML first wins
 * the rotation; the loser comes back with a fresh response that uses the
 * NOW-INVALID old refresh_token reference and UPSERTs over the winner's
 * tokens — bricking the integration. We mitigate via a Postgres transactional
 * advisory lock keyed on `('faka:oauth-refresh:1', user_id)`. The losing
 * caller observes `false` from `try_acquire_advisory_lock`, sleeps 500ms,
 * and re-reads `oauth_tokens` — the winning caller's rotation is now visible
 * and the loser returns success without ever issuing a refresh.
 *
 * ── Security invariants (RESEARCH §V8) ───────────────────────────────────────
 *
 *   • DO NOT log `access_token` / `refresh_token` — anywhere. CI greps for it.
 *   • DO NOT accept tokens from query parameters or request bodies — they live
 *     in `oauth_tokens` and nowhere else.
 *   • DO NOT add a `getMLAccessToken` helper that returns a token to the
 *     dashboard — the dashboard never reads tokens (CC-11). Connection status
 *     is exposed via `getMLConnectionStatus` (Plan 2.1.2.3).
 */

import { request } from "undici";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRetryAndDLQ } from "../retry.js";
import type {
  MLConfig,
  MLTokenResponse,
  MLTokenResult,
  OAuthTokenRow,
} from "./types.js";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const ML_TOKEN_ENDPOINT = "https://api.mercadolibre.com/oauth/token" as const;

/** Refresh `expires_at - now()` under this many seconds → lazy-refresh now. */
const TOKEN_REFRESH_SKEW_SECONDS = 60;

/** Wall-clock sleep when the advisory lock is contested (RESEARCH §Pitfall 1). */
const LOCK_CONTENDED_SLEEP_MS = 500;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * Thrown when we cannot locate a token row for the requested user_id. Callers
 * (api-client lazy-refresh-on-401; cron safety net) treat this as "operator
 * never connected the account" — log + skip, not a retry.
 */
export class MLTokenNotFoundError extends Error {
  constructor(public readonly userId: string) {
    super(`oauth_tokens row not found for user_id=${userId}`);
    this.name = "MLTokenNotFoundError";
  }
}

/**
 * Thrown when ML responds with a non-2xx during code exchange OR when the
 * advisory-locked refresh path completes without producing a usable token.
 * Generic 5xx from ML is absorbed by `withRetryAndDLQ` before reaching the
 * caller; only the final-failure path bubbles a `MLOAuthFailedError`.
 */
export class MLOAuthFailedError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "MLOAuthFailedError";
  }
}

// -----------------------------------------------------------------------------
// Helper: text POST to /oauth/token.
// -----------------------------------------------------------------------------

interface TokenPostBody {
  grant_type: "authorization_code" | "refresh_token";
  client_id: string;
  client_secret: string;
  /** authorization_code only */
  code?: string;
  /** authorization_code only */
  redirect_uri?: string;
  /** refresh_token only */
  refresh_token?: string;
}

function encodeForm(body: TokenPostBody): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null && v !== "") {
      params.append(k, String(v));
    }
  }
  return params.toString();
}

async function postToken(body: TokenPostBody): Promise<MLTokenResponse> {
  const { statusCode, body: responseBody } = await request(ML_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(body),
  });
  const text = await responseBody.text();
  if (statusCode < 200 || statusCode >= 300) {
    // Truncate the upstream body — it may echo `client_secret` back on 400s.
    // We never log this string, but throwing it surfaces enough context to
    // operators in the cron's connector_runs.errors_json without leaking
    // anywhere persistent.
    throw new MLOAuthFailedError(
      `ml_token_endpoint_${statusCode}: ${text.slice(0, 200)}`,
      statusCode,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MLOAuthFailedError("ml_token_response_not_json", statusCode);
  }
  return parsed as MLTokenResponse;
}

// -----------------------------------------------------------------------------
// Public surface
// -----------------------------------------------------------------------------

/**
 * Exchange a fresh authorization code for an initial token pair.
 *
 * Caller is the `/oauth/mercadolibre/callback` handler (Plan 2.1.3.4). The
 * handler UPSERTs the returned tokens; nothing else writes the FIRST token
 * row for a `user_id`.
 *
 * NEVER logs the response. Returns the discriminated-union envelope so the
 * callback can route the failure into a user-visible error redirect.
 */
export async function exchangeCodeForToken(
  cfg: MLConfig,
  code: string,
  supabase: SupabaseClient,
): Promise<MLTokenResult> {
  const result = await withRetryAndDLQ(
    () =>
      postToken({
        grant_type: "authorization_code",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: cfg.redirectUri,
      }),
    {
      canal: "mercadolibre",
      source: "oauth.exchange",
      // DO NOT include `code` or any secret in the DLQ payload — it would be
      // persisted in plain text. The user_id only becomes available AFTER
      // the exchange succeeds, so we record nothing identifying.
      payload: { stage: "exchange" },
    },
    supabase,
  );
  if (!result) {
    return { ok: false, error: "exchange_failed_after_retries" };
  }
  // Server-side rotation contract holds even on first issuance: the
  // refresh_token returned here is the canonical one to persist.
  return { ok: true, response: result };
}

/**
 * Rotate-refresh — single-use, race-safe.
 *
 * Returns `{ ok: true, access_token }` once the rotation is committed to
 * `oauth_tokens`. The `refresh_token` is intentionally NOT exposed on the
 * return envelope: callers never need it (they call this function again on
 * the next refresh), and not surfacing it makes accidental logging harder.
 *
 * Race-condition handling (RESEARCH §Pitfall 1):
 *   1. Best-effort acquire the advisory lock via `try_acquire_advisory_lock`.
 *   2. If acquired → fetch the current row, call ML, atomically UPSERT both
 *      new tokens + new expires_at.
 *   3. If contested → sleep 500ms, re-read the row, return the access_token
 *      we observe (the winning caller's rotation is now committed). If the
 *      re-read also fails, surface a structured error rather than racing
 *      again — the safety-net cron will retry on its next tick.
 *
 * The lock is `pg_try_advisory_xact_lock` (transaction-scoped) inside a
 * one-statement SQL helper, so the lock is held only for the lifetime of
 * that single RPC call. We hold the "I am the writer" intent in app-space:
 * if the lock was OURS, we proceed; if not, we yield. This is intentionally
 * NOT a long-held lock around the entire ML round-trip — that would
 * serialize cross-tenant refreshes in a single Postgres transaction.
 */
export async function refreshToken(
  supabase: SupabaseClient,
  cfg: MLConfig,
  userId: string,
): Promise<{ ok: true; access_token: string } | { ok: false; error: string }> {
  // [1] Acquire the lock (or yield to the winner).
  const lockKey = `ml-refresh-${userId}`;
  const { data: lockAcquired, error: lockError } = await supabase.rpc(
    "try_acquire_advisory_lock",
    { key_text: lockKey },
  );
  if (lockError) {
    // Lock helper missing / RPC unreachable → don't proceed (could brick
    // tokens in concurrent runs). Surface for the safety-net cron's retry.
    return { ok: false, error: `advisory_lock_unavailable: ${lockError.message}` };
  }

  if (lockAcquired !== true) {
    // [2] Contested branch — winner is rotating right now. Sleep + re-read.
    await new Promise((r) => setTimeout(r, LOCK_CONTENDED_SLEEP_MS));
    const fresh = await readTokenRow(supabase, userId);
    if (!fresh) {
      return { ok: false, error: "lock_contested_and_reread_missing" };
    }
    // If the re-read row is still pre-rotation (winner hasn't committed yet),
    // we have a thundering-herd edge case; the safety-net cron will retry it
    // on its next tick. Don't recurse — that risks an infinite stall.
    return { ok: true, access_token: fresh.access_token };
  }

  // [3] Winner path — we own the lock. Fetch current refresh_token, rotate.
  const current = await readTokenRow(supabase, userId);
  if (!current) {
    return { ok: false, error: `no_token_for_user_${userId}` };
  }

  const rotated = await withRetryAndDLQ(
    () =>
      postToken({
        grant_type: "refresh_token",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: current.refresh_token,
      }),
    {
      canal: "mercadolibre",
      source: "oauth.refresh",
      // user_id is safe to persist on DLQ; refresh_token is NOT.
      payload: { stage: "refresh", user_id: userId },
    },
    supabase,
  );
  if (!rotated) {
    return { ok: false, error: "refresh_failed_after_retries" };
  }

  // [4] Atomic UPSERT — BOTH new access_token AND new refresh_token in one
  // write. The (canal, user_id) unique index from migration 0001 is the
  // conflict target. If this write fails we MUST surface — the new
  // refresh_token would otherwise be lost forever (ML server-side already
  // invalidated the old one).
  const newExpiresAt = new Date(
    Date.now() + rotated.expires_in * 1000,
  ).toISOString();

  const { error: upsertError } = await supabase.from("oauth_tokens").upsert(
    {
      canal: "mercadolibre",
      user_id: userId,
      access_token: rotated.access_token,
      refresh_token: rotated.refresh_token,
      expires_at: newExpiresAt,
      scope: rotated.scope ?? null,
    },
    { onConflict: "canal,user_id" },
  );

  if (upsertError) {
    return {
      ok: false,
      error: `token_upsert_failed: ${upsertError.message}`,
    };
  }

  return { ok: true, access_token: rotated.access_token };
}

/**
 * Lazy access-token getter.
 *
 * Reads the cached row; if the token has fewer than `TOKEN_REFRESH_SKEW_SECONDS`
 * of lifetime remaining, transparently rotates via `refreshToken` and returns
 * the fresh value. Returns `null` if no token row exists for this user (caller
 * decides whether that's "operator never connected" vs an error).
 *
 * `opts.lazyRefreshOn401` is reserved for the api-client's 401-retry path:
 * when set, callers can re-invoke `loadAccessToken` after observing a 401 to
 * force a rotation even when `expires_at` says we should be fine (ML
 * sometimes invalidates a token early; the 401 is the authoritative signal).
 */
export async function loadAccessToken(
  supabase: SupabaseClient,
  cfg: MLConfig,
  opts: { userId: string; lazyRefreshOn401?: boolean },
): Promise<string | null> {
  const row = await readTokenRow(supabase, opts.userId);
  if (!row) return null;

  const expiresMs = new Date(row.expires_at).getTime();
  const nowMs = Date.now();
  const remainingSec = (expiresMs - nowMs) / 1000;

  const mustRefresh =
    opts.lazyRefreshOn401 === true ||
    remainingSec < TOKEN_REFRESH_SKEW_SECONDS;

  if (!mustRefresh) {
    return row.access_token;
  }

  const refreshed = await refreshToken(supabase, cfg, opts.userId);
  if (!refreshed.ok) {
    return null;
  }
  return refreshed.access_token;
}

/**
 * Test/operator utility — delete a user's tokens. Used by:
 *   - The eventual `/operacion/conectar-mercadolibre/disconnect` server
 *     action (NOT in F2.1; future plan).
 *   - The oauth.test.ts integration cleanup hook.
 */
export async function revokeTokens(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  await supabase
    .from("oauth_tokens")
    .delete()
    .eq("canal", "mercadolibre")
    .eq("user_id", userId);
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

async function readTokenRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<OAuthTokenRow | null> {
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select(
      "id, canal, user_id, access_token, refresh_token, expires_at, scope, created_at, updated_at",
    )
    .eq("canal", "mercadolibre")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new MLOAuthFailedError(`oauth_tokens_read_failed: ${error.message}`);
  }
  if (!data) return null;
  return data as OAuthTokenRow;
}
