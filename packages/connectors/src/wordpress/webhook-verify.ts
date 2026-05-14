/**
 * WooCommerce webhook HMAC verifier (Plan 2.2.1, RESEARCH §Pattern 1 verbatim).
 *
 * WooCommerce signs each delivery with:
 *   base64(HMAC-SHA256(secret, RAW_REQUEST_BODY))
 * sent in the `x-wc-webhook-signature` header.
 *
 * CRITICAL — Pitfall 2 (RESEARCH): the body MUST be the raw bytes that the
 * HTTP server received, NOT a re-stringified parsed JSON. If you let Express
 * (or Next.js) parse the body with `application/json` before verifying, the
 * re-serialization will differ from WC's (key ordering, whitespace, escaping)
 * and signatures will spuriously fail. The handler MUST use a raw body parser
 * — `express.raw({ type: 'application/json' })` or the equivalent on Next's
 * App Router (Web `Request.arrayBuffer()` → Buffer).
 *
 * TypeScript surface enforces Buffer-only via a `string` overload that
 * resolves to `never` — passing a string will fail to compile.
 *
 * F2.1 ML webhook verification will compose around this primitive (the
 * Mercado Libre signature scheme is HMAC-SHA256 too but reads the secret
 * from a different env and uses a distinct header name); the constant-time
 * compare + base64 envelope is reusable.
 */

import * as nodeCrypto from "node:crypto";

const { createHmac } = nodeCrypto;

// Overload: reject `string` at the type level (Pitfall 2 enforcement).
// Passing a string returns `never`, so TypeScript flags any downstream use
// of the return value as the contradiction it is — the call is statically
// poisoned, forcing the handler to pass a real Buffer.
export function verifyWooSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): never;
export function verifyWooSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean;
export function verifyWooSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (typeof rawBody === "string") {
    // Defense in depth — the overload should already have rejected this at
    // compile time. At runtime, refuse to sign a re-stringified body.
    return false;
  }
  if (!signatureHeader || typeof signatureHeader !== "string") return false;
  if (!secret || secret.length === 0) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");

  // base64 decode both sides so the constant-time compare sees equal-length buffers.
  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "base64");
    actualBuf = Buffer.from(signatureHeader, "base64");
  } catch {
    return false;
  }

  // Constant-time compare REQUIRES equal-length inputs — short-circuit otherwise.
  if (expectedBuf.length !== actualBuf.length) return false;
  return nodeCrypto.timingSafeEqual(expectedBuf, actualBuf);
}
