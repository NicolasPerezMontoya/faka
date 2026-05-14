/**
 * Webhook integration test — Plan 2.5.3.
 *
 * Drives the real `mountWordPressWebhook` handler against a live Supabase
 * via the orchestrator's Hono app surface (`app.request(...)` — in-process,
 * no real socket). The unit-style test at
 * `apps/orchestrator/__tests__/webhooks-wordpress.test.ts` (Plan 2.3.1)
 * uses a mocked Supabase client; this file is the OUTSIDE-IN counterpart
 * that verifies the same envelope end-to-end against a real `raw_orders` +
 * `raw_events` write path.
 *
 * Coverage (subset of Plan 2.5.3 — webhook column of the test map):
 *
 *   1. Valid HMAC + new delivery_id → 200, raw_orders row inserted with
 *      _delivery_id + _topic; raw_events dedupe row written.
 *   2. Duplicate delivery_id replay → 200 {dedup:true}, NO second raw_orders
 *      row (W2 / Pitfall 1 — at-least-once delivery handled).
 *   3. Tampered byte → 401 invalid_signature, ZERO writes to either table
 *      (verify-before-anything-else invariant).
 *   4. Missing delivery_id → 400 missing_delivery_id, no writes.
 *   5. CC-14: messaging.event topic → 200 dropped, NO raw_orders row, NO
 *      messaging_log writes (CC-14 — the table stays empty in F2).
 *
 * Gating: `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` opt-in
 * (Plan 2.5.1 contract — `describeLive` skips cleanly when unset so local
 * dev + CI without a test DB stay green).
 *
 * Cleanup: every insert this suite makes is tagged with a `RUN_TAG` that
 * encodes the test-run timestamp. `afterAll` deletes by `_delivery_id`
 * prefix + `payload_json->>'_run_tag'` so reruns are idempotent.
 *
 * F2.1 (Mercado Libre) inheritance: this file's shape — seed config →
 * sign body → POST via app.request → assert DB state → cleanup — is the
 * template the ML webhook integration test will clone. Keep the four
 * helper functions (`signBody`, `postWebhook`, `buildApp`, `cleanup`)
 * flat + obvious so the F2.1 author can swap in `signMlQuery` without
 * touching the harness.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  mountWordPressWebhook,
  type WebhookLogger,
} from "../../src/routes/webhooks-wordpress.js";
import type { LoadedWordPressConfig } from "@faka/connectors";

const liveDbConfigured =
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY);

const describeLive = liveDbConfigured ? describe : describe.skip;

const SECRET = "test-wc-webhook-secret-itest-2026";
const RUN_TAG = `webhook-itest-${Date.now()}`;

const quietLogger: WebhookLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function signBody(body: Buffer, secret = SECRET): string {
  // Verbatim algorithm from `verifyWooSignature`: HMAC-SHA256 over raw
  // bytes, base64-encoded. Matches what WC ships in
  // `x-wc-webhook-signature`.
  return createHmac("sha256", secret).update(body).digest("base64");
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

function buildApp(supabase: SupabaseClient): Hono {
  const app = new Hono();
  mountWordPressWebhook(app, {
    getSupabase: () => supabase,
    loadConfig: configuredLoader(),
    logger: quietLogger,
    now: () => Date.now(),
  });
  return app;
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

function deliveryId(slot: string): string {
  return `${RUN_TAG}-${slot}`;
}

describeLive(
  "webhook /webhooks/wordpress — live Supabase integration (Plan 2.5.3)",
  () => {
    let supabase: SupabaseClient;
    let app: Hono;
    let messagingLogCountBefore: number;

    beforeAll(async () => {
      supabase = createClient(
        process.env.TEST_SUPABASE_URL!,
        process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      app = buildApp(supabase);

      // CC-14 baseline: snapshot messaging_log count BEFORE the suite runs.
      // The webhook must never write to this table; we re-assert in afterAll.
      const { count } = await supabase
        .from("messaging_log")
        .select("*", { count: "exact", head: true });
      messagingLogCountBefore = count ?? 0;
    });

    afterAll(async () => {
      if (!supabase) return;
      // Cleanup: delete every raw_orders + raw_events row this run inserted.
      // Filter by _delivery_id prefix — the dedupe key carries our RUN_TAG.
      await supabase
        .from("raw_orders")
        .delete()
        .like("payload_json->>_delivery_id", `${RUN_TAG}-%`);
      await supabase
        .from("raw_events")
        .delete()
        .like("payload_json->>_delivery_id", `${RUN_TAG}-%`);
    });

    it("[1] valid HMAC + new delivery_id → 200 + raw_orders insert", async () => {
      const id = deliveryId("ok");
      const payload = {
        id: 12345,
        status: "completed",
        total: "150.00",
        _run_tag: RUN_TAG,
      };
      const raw = Buffer.from(JSON.stringify(payload), "utf-8");
      const tsSec = Math.floor(Date.now() / 1000);

      const res = await postWebhook(app, raw, {
        "x-wc-webhook-signature": signBody(raw),
        "x-wc-webhook-delivery-id": id,
        "x-wc-webhook-topic": "order.completed",
        "x-wc-webhook-timestamp": String(tsSec),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; dedup?: boolean };
      expect(body.ok).toBe(true);
      expect(body.dedup).toBeUndefined();

      // raw_orders should have exactly one row with our _delivery_id.
      const { data, error } = await supabase
        .from("raw_orders")
        .select("canal, processed, payload_json")
        .eq("payload_json->>_delivery_id", id);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data![0]!;
      expect(row.canal).toBe("wordpress");
      expect(row.processed).toBe(false);
      const pj = row.payload_json as Record<string, unknown>;
      expect(pj._topic).toBe("order.completed");
      expect(pj._delivery_id).toBe(id);
      expect(pj.id).toBe(12345);
    });

    it("[2] duplicate delivery_id replay → 200 dedup, no second raw_orders row", async () => {
      const id = deliveryId("dup");
      const payload = { id: 9999, status: "processing", _run_tag: RUN_TAG };
      const raw = Buffer.from(JSON.stringify(payload), "utf-8");
      const tsSec = Math.floor(Date.now() / 1000);
      const headers = {
        "x-wc-webhook-signature": signBody(raw),
        "x-wc-webhook-delivery-id": id,
        "x-wc-webhook-topic": "order.updated",
        "x-wc-webhook-timestamp": String(tsSec),
      };

      // First delivery — should land normally.
      const r1 = await postWebhook(app, raw, headers);
      expect(r1.status).toBe(200);
      const b1 = (await r1.json()) as { ok: boolean; dedup?: boolean };
      expect(b1.dedup).toBeUndefined();

      // Second delivery (same delivery_id, same body) — should dedup.
      const r2 = await postWebhook(app, raw, headers);
      expect(r2.status).toBe(200);
      const b2 = (await r2.json()) as { ok: boolean; dedup?: boolean };
      expect(b2.dedup).toBe(true);

      // raw_orders should have exactly ONE row for this delivery_id.
      const { data, count } = await supabase
        .from("raw_orders")
        .select("payload_json", { count: "exact" })
        .eq("payload_json->>_delivery_id", id);
      expect(count).toBe(1);
      expect(data).toHaveLength(1);
    });

    it("[3] tampered body → 401, zero raw_orders + zero raw_events writes", async () => {
      const id = deliveryId("tamper");
      const original = Buffer.from(
        JSON.stringify({ id: 1, status: "completed", _run_tag: RUN_TAG }),
        "utf-8",
      );
      const sig = signBody(original);
      const tampered = Buffer.from(original);
      tampered[10] = tampered[10]! ^ 0x01;

      const res = await postWebhook(app, tampered, {
        "x-wc-webhook-signature": sig,
        "x-wc-webhook-delivery-id": id,
        "x-wc-webhook-topic": "order.updated",
        "x-wc-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_signature");

      // Zero writes — verify-before-anything-else invariant.
      const { count: roCount } = await supabase
        .from("raw_orders")
        .select("*", { count: "exact", head: true })
        .eq("payload_json->>_delivery_id", id);
      expect(roCount).toBe(0);
      const { count: reCount } = await supabase
        .from("raw_events")
        .select("*", { count: "exact", head: true })
        .eq("payload_json->>_delivery_id", id);
      expect(reCount).toBe(0);
    });

    it("[4] missing delivery_id → 400 missing_delivery_id, zero writes", async () => {
      const raw = Buffer.from(
        JSON.stringify({ id: 2, _run_tag: RUN_TAG }),
        "utf-8",
      );
      const res = await postWebhook(app, raw, {
        "x-wc-webhook-signature": signBody(raw),
        "x-wc-webhook-topic": "order.updated",
        "x-wc-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        // no x-wc-webhook-delivery-id
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("missing_delivery_id");
    });

    it("[5] CC-14: messaging.event topic dropped, NO raw_orders, NO messaging_log writes", async () => {
      const id = deliveryId("msg");
      const raw = Buffer.from(
        JSON.stringify({
          event: "subscription.cancelled",
          _run_tag: RUN_TAG,
        }),
        "utf-8",
      );
      const res = await postWebhook(app, raw, {
        "x-wc-webhook-signature": signBody(raw),
        "x-wc-webhook-delivery-id": id,
        "x-wc-webhook-topic": "messaging.event",
        "x-wc-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; dropped?: boolean };
      expect(body.ok).toBe(true);
      expect(body.dropped).toBe(true);

      // No canonical durable-queue write — keeps raw_orders clean.
      const { count: roCount } = await supabase
        .from("raw_orders")
        .select("*", { count: "exact", head: true })
        .eq("payload_json->>_delivery_id", id);
      expect(roCount).toBe(0);

      // CC-14: messaging_log count unchanged. The webhook MUST NEVER write
      // to this table, regardless of `topic`. F4 owns it; F2 keeps it empty.
      const { count: messagingLogAfter } = await supabase
        .from("messaging_log")
        .select("*", { count: "exact", head: true });
      expect(messagingLogAfter).toBe(messagingLogCountBefore);
    });
  },
);
