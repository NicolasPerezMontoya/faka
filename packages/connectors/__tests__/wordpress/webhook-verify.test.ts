/**
 * Tests for the WooCommerce webhook HMAC verifier (Plan 2.2.1).
 *
 * Coverage:
 *   1. Valid signature against the canonical raw body is accepted.
 *   2. A single-byte body tampering produces a different signature → rejected.
 *   3. timingSafeEqual short-circuits on unequal-length buffers; we exercise
 *      that path via a deliberately shorter signature header.
 *   4. Missing / empty signature header is rejected (no exceptions).
 *   5. Missing / empty secret is rejected.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWooSignature } from "../../src/wordpress/webhook-verify.js";

const SECRET = "wc-webhook-secret-xyz-2026";

function signBody(body: Buffer, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyWooSignature", () => {
  it("accepts a valid signature on the canonical raw body", () => {
    const raw = Buffer.from(
      JSON.stringify({ id: 4321, status: "completed" }),
      "utf-8",
    );
    const sig = signBody(raw);
    expect(verifyWooSignature(raw, sig, SECRET)).toBe(true);
  });

  it("rejects when a single byte of the body has been tampered with", () => {
    const original = Buffer.from(
      JSON.stringify({ id: 4321, status: "completed" }),
      "utf-8",
    );
    const sig = signBody(original);
    // Flip a single byte after signing — the signature is now stale.
    const tampered = Buffer.from(original);
    tampered[10] = tampered[10] ^ 0x01;
    expect(verifyWooSignature(tampered, sig, SECRET)).toBe(false);
  });

  it("rejects when signature length differs from expected (timing-safe equal-length guard)", () => {
    const raw = Buffer.from("payload", "utf-8");
    // Base64 of "x" is "eA==" — guaranteed to decode to a length-1 buffer,
    // which cannot match the 32-byte SHA-256 digest. This drives the
    // `expectedBuf.length !== actualBuf.length` short-circuit path.
    const tooShort = "eA==";
    expect(verifyWooSignature(raw, tooShort, SECRET)).toBe(false);
  });

  it("rejects when signature header is missing or empty", () => {
    const raw = Buffer.from("payload", "utf-8");
    expect(verifyWooSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyWooSignature(raw, "", SECRET)).toBe(false);
  });

  it("rejects when secret is empty", () => {
    const raw = Buffer.from("payload", "utf-8");
    const sig = signBody(raw, "anything");
    expect(verifyWooSignature(raw, sig, "")).toBe(false);
  });

  it("rejects rather than throws on malformed base64 input", () => {
    const raw = Buffer.from("payload", "utf-8");
    // Buffer.from(base64) is lenient but never throws — verify the function
    // still returns false rather than ever throwing.
    expect(() =>
      verifyWooSignature(raw, "###not-base64###", SECRET),
    ).not.toThrow();
    expect(verifyWooSignature(raw, "###not-base64###", SECRET)).toBe(false);
  });
});
