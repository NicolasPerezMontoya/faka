/**
 * Mercado Libre webhook signature verifier — Plan 2.1.3.1.
 *
 * ML signs webhook notifications with HMAC-SHA256 using the developer app's
 * Client Secret. UNLIKE WooCommerce (which signs the raw request body),
 * Mercado Libre signs a CANONICAL STRING composed of six named query params:
 *
 *   topic;user_id;application_id;attempts;sent;received
 *
 * concatenated as `name:value` pairs in that exact order. The signature
 * arrives in the `x-signature` HTTP header (or, defensively, as a `signature`
 * query parameter on some legacy delivery paths) hex-encoded.
 *
 * ── HMAC-PATTERN-DIVERGENCE invariant (PATTERNS §"HMAC-PATTERN-DIVERGENCE
 * (NEW for F2.1)") ─────────────────────────────────────────────────────────
 *
 * `verifyWooSignature` (`@faka/connectors/wordpress/webhook-verify`) and
 * `verifyMLSignature` are structurally DIFFERENT:
 *
 *   - WP signs raw bytes  → Buffer input, base64 sig.
 *   - ML signs query params → URLSearchParams input, hex sig.
 *
 * They are NOT interchangeable. Calling one on the other channel's deliveries
 * will silently fail every signature check. We keep two parallel
 * implementations rather than refactoring to a shared `createHmacVerifier`
 * abstraction — the canonicalization step is sufficiently different that the
 * shared abstraction would be a generic-typed pass-through that obscures the
 * per-channel envelope more than it shares. PATTERNS §"Open coordination items
 * #3" recommends deferring any shared-verifier refactor to F3 (POS) once a
 * third HMAC-SHA256 webhook lands and the canonical-string variability
 * stabilizes.
 *
 * ── Inputs are sanitized; throws are forbidden ──────────────────────────────
 *
 * `verifyMLSignature` MUST return `false` (not throw) on every malformed
 * input: missing header, wrong-length hex, non-hex characters, missing
 * required params. The orchestrator's webhook receive path uses the boolean
 * return as a guard before any DB write — throws would bypass the dedupe +
 * persist guard and ack the upstream prematurely.
 *
 * ── Buffer-only crypto path ─────────────────────────────────────────────────
 *
 * `createHmac` + `timingSafeEqual` operate on `Buffer` instances. The hex
 * decode is done via `Buffer.from(sig, "hex")` with a length check so a
 * tampered odd-length string can't crash the constant-time compare.
 */

import * as nodeCrypto from "node:crypto";

const { createHmac, timingSafeEqual } = nodeCrypto;

/**
 * Canonical ordering for ML's signature input. The six required keys, in the
 * order ML's docs prescribe. Missing keys collapse to the empty string so
 * the signature stays computable across body shapes (e.g. some legacy ML
 * deliveries omit `application_id`); a mismatched empty value still has to
 * match the sender's empty value or the HMAC fails.
 */
export const ML_SIGNED_PARAMS = [
  "topic",
  "user_id",
  "application_id",
  "attempts",
  "sent",
  "received",
] as const;

/**
 * Build the canonical string ML signs. Joins the six signed params as
 * `name:value` pairs separated by `;` in `ML_SIGNED_PARAMS` order.
 *
 * Accepts either `URLSearchParams` (what Hono hands you on a request) or a
 * plain `Record<string,string>` (what tests can construct inline). Returns
 * a stable lowercased-on-hex output suitable for `timingSafeEqual` of the
 * HMAC digest.
 */
export function buildMLCanonicalString(
  query: URLSearchParams | Record<string, string | string[] | undefined>,
): string {
  const get = (name: string): string => {
    if (query instanceof URLSearchParams) {
      return query.get(name) ?? "";
    }
    const v = query[name];
    if (v == null) return "";
    if (Array.isArray(v)) return v[0] ?? "";
    return v;
  };
  return ML_SIGNED_PARAMS.map((k) => `${k}:${get(k)}`).join(";");
}

/**
 * Constant-time HMAC-SHA256 verification of an ML webhook signature.
 *
 *   - `query`       — URLSearchParams (request.url's searchParams) OR a plain
 *                     `{ topic, user_id, ... }` object. Either way the six
 *                     signed params are read by name; everything else is
 *                     ignored (extra params do NOT contribute to the
 *                     signature).
 *   - `signatureHex`— hex-encoded HMAC digest from the `x-signature` header
 *                     or `signature` query param. Case-insensitive. Returns
 *                     `false` on any malformed input.
 *   - `secret`      — the developer app's Client Secret (NOT the access token).
 *
 * Returns `true` ONLY when the computed digest equals the provided digest
 * via `timingSafeEqual`. NEVER throws.
 */
export function verifyMLSignature(
  query: URLSearchParams | Record<string, string | string[] | undefined>,
  signatureHex: string | undefined | null,
  secret: string,
): boolean {
  if (!signatureHex || typeof signatureHex !== "string") return false;
  if (!secret || typeof secret !== "string" || secret.length === 0) {
    return false;
  }

  const canonical = buildMLCanonicalString(query);
  const expected = createHmac("sha256", secret).update(canonical).digest(); // Buffer

  // Decode the provided hex defensively. Buffer.from with 'hex' silently
  // drops invalid characters, which is exactly the wrong behavior for a
  // signature check — we want any tamper to surface as a mismatch, not a
  // shortened-but-valid-looking decode. So we pre-validate the hex shape.
  const trimmed = signatureHex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) return false;
  if (trimmed.length % 2 !== 0) return false;

  const actual = Buffer.from(trimmed, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(expected, actual);
}
