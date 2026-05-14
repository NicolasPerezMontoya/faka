/**
 * Tests for `POST /webhooks/wordpress` — Plan 2.3.1.
 *
 * Coverage (verifies clause from PLAN.md §2.3.1):
 *   (a) valid HMAC + new delivery_id → 200 + raw_orders insert
 *   (b) tampered byte → 401 invalid_signature
 *   (c) duplicate delivery_id → 200 {dedup:true}, NO new raw_orders row
 *   (d) missing delivery_id → 400 missing_delivery_id
 *   (e) stale timestamp > 24h → 401 stale_delivery
 *   (f) env unset → 503 not_configured
 *   (g) unknown topic (`messaging.event`) → handler drops, does NOT write
 *       messaging_log (CC-14)
 *
 * Strategy: mount the route on a fresh Hono app per test, drive it via
 * `app.request(...)` (Hono's in-process test harness — no real socket), and
 * inject a Supabase mock + config loader + deterministic clock through the
 * deps bag. This avoids any real env var or network dependency.
 *
 * Anti-duplication: this file is the encoded form of the grep gate from
 * PLAN.md (`JSON.parse` must appear only AFTER `verifyWooSignature`). Test
 * (b) drives the failure path explicitly so a regression that parses-before-
 * verify can't pass the (b) assertion (the parser would mutate state before
 * we ever called the verifier).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import {
  mountWordPressWebhook,
  type WebhookLogger,
} from "../src/routes/webhooks-wordpress.js";
import type { LoadedWordPressConfig } from "@faka/connectors";

const SECRET = "test-wc-webhook-secret-2026";

const quietLogger: WebhookLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function signBody(body: Buffer, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

/**
 * Build a minimal Supabase chain mock that records every `.from(table).<op>`
 * the route makes. Two tables are touched: `raw_events` (via dedupe upsert)
 * and `raw_orders` (via insert). `messaging_log` MUST stay untouched (CC-14).
 */
interface MockState {
  rawEventsUpserts: Array<Record<string, unknown>>;
  rawOrdersInserts: Array<Record<string, unknown>>;
  messagingLogWrites: Array<Record<string, unknown>>;
  seenDeliveryIds: Set<string>;
  insertError: { message: string } | null;
}

function buildSupabaseMock(state: MockState) {
  const from = vi.fn((table: string) => {
    if (table === "raw_events") {
      return {
        upsert: vi.fn((row: Record<string, unknown>) => {
          const select = vi.fn(async () => {
            state.rawEventsUpserts.push(row);
            const payload = row.payload_json as
              | { _delivery_id?: string }
              | undefined;
            const id = payload?._delivery_id;
            if (id && state.seenDeliveryIds.has(id)) {
              // Conflict → ignoreDuplicates returns 0 rows.
              return { data: [], error: null };
            }
            if (id) state.seenDeliveryIds.add(id);
            return { data: [{ id: "mock-row-id" }], error: null };
          });
          return { select };
        }),
      };
    }
    if (table === "raw_orders") {
      return {
        insert: vi.fn(async (row: Record<string, unknown>) => {
          state.rawOrdersInserts.push(row);
          if (state.insertError) return { error: state.insertError };
          return { error: null };
        }),
      };
    }
    if (table === "messaging_log") {
      return {
        insert: vi.fn(async (row: Record<string, unknown>) => {
          state.messagingLogWrites.push(row);
          return { error: null };
        }),
        upsert: vi.fn(async (row: Record<string, unknown>) => {
          state.messagingLogWrites.push(row);
          return { error: null };
        }),
      };
    }
    return { insert: vi.fn(), upsert: vi.fn(), update: vi.fn() };
  });
  return { from };
}

function freshState(): MockState {
  return {
    rawEventsUpserts: [],
    rawOrdersInserts: [],
    messagingLogWrites: [],
    seenDeliveryIds: new Set(),
    insertError: null,
  };
}

function configuredLoader(): () => LoadedWordPressConfig {
  return () => ({
    ok: true,
    apiUrl: "https://wc.example.test",
    apiKey: "ck_test",
    apiSecret: "cs_test",
    webhookSecret: SECRET,
  });
}

function notConfiguredLoader(): () => LoadedWordPressConfig {
  return () => ({ ok: false, reason: "not_configured" });
}

