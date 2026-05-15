/**
 * Start the Mercado Libre OAuth dance — F2.1 Plan 2.1.3.4.
 *
 * Server Action invoked from the "Conectar Mercado Libre" button on
 * `/operacion/conectar-mercadolibre`. Three responsibilities:
 *
 *   1. Generate a cryptographically-random 32-byte `state` nonce.
 *   2. Persist `(state, canal='mercadolibre')` in `oauth_state` via the
 *      service-role Supabase client. Row expires in 10 min (default
 *      enforced by the migration).
 *   3. Redirect the user to ML Colombia's authorize URL:
 *      `https://auth.mercadolibre.com.co/authorization?response_type=code
 *       &client_id=<ML_CLIENT_ID>&redirect_uri=<ML_REDIRECT_URI>&state=<state>`
 *
 * ── CC-11 invariant ─────────────────────────────────────────────────────────
 *
 * `ML_CLIENT_ID` + `ML_REDIRECT_URI` are read from `process.env` SERVER-SIDE
 * only. They are NOT prefixed `NEXT_PUBLIC_*` and never reach the browser
 * bundle. `ML_CLIENT_SECRET` is NEVER read here — the exchange happens on the
 * callback route (`/api/oauth/callback/route.ts`) which is also server-side.
 *
 * ── CSRF posture ────────────────────────────────────────────────────────────
 *
 * The `state` nonce is the round-trip identity. The callback validates the
 * incoming `state` against `oauth_state` BEFORE exchanging the code; an
 * attacker who tricks the operator into hitting ML's authorize page with a
 * crafted `state` cannot complete the dance because the row would not exist
 * in `oauth_state` (or would belong to a different `canal`).
 *
 * ── Role gate ───────────────────────────────────────────────────────────────
 *
 * The page that hosts this form is gated by the role-matrix entry
 * `/operacion/conectar-mercadolibre: [super_admin, admin]`. Middleware
 * enforces; this server action additionally re-reads the role header for
 * defense-in-depth.
 */

"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { UserRole } from "@faka/schema";

const ML_AUTHORIZE_BASE = "https://auth.mercadolibre.com.co/authorization";

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startMlOAuthAction(): Promise<void> {
  // [0] Defense-in-depth role check — middleware should have blocked already.
  const role = headers().get("x-user-role") as UserRole | null;
  if (role !== "super_admin" && role !== "admin") {
    // Surface as a redirect to forbidden — never throw secret-bearing data.
    redirect("/forbidden");
  }

  // [1] Read env. The page only renders the button when `configured === true`
  // (per `getMLConnectionStatus`), so by the time we reach here these MUST
  // be set. We still guard so a misconfigured deploy doesn't 500 the UI.
  const clientId = process.env.ML_CLIENT_ID?.trim();
  const redirectUri = process.env.ML_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    redirect(
      "/operacion/conectar-mercadolibre?status=error&reason=missing_env",
    );
  }

  // [2] Mint state + PKCE verifier/challenge. ML Colombia enforces PKCE on
  // the app config, so every authorize → exchange round-trip needs a fresh
  // (verifier, challenge) pair. We persist the verifier alongside the
  // state nonce; the callback fetches it back and sends it in the token POST.
  const state = randomBytes(32).toString("hex");
  const codeVerifier = base64Url(randomBytes(64));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());

  const supabase = createServiceRoleClient();
  // Cast: code_verifier column was added in migration 20260615000005 but
  // database.ts hasn't been regenerated yet. Drop this cast once codegen
  // refreshes the Database type.
  const insert = await supabase.from("oauth_state").insert({
    state,
    canal: "mercadolibre",
    redirect_after: "/operacion/conectar-mercadolibre",
    code_verifier: codeVerifier,
  } as unknown as never);
  if (insert.error) {
    redirect(
      `/operacion/conectar-mercadolibre?status=error&reason=oauth_state_insert_failed`,
    );
  }

  // [3] Build the authorize URL — the .co host is the Colombia-specific
  // authorize gateway. ML's docs allow falling back to the .com.ar host with
  // a `site_id` query param, but the .co host is the canonical path for MCO.
  const authorize = new URL(ML_AUTHORIZE_BASE);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  redirect(authorize.toString());
}
