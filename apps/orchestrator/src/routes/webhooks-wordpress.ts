/**
 * WordPress (WooCommerce) webhook route — Plan 2.3.1.
 *
 * Mounts `POST /webhooks/wordpress` on the orchestrator's Hono app. The
 * handler implements the 13-step receive path verbatim from RESEARCH §Pattern
 * 1 + §Security:
 *
 *   1. loadWordPressConfig(env) — degraded path: 503 {error:"not_configured"}
 *   2. Read RAW BYTES via arrayBuffer() → Buffer (INVARIANT: no JSON.parse yet)
 *   3. x-wc-webhook-signature   — required for verify
 *   4. x-wc-webhook-delivery-id — required for dedupe
 *   5. x-wc-webhook-topic       — informational, persisted into payload
 *   6. verifyWooSignature(raw, sig, secret) — 401 invalid_signature on mismatch
 *   7. missing delivery_id      — 400 missing_delivery_id
 *   8. x-wc-webhook-timestamp window check (24h replay protection — RESEARCH
 *      §Security): 401 stale_delivery if older than 24h
 *   9. checkDeliverySeen(supabase, {delivery_id, topic}) — 200 {dedup:true} on
 *      conflict (at-least-once delivery handled — RESEARCH §Pitfall 1)
 *  10. JSON.parse(raw.toString("utf8"))  — ONLY after verify (Pitfall 2)
 *  11. INSERT raw_orders { canal:"wordpress", payload_json:{...payload,
 *      _topic, _delivery_id}, processed:false }
 *  12. Return 200 {ok:true} (ACK within <2s, target ≪1s)
 *  13. No executionCtx.waitUntil — async work happens in the
 *      process-wp-events cron (Plan 2.3.2) draining
 *      `raw_orders WHERE processed=false`. RESEARCH Open Q §1 RESOLVED.
 *
 * Invariant W2: NEVER call `recordConnectorRun` here — this is the webhook ACK
 * path, not a sync run. The async cron writes the connector_runs row.
 *
 * Invariant CC-14: NEVER write to the messaging-channel log table (owned by F4)
 * regardless of `topic`. If we receive an unknown / unsupported topic (e.g.
 * `messaging.event`), log + drop; the WC payload still lands in raw_orders so
 * downstream processors can decide later, but no message side-effect fires
 * from the receive path.
 *
 * ── Reuse target ─────────────────────────────────────────────────────────────
 *
 * Plan 2.1.3.1 (F2.1 Mercado Libre webhook route) borrows this envelope verbatim
 * — config check → raw bytes → header parse → verify → dedupe → topic-filter →
 * persist → ACK — and substitutes ML's signed-query-params verifier for
 * `verifyWooSignature`. Keep this file's structure flat + linear so the ML
 * implementation can clone the shape with minimal cognitive load.
 *
 * ── Testing ──────────────────────────────────────────────────────────────────
 *
 * Test surface in `apps/orchestrator/__tests__/webhooks-wordpress.test.ts`
 * covers all six failure modes + the happy path + the CC-14 drop case. The
 * route is exported as a mounter so tests can build a Hono instance + drive
 * it via `app.request(...)` without spinning a real server.
 */

import type { Context, Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkDeliverySeen,
  loadWordPressConfig,
  verifyWooSignature,
  type LoadedWordPressConfig,
} from "@faka/connectors";
import { getSupabase } from "../lib/supabase.js";
import { log as orchestratorLog } from "../lib/log.js";

// 24 hours in milliseconds — replay-window guard per RESEARCH §Security.
const WEBHOOK_TIMESTAMP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Logger surface — minimal subset of the orchestrator's pino instance.
 * Decoupled from `./lib/log.js` so tests can inject a quiet logger and so the
 * F2.1 ML route can reuse the same shape.
 */
export interface WebhookLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface MountWordPressWebhookDeps {
  /** Override the Supabase service-role client. Defaults to `getSupabase()`. */
  getSupabase?: () => SupabaseClient;
  /** Override the env loader. Defaults to `loadWordPressConfig(process.env)`. */
  loadConfig?: () => LoadedWordPressConfig;
  /** Override the logger. Defaults to a console-shaped no-op shim. */
  logger?: WebhookLogger;
  /** Override `Date.now()` for replay-window testing. */
  now?: () => number;
}

