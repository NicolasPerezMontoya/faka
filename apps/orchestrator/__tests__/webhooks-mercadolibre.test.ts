/**
 * Tests for `POST /webhooks/mercadolibre` — Plan 2.1.3.1.
 *
 * Coverage mirror of the WordPress webhook test suite (cases a-g) with the
 * signed-query-params verify substituted for the body-HMAC verify:
 *
 *   (a) valid signed query   + new notification id → 200 + raw_orders insert
 *   (b) tampered signature                         → 401 invalid_signature
 *   (c) duplicate notification id                  → 200 {dedup:true}, no row
 *   (d) missing topic                              → 400 missing_topic
 *   (e) stale `sent` > 24h                         → 401 stale_delivery
 *   (f) env unset                                  → 503 not_configured
 *   (g) unknown topic (`messages`)                 → 200 dropped, no row,
 *                                                    no messaging_log writes
 *
 * Strategy: mount the route on a fresh Hono app per test, drive it via
 * `app.request(...)`, and inject a Supabase mock + config loader +
 * deterministic clock through the deps bag. No env var or network is used.
 *
 * Anti-duplication: this test file uses the production `verifyMLSignature`
 * indirectly — it computes the expected hex digest the SAME way the
 * verifier does (createHmac sha256 over the canonical string) so a
 * regression in the canonicalization function fails (a) immediately.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import {
  mountMercadoLibreWebhook,
  type WebhookLogger,
} from "../src/routes/webhooks-mercadolibre.js";
import {
  ML_SIGNED_PARAMS,
  type LoadedMLConfig,
} from "@faka/connectors/mercadolibre";

const SECRET = "test-ml-webhook-secret-2026";
const APP_ID = "3933497047128728";

const quietLogger: WebhookLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Build a canonical-string signature using the SAME algorithm the verifier
 * uses. Mirror of `buildMLCanonicalString` — kept inline so a regression in
 * the production canonicalization causes the (a) test to fail loudly rather
 * than silently agreeing with itself.
 */
function signQuery(
  params: Record<string, string>,
  secret = SECRET,
): string {
  const canonical = ML_SIGNED_PARAMS.map((k) => `${k}:${params[k] ?? ""}`).join(
    ";",
  );
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

/**
 * Minimal Supabase chain mock recording every `.from(table).<op>`. The route
 * touches `raw_events` (dedupe upsert) + `raw_orders` (insert) only.
 * `messaging_log` MUST stay untouched (CC-14).
 */
interface MockState {
  rawEventsUpserts: Array<Record<string, unknown>>;
  rawOrdersInserts: Array<Record<string, unknown>>;
  messagingLogWrites: Array<Record<string, unknown>>;
  seenNotificationIds: Set<string>;
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
            if (id && state.seenNotificationIds.has(id)) {
              return { data: [], error: null };
            }
            if (id) state.seenNotificationIds.add(id);
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
    seenNotificationIds: new Set(),
    insertError: null,
  };
}

function configuredLoader(): () => LoadedMLConfig {
  return () => ({
    ok: true,
    cfg: {
      clientId: APP_ID,
      clientSecret: "test-secret",
      redirectUri: "https://orchestrator.example.test/oauth/mercadolibre/callback",
      webhookSecret: SECRET,
      siteId: "MCO",
    },
  });
}

function notConfiguredLoader(): () => LoadedMLConfig {
  return () => ({
    ok: false,
    reason: "not_configured",
    missing: ["ML_CLIENT_ID", "ML_WEBHOOK_SECRET"],
  });
}

function buildApp(opts: {
  state?: MockState;
  loader?: () => LoadedMLConfig;
  now?: () => number;
}) {
  const state = opts.state ?? freshState();
  const supabase = buildSupabaseMock(state);
  const app = new Hono();
  mountMercadoLibreWebhook(app, {
    getSupabase: () => supabase as never,
    loadConfig: opts.loader ?? configuredLoader(),
    logger: quietLogger,
    now: opts.now,
  });
  return { app, state, supabase };
}