function buildApp(opts: {
  state?: MockState;
  loader?: () => LoadedWordPressConfig;
  now?: () => number;
}) {
  const state = opts.state ?? freshState();
  const supabase = buildSupabaseMock(state);
  const app = new Hono();
  mountWordPressWebhook(app, {
    getSupabase: () => supabase as never,
    loadConfig: opts.loader ?? configuredLoader(),
    logger: quietLogger,
    now: opts.now,
  });
  return { app, state, supabase };
}

function postWebhook(
  app: Hono,
  body: Buffer,
  headers: Record<string, string>,
): Promise<Response> {
  return app.request("/webhooks/wordpress", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

const FIXED_NOW_MS = Date.UTC(2026, 4, 15, 12, 0, 0); // 2026-05-15T12:00:00Z

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("POST /webhooks/wordpress", () => {
  // ── (a) valid HMAC + new delivery_id → 200 + raw_orders insert ──────────
  it("accepts a valid signature and inserts into raw_orders", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const payload = { id: 4321, status: "completed", total: "150.00" };
    const raw = Buffer.from(JSON.stringify(payload), "utf-8");
    const tsSec = Math.floor(FIXED_NOW_MS / 1000);

    const res = await postWebhook(app, raw, {
      "x-wc-webhook-signature": signBody(raw),
      "x-wc-webhook-delivery-id": "wc-delivery-001",
      "x-wc-webhook-topic": "order.updated",
      "x-wc-webhook-timestamp": String(tsSec),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; dedup?: boolean };
    expect(body.ok).toBe(true);
    expect(body.dedup).toBeUndefined();

    expect(state.rawOrdersInserts).toHaveLength(1);
    const inserted = state.rawOrdersInserts[0]!;
    expect(inserted.canal).toBe("wordpress");
    expect(inserted.processed).toBe(false);
    const payloadOut = inserted.payload_json as Record<string, unknown>;
    expect(payloadOut.id).toBe(4321);
    expect(payloadOut._topic).toBe("order.updated");
    expect(payloadOut._delivery_id).toBe("wc-delivery-001");

    expect(state.rawEventsUpserts).toHaveLength(1);
    expect(state.messagingLogWrites).toHaveLength(0); // CC-14
  });

  // ── (b) tampered byte → 401 invalid_signature ───────────────────────────
  it("rejects with 401 invalid_signature when the body has been tampered with", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const original = Buffer.from(
      JSON.stringify({ id: 4321, status: "completed" }),
      "utf-8",
    );
    const sig = signBody(original);
    const tampered = Buffer.from(original);
    tampered[10] = tampered[10]! ^ 0x01;

    const res = await postWebhook(app, tampered, {
      "x-wc-webhook-signature": sig,
      "x-wc-webhook-delivery-id": "wc-delivery-tamper",
      "x-wc-webhook-topic": "order.updated",
      "x-wc-webhook-timestamp": String(Math.floor(FIXED_NOW_MS / 1000)),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_signature");

    // INVARIANT: no side effects when signature fails. raw_orders MUST NOT
    // have been touched, and (critically) raw_events MUST NOT have been
    // touched either — the dedupe write happens AFTER verify per Pattern 1.
    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(0);
    expect(state.messagingLogWrites).toHaveLength(0);
  });

  // ── (c) duplicate delivery_id → 200 {dedup:true}, no new raw_orders row ─
  it("returns 200 dedup:true on duplicate delivery_id and skips the raw_orders insert", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    // Pre-seed the dedupe table so the second call hits the conflict path.
    state.seenDeliveryIds.add("wc-delivery-dup");

    const payload = { id: 9999, status: "processing" };
    const raw = Buffer.from(JSON.stringify(payload), "utf-8");
    const res = await postWebhook(app, raw, {
      "x-wc-webhook-signature": signBody(raw),
      "x-wc-webhook-delivery-id": "wc-delivery-dup",
      "x-wc-webhook-topic": "order.created",
      "x-wc-webhook-timestamp": String(Math.floor(FIXED_NOW_MS / 1000)),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; dedup?: boolean };
    expect(body.ok).toBe(true);
    expect(body.dedup).toBe(true);

    // raw_orders NEVER got the duplicate.
    expect(state.rawOrdersInserts).toHaveLength(0);
    // raw_events still got the upsert attempt (that's where the conflict is
    // detected) — exactly one attempt.
    expect(state.rawEventsUpserts).toHaveLength(1);
  });

  // ── (d) missing delivery_id → 400 missing_delivery_id ───────────────────
  it("returns 400 missing_delivery_id when the x-wc-webhook-delivery-id header is absent", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const raw = Buffer.from(JSON.stringify({ id: 1 }), "utf-8");
    const res = await postWebhook(app, raw, {
      "x-wc-webhook-signature": signBody(raw),
      "x-wc-webhook-topic": "order.updated",
      "x-wc-webhook-timestamp": String(Math.floor(FIXED_NOW_MS / 1000)),
      // no x-wc-webhook-delivery-id
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_delivery_id");
    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(0);
  });

  // ── (e) stale timestamp > 24h → 401 stale_delivery ──────────────────────
  it("rejects with 401 stale_delivery when x-wc-webhook-timestamp is older than 24h", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const raw = Buffer.from(JSON.stringify({ id: 2 }), "utf-8");
    const staleTsSec = Math.floor(
      (FIXED_NOW_MS - 25 * 60 * 60 * 1000) / 1000, // 25h ago
    );

    const res = await postWebhook(app, raw, {
      "x-wc-webhook-signature": signBody(raw),
      "x-wc-webhook-delivery-id": "wc-delivery-stale",
      "x-wc-webhook-topic": "order.updated",
      "x-wc-webhook-timestamp": String(staleTsSec),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("stale_delivery");
    expect(state.rawOrdersInserts).toHaveLength(0);
    // Dedupe was NOT touched — the stale check happens before dedupe.
    expect(state.rawEventsUpserts).toHaveLength(0);
  });

  // ── (f) env unset → 503 not_configured ──────────────────────────────────
  it("returns 503 not_configured when WordPress env vars are not set", async () => {
    const { app, state } = buildApp({
      loader: notConfiguredLoader(),
      now: () => FIXED_NOW_MS,
    });
    const raw = Buffer.from(JSON.stringify({ id: 3 }), "utf-8");

    const res = await postWebhook(app, raw, {
      "x-wc-webhook-signature": signBody(raw),
      "x-wc-webhook-delivery-id": "wc-delivery-degraded",
      "x-wc-webhook-topic": "order.updated",
      "x-wc-webhook-timestamp": String(Math.floor(FIXED_NOW_MS / 1000)),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("not_configured");
    expect(body.message).toMatch(/not configured/i);

    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(0);
  });

  // ── (g) unknown topic → handler drops, NO messaging_log write (CC-14) ───
  it("drops unknown topics (e.g. messaging.event) without writing messaging_log or raw_orders (CC-14)", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const raw = Buffer.from(
      JSON.stringify({ event: "subscription.cancelled" }),
      "utf-8",
    );
    const res = await postWebhook(app, raw, {
      "x-wc-webhook-signature": signBody(raw),
      "x-wc-webhook-delivery-id": "wc-delivery-msg",
      "x-wc-webhook-topic": "messaging.event",
      "x-wc-webhook-timestamp": String(Math.floor(FIXED_NOW_MS / 1000)),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      dropped?: boolean;
      dedup?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.dropped).toBe(true);

    // The dedupe row STILL gets written (idempotency across retries even for
    // unsupported topics), but the canonical durable-queue write does NOT.
    expect(state.rawEventsUpserts).toHaveLength(1);
    expect(state.rawOrdersInserts).toHaveLength(0);
    // CC-14: zero messaging_log writes from the webhook receive path.
    expect(state.messagingLogWrites).toHaveLength(0);
  });

  // ── Defense-in-depth: missing signature → 401 (verifyWooSignature handles
  // the empty/undefined header path internally; we just verify the surface).
  it("returns 401 invalid_signature when x-wc-webhook-signature header is absent", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const raw = Buffer.from(JSON.stringify({ id: 4 }), "utf-8");

    const res = await postWebhook(app, raw, {
      "x-wc-webhook-delivery-id": "wc-delivery-nosig",
      "x-wc-webhook-topic": "order.updated",
      "x-wc-webhook-timestamp": String(Math.floor(FIXED_NOW_MS / 1000)),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_signature");
    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(0);
  });
});