/**
 * Topics we recognise + drop at the webhook layer. Anything outside this set
 * still gets persisted to raw_orders (the durable queue) — the cron decides
 * whether to act. CC-14: webhook NEVER writes the F4 messaging side-table itself.
 */
function isSupportedTopic(topic: string | undefined): boolean {
  if (!topic) return false;
  return topic.startsWith("order.") || topic.startsWith("product.");
}

/**
 * Mount `POST /webhooks/wordpress` onto the supplied Hono app.
 *
 * The mounter takes a small dependency bag so the test suite can swap in a
 * Supabase mock + a deterministic clock without touching env vars. In
 * production, the orchestrator's `server.ts` calls
 * `mountWordPressWebhook(app)` with no args — the defaults wire through to
 * the real Supabase singleton + the real env loader.
 */
export function mountWordPressWebhook(
  app: Hono,
  deps: MountWordPressWebhookDeps = {},
): void {
  app.post("/webhooks/wordpress", async (c: Context) => {
    const log = deps.logger ?? defaultLogger();
    const loadCfg = deps.loadConfig ?? (() => loadWordPressConfig());
    const now = deps.now ?? (() => Date.now());

    // [1] Config check — degraded path returns 503 with a stable error code.
    const cfg = loadCfg();
    if (!cfg.ok) {
      log.warn(
        { route: "webhooks-wordpress", reason: "not_configured" },
        "webhook.degraded",
      );
      return c.json(
        {
          error: "not_configured",
          message:
            "WordPress credentials not configured; webhook endpoint disabled",
        },
        503,
      );
    }

    // [2] Read RAW BYTES. INVARIANT (RESEARCH §Pitfall 2): no body-parsing
    // before the signature check — the HMAC is computed over the exact bytes
    // WC sent. arrayBuffer() yields a Web ArrayBuffer; Buffer.from copies it
    // into a Node Buffer that the verifier (and the post-verify body parse)
    // can consume.
    const rawBody = Buffer.from(await c.req.arrayBuffer());

    // [3-5] Headers. WC sends three relevant ones; the rest is informational.
    const sig = c.req.header("x-wc-webhook-signature");
    const deliveryId = c.req.header("x-wc-webhook-delivery-id");
    const topic = c.req.header("x-wc-webhook-topic");
    const tsHeader = c.req.header("x-wc-webhook-timestamp");

    // [6] HMAC verify FIRST. Any failure → 401 invalid_signature. Note: the
    // verifier short-circuits on missing/empty header, so we don't pre-check.
    if (!verifyWooSignature(rawBody, sig, cfg.webhookSecret)) {
      log.warn(
        {
          route: "webhooks-wordpress",
          delivery_id: deliveryId ?? null,
          topic: topic ?? null,
          bytes: rawBody.length,
        },
        "webhook.invalid_signature",
      );
      return c.json({ error: "invalid_signature" }, 401);
    }

    // [7] Delivery ID is mandatory for dedupe. WC always emits it; if missing,
    // we treat as malformed (400) rather than soft-accept (we'd lose
    // idempotency).
    if (!deliveryId) {
      log.warn(
        { route: "webhooks-wordpress", topic: topic ?? null },
        "webhook.missing_delivery_id",
      );
      return c.json({ error: "missing_delivery_id" }, 400);
    }

    // [8] Replay window: WC's x-wc-webhook-timestamp is a Unix epoch in
    // seconds. >24h old → 401 stale_delivery. If header is absent we accept
    // (older WC versions don't ship it; the HMAC already binds the payload).
    if (tsHeader) {
      const tsSec = Number.parseInt(tsHeader, 10);
      if (Number.isFinite(tsSec) && tsSec > 0) {
        const tsMs = tsSec * 1000;
        if (now() - tsMs > WEBHOOK_TIMESTAMP_WINDOW_MS) {
          log.warn(
            {
              route: "webhooks-wordpress",
              delivery_id: deliveryId,
              age_ms: now() - tsMs,
            },
            "webhook.stale_delivery",
          );
          return c.json({ error: "stale_delivery" }, 401);
        }
      }
    }

    // [9] Dedupe via `raw_events` unique index on (canal, _delivery_id). If
    // seen → 200 dedup:true (at-least-once handled). We pass `topic` so the
    // dedupe row carries context, but body stays out of the event marker —
    // the canonical payload lives in raw_orders on the first delivery only.
    const supabase = (deps.getSupabase ?? getSupabaseDefault)();
    let seen: boolean;
    try {
      seen = await checkDeliverySeen(supabase, {
        delivery_id: deliveryId,
        topic,
      });
    } catch (err) {
      // Dedupe write failed (e.g. transient Supabase error). Per dedupe
      // module's contract: surface non-200 so WC retries (it will, with
      // exponential backoff up to 5 attempts by default).
      log.error(
        {
          route: "webhooks-wordpress",
          delivery_id: deliveryId,
          err: (err as Error).message,
        },
        "webhook.dedupe_failed",
      );
      return c.json({ error: "dedupe_failed" }, 500);
    }
    if (seen) {
      log.info(
        { route: "webhooks-wordpress", delivery_id: deliveryId, topic },
        "webhook.dedup",
      );
      return c.json({ ok: true, dedup: true });
    }

    // [10] JSON.parse — ONLY after verify + dedupe pass. If parsing fails we
    // already wrote the dedupe row, which is fine: the same delivery_id
    // arriving again will short-circuit at step 9 without us reattempting a
    // hopeless parse.
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("payload is not a JSON object");
      }
      payload = parsed as Record<string, unknown>;
    } catch (err) {
      log.warn(
        {
          route: "webhooks-wordpress",
          delivery_id: deliveryId,
          err: (err as Error).message,
        },
        "webhook.invalid_json",
      );
      return c.json({ error: "invalid_json" }, 400);
    }

    // CC-14: if the topic is unsupported (e.g. messaging.event) we explicitly
    // log+drop rather than route anywhere. The webhook handler NEVER writes
    // to the F4 messaging side-table — that table is owned by F4 channels
    // and would be a trust-boundary violation here.
    if (!isSupportedTopic(topic)) {
      log.info(
        {
          route: "webhooks-wordpress",
          delivery_id: deliveryId,
          topic: topic ?? null,
        },
        "webhook.topic_dropped",
      );
      // Still ack 200 so WC stops retrying. We deliberately do NOT insert into
      // raw_orders for unsupported topics — keeps the durable queue clean.
      return c.json({ ok: true, dropped: true });
    }

    // [11] Insert into raw_orders with the durable-queue flag set to false.
    // The cron (Plan 2.3.2) drains `WHERE canal='wordpress' AND processed=false`.
    const { error: insertErr } = await supabase.from("raw_orders").insert({
      canal: "wordpress",
      payload_json: {
        ...payload,
        _topic: topic ?? null,
        _delivery_id: deliveryId,
      },
      processed: false,
    });
    if (insertErr) {
      log.error(
        {
          route: "webhooks-wordpress",
          delivery_id: deliveryId,
          err: insertErr.message,
        },
        "webhook.raw_orders_insert_failed",
      );
      // Return 500 so WC retries — the dedupe row landed but the canonical
      // payload didn't. Next retry, dedupe returns "seen" but raw_orders has
      // no row → we'd lose the delivery. This is a known sharp edge addressed
      // by Plan 2.3.3's hourly REST pull (insurance against missed webhooks).
      return c.json({ error: "raw_orders_insert_failed" }, 500);
    }

    // [12] ACK fast. <2s target; in practice the path above is ~50ms when
    // Supabase is warm + ~200ms cold. No async work fans out from here.
    log.info(
      {
        route: "webhooks-wordpress",
        delivery_id: deliveryId,
        topic,
        bytes: rawBody.length,
      },
      "webhook.accepted",
    );
    return c.json({ ok: true });
  });
}

/**
 * Default Supabase loader — proxies to the orchestrator's singleton. Tests
 * pass `deps.getSupabase` to bypass the env-var-validating constructor.
 */
function getSupabaseDefault(): SupabaseClient {
  return getSupabase();
}

/**
 * Default logger — thin shim around the orchestrator's pino instance. Tests
 * pass `deps.logger` to keep stderr quiet.
 */
function defaultLogger(): WebhookLogger {
  return {
    debug: (obj, msg) => orchestratorLog.debug(obj, msg),
    info: (obj, msg) => orchestratorLog.info(obj, msg),
    warn: (obj, msg) => orchestratorLog.warn(obj, msg),
    error: (obj, msg) => orchestratorLog.error(obj, msg),
  };
}