function postWebhook(
  app: Hono,
  params: Record<string, string>,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.set(k, v);
  const url = `http://localhost/webhooks/mercadolibre?${search.toString()}`;
  return app.request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const FIXED_NOW_MS = Date.UTC(2026, 4, 15, 12, 0, 0); // 2026-05-15T12:00:00Z
const SENT_ISO = new Date(FIXED_NOW_MS - 60_000).toISOString(); // 1 min ago

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("POST /webhooks/mercadolibre", () => {
  // ── (a) valid signed query → 200 + raw_orders insert ────────────────────
  it("accepts a valid signature and inserts into raw_orders", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const params: Record<string, string> = {
      topic: "orders_v2",
      user_id: "123456789",
      application_id: APP_ID,
      attempts: "1",
      sent: SENT_ISO,
      received: new Date(FIXED_NOW_MS).toISOString(),
    };
    const sig = signQuery(params);

    const body = {
      resource: "/orders/200000000001",
      user_id: 123456789,
      topic: "orders_v2",
      application_id: Number(APP_ID),
      sent: SENT_ISO,
      received: params.received,
    };

    const res = await postWebhook(app, params, body, { "x-signature": sig });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; dedup?: boolean };
    expect(json.ok).toBe(true);
    expect(json.dedup).toBeUndefined();

    expect(state.rawOrdersInserts).toHaveLength(1);
    const inserted = state.rawOrdersInserts[0]!;
    expect(inserted.canal).toBe("mercadolibre");
    expect(inserted.processed).toBe(false);
    const payloadOut = inserted.payload_json as Record<string, unknown>;
    expect(payloadOut._topic).toBe("orders_v2");
    expect(payloadOut._resource).toBe("/orders/200000000001");
    expect(payloadOut._notification_id).toMatch(
      /^orders_v2:\/orders\/200000000001:/,
    );
    expect(payloadOut._sent).toBe(SENT_ISO);

    expect(state.rawEventsUpserts).toHaveLength(1);
    expect(state.messagingLogWrites).toHaveLength(0); // CC-14
  });

  // ── (b) tampered signature → 401 invalid_signature ──────────────────────
  it("rejects with 401 invalid_signature when the signature was tampered with", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const params: Record<string, string> = {
      topic: "orders_v2",
      user_id: "123456789",
      application_id: APP_ID,
      attempts: "1",
      sent: SENT_ISO,
      received: new Date(FIXED_NOW_MS).toISOString(),
    };
    const sig = signQuery(params);
    // Flip a hex char in the signature.
    const tampered =
      sig[0] === "a"
        ? "b" + sig.slice(1)
        : "a" + sig.slice(1);

    const res = await postWebhook(
      app,
      params,
      { resource: "/orders/x", user_id: 1, topic: "orders_v2" },
      { "x-signature": tampered },
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_signature");

    // INVARIANT: no DB side-effects when signature fails.
    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(0);
    expect(state.messagingLogWrites).toHaveLength(0);
  });

  // ── (c) duplicate notification id → 200 {dedup:true}, no new raw_orders ─
  it("returns 200 dedup:true on duplicate notification id and skips the raw_orders insert", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const params: Record<string, string> = {
      topic: "orders_v2",
      user_id: "123456789",
      application_id: APP_ID,
      attempts: "2", // retry
      sent: SENT_ISO,
      received: new Date(FIXED_NOW_MS).toISOString(),
    };
    const sig = signQuery(params);
    const resource = "/orders/200000000777";
    const notificationId = `orders_v2:${resource}:${SENT_ISO}`;
    state.seenNotificationIds.add(notificationId);

    const res = await postWebhook(
      app,
      params,
      { resource, user_id: 123456789, topic: "orders_v2" },
      { "x-signature": sig },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; dedup?: boolean };
    expect(body.ok).toBe(true);
    expect(body.dedup).toBe(true);

    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(1);
  });

  // ── (d) missing topic → 400 missing_topic ───────────────────────────────
  it("returns 400 missing_topic when the topic query param is absent", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    // Build params WITHOUT `topic` — sign what we have.
    const params: Record<string, string> = {
      topic: "", // signing empty topic for signature parity
      user_id: "123456789",
      application_id: APP_ID,
      attempts: "1",
      sent: SENT_ISO,
      received: new Date(FIXED_NOW_MS).toISOString(),
    };
    const sig = signQuery(params);
    // Now drop the topic from the actual request.
    const sendParams = { ...params };
    delete (sendParams as Record<string, string>).topic;

    const res = await postWebhook(
      app,
      sendParams,
      { resource: "/orders/x", user_id: 1, topic: "" },
      { "x-signature": sig },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_topic");
    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(0);
  });

  // ── (e) stale `sent` > 24h → 401 stale_delivery ─────────────────────────
  it("rejects with 401 stale_delivery when `sent` is older than 24h", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const staleSent = new Date(FIXED_NOW_MS - 25 * 60 * 60 * 1000).toISOString();
    const params: Record<string, string> = {
      topic: "orders_v2",
      user_id: "123456789",
      application_id: APP_ID,
      attempts: "1",
      sent: staleSent,
      received: new Date(FIXED_NOW_MS).toISOString(),
    };
    const sig = signQuery(params);

    const res = await postWebhook(
      app,
      params,
      { resource: "/orders/x", user_id: 1, topic: "orders_v2" },
      { "x-signature": sig },
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("stale_delivery");
    expect(state.rawOrdersInserts).toHaveLength(0);
    // Dedupe NOT touched — stale check runs before dedupe.
    expect(state.rawEventsUpserts).toHaveLength(0);
  });

  // ── (f) env unset → 503 not_configured ──────────────────────────────────
  it("returns 503 not_configured when ML env vars are not set", async () => {
    const { app, state } = buildApp({
      loader: notConfiguredLoader(),
      now: () => FIXED_NOW_MS,
    });
    const params: Record<string, string> = {
      topic: "orders_v2",
      user_id: "123456789",
      application_id: APP_ID,
      attempts: "1",
      sent: SENT_ISO,
      received: new Date(FIXED_NOW_MS).toISOString(),
    };
    // No need to sign — config gate runs first.
    const res = await postWebhook(
      app,
      params,
      { resource: "/orders/x", user_id: 1, topic: "orders_v2" },
      { "x-signature": "00".repeat(32) },
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: string;
      message: string;
      missing: string[];
    };
    expect(body.error).toBe("not_configured");
    expect(body.missing).toContain("ML_CLIENT_ID");

    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(0);
  });

  // ── (g) unknown topic (`messages`) → 200 dropped, no messaging_log (CC-14) ─
  it("drops `messages` topic without writing messaging_log or raw_orders (CC-14)", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const params: Record<string, string> = {
      topic: "messages",
      user_id: "123456789",
      application_id: APP_ID,
      attempts: "1",
      sent: SENT_ISO,
      received: new Date(FIXED_NOW_MS).toISOString(),
    };
    const sig = signQuery(params);

    const res = await postWebhook(
      app,
      params,
      { resource: "/messages/x", user_id: 1, topic: "messages" },
      { "x-signature": sig },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      dropped?: boolean;
      dedup?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.dropped).toBe(true);

    // Dedupe row STILL gets written (idempotency across retries even for
    // unsupported topics); raw_orders does NOT. CC-14 — zero messaging_log.
    expect(state.rawEventsUpserts).toHaveLength(1);
    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.messagingLogWrites).toHaveLength(0);
  });

  // ── Defense-in-depth: missing signature → 401 ──────────────────────────
  it("returns 401 invalid_signature when neither header nor query carries a signature", async () => {
    const { app, state } = buildApp({ now: () => FIXED_NOW_MS });
    const params: Record<string, string> = {
      topic: "orders_v2",
      user_id: "123456789",
      application_id: APP_ID,
      attempts: "1",
      sent: SENT_ISO,
      received: new Date(FIXED_NOW_MS).toISOString(),
    };

    const res = await postWebhook(app, params, {
      resource: "/orders/x",
      user_id: 1,
      topic: "orders_v2",
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_signature");
    expect(state.rawOrdersInserts).toHaveLength(0);
    expect(state.rawEventsUpserts).toHaveLength(0);
  });
});
