/**
 * Mercado Libre webhook route — Plan 2.1.3.1.
 *
 * Mounts `POST /webhooks/mercadolibre` on the orchestrator's Hono app. The
 * handler mirrors `webhooks-wordpress.ts`'s 13-step envelope, swapping the
 * raw-body HMAC verify for ML's signed-query-params HMAC verify:
 *
 *   1. loadMercadoLibreConfig(env)   — degraded: 503 {error:"not_configured"}
 *   2. Parse the request URL's searchParams (ML signs the query, not the body)
 *   3. x-signature header (or `signature` query param as legacy fallback)
 *   4. `_notification_id` = `<topic>:<resource>:<sent>` — the natural dedupe
 *      key. ML's body contains `_id` but it is not always present; the triple
 *      above is the safest canonical id across ML's delivery shapes.
 *   5. topic (informational, persisted into payload; drives dropped-topic gate)
 *   6. verifyMLSignature(query, sig, secret) — 401 invalid_signature on miss
 *   7. missing topic     → 400 missing_topic
 *   8. `sent` timestamp window check — 24h replay protection (RESEARCH §Sec).
 *      Tolerant when `sent` is absent (older deliveries) — the HMAC already
 *      binds the payload.
 *   9. raw_events INSERT … ON CONFLICT DO NOTHING via `checkDeliverySeen` —
 *      the F2 dedupe path is canal-aware via the partial unique index on
 *      `(canal, payload_json->>'_delivery_id')`. We pass `_delivery_id` = the
 *      composite notification id; the SAME dedupe row collapses ML retries.
 *  10. JSON.parse the body — ONLY after verify+dedupe pass (the body is a
 *      pointer `{ resource, user_id, topic }`, not the resource itself —
 *      RESEARCH §Anti-Patterns).
 *  11. Unknown topics → log + 200 dropped (CC-14 — `messages` topic stays
 *      out of `raw_orders`; messaging side-table is F5.5's surface).
 *  12. INSERT into `raw_orders` with `canal='mercadolibre'`,
 *      payload_json carries the body + `_topic` + `_notification_id` for the
 *      `sync-ml-orders` cron to drain.
 *  13. ACK 200 within < 2s. The cron re-fetches `/orders/{resource}` on its
 *      next tick — we never trust the body for state.
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 *
 *  - W2: `recordConnectorRun` is NEVER called here. The async cron writes the
 *    `connector_runs` row.
 *  - CC-14: NEVER write to the F5.5 messaging side-table. The plan's
 *    grep gate ensures this file contains zero references to that table
 *    (the dropped-topic path below never reaches the F5.5 surface).
 *  - HMAC-PATTERN-DIVERGENCE: we import `verifyMLSignature`, NOT
 *    `verifyWooSignature`. The two are not interchangeable.
 *  - CC-13: `raw_events.payload_json` write is INSERT-only (via
 *    `checkDeliverySeen`'s `upsert + ignoreDuplicates`), never UPDATE.
 *  - Single-seller: `application_id` from the signed params is recorded but
 *    not used as a routing key; the orchestrator hosts a single ML app in v1.
 *
 * ── Testing ────────────────────────────────────────────────────────────────
 *
 * `apps/orchestrator/__tests__/webhooks-mercadolibre.test.ts` builds a Hono
 * app via `mountMercadoLibreWebhook(app, deps)` and drives it via
 * `app.request(...)` with a test-only `ML_WEBHOOK_SECRET`. Coverage:
 *
 *   (a) valid signed query                     → 200 + raw_orders insert
 *   (b) tampered signature                     → 401 invalid_signature
 *   (c) duplicate notification id              → 200 {dedup:true}, no new row
 *   (d) missing topic                          → 400 missing_topic
 *   (e) stale `sent` > 24h                     → 401 stale_delivery
 *   (f) env unset                              → 503 not_configured
 *   (g) unknown topic (`messages`)             → 200 dropped, no raw_orders
 *
 * Tests pass a Supabase mock + deterministic clock through the deps bag so
 * no real env var or network is touched.
 */

import type { Context, Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadMercadoLibreConfig,
  verifyMLSignature,
  type LoadedMLConfig,
} from "@faka/connectors/mercadolibre";
import { getSupabase } from "../lib/supabase.js";
import { log as orchestratorLog } from "../lib/log.js";

// 24 hours in milliseconds — replay-window guard (RESEARCH §Security).
const ML_TIMESTAMP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Topics we recognise + route into `raw_orders`. Anything outside this set
 * still ack-200s (ML keeps retrying otherwise) but is NOT persisted — keeps
 * the durable queue clean. CC-14: `messages` stays out regardless.
 */
const SUPPORTED_TOPICS = new Set<string>([
  "orders",
  "orders_v2",
  "items",
  "shipments",
  "questions",
  "claims",
]);

function isSupportedTopic(topic: string | undefined): boolean {
  if (!topic) return false;
  if (topic === "messages" || topic === "messages_v1") return false;
  return SUPPORTED_TOPICS.has(topic);
}

export interface WebhookLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface MountMercadoLibreWebhookDeps {
  getSupabase?: () => SupabaseClient;
  loadConfig?: () => LoadedMLConfig;
  logger?: WebhookLogger;
  now?: () => number;
}

/**
 * Build the canonical notification id used as the dedupe key. ML's body
 * sometimes includes `_id` but it is not stable across all delivery shapes;
 * `<topic>:<resource>:<sent>` is unique within ML's retry envelope (the
 * `sent` timestamp is included in the HMAC inputs, so two retries of the
 * same notification share it).
 */
function buildNotificationId(
  topic: string,
  resource: string | undefined,
  sent: string | undefined,
): string {
  return `${topic}:${resource ?? ""}:${sent ?? ""}`;
}

export function mountMercadoLibreWebhook(
  app: Hono,
  deps: MountMercadoLibreWebhookDeps = {},
): void {
  app.post("/webhooks/mercadolibre", async (c: Context) => {
    const log = deps.logger ?? defaultLogger();
    const loadCfg = deps.loadConfig ?? (() => loadMercadoLibreConfig());
    const now = deps.now ?? (() => Date.now());

    // [1] Config check — degraded path returns 503.
    const cfg = loadCfg();
    if (!cfg.ok) {
      log.warn(
        { route: "webhooks-mercadolibre", reason: "not_configured" },
        "webhook.degraded",
      );
      return c.json(
        {
          error: "not_configured",
          message:
            "Mercado Libre credentials not configured; webhook endpoint disabled",
          missing: cfg.missing,
        },
        503,
      );
    }

    // [2] Parse query params from the full URL. ML signs the query, not the
    // body, so this is the source of truth for the HMAC inputs.
    const url = new URL(c.req.url);
    const query = url.searchParams;

    // [3] Read signature — header takes precedence; legacy deliveries put it
    // on the query string. Either way it is hex-encoded.
    const sigHeader =
      c.req.header("x-signature") ?? c.req.header("x-hub-signature") ?? null;
    const sigQuery = query.get("signature");
    const sig = sigHeader ?? sigQuery ?? null;

    // [4-5] Extract the signed params we care about.
    const topic = query.get("topic") ?? undefined;
    const sent = query.get("sent") ?? undefined;
    const applicationId = query.get("application_id") ?? undefined;

    // [6] HMAC verify FIRST. Any failure → 401 invalid_signature.
    if (!verifyMLSignature(query, sig, cfg.cfg.webhookSecret)) {
      log.warn(
        {
          route: "webhooks-mercadolibre",
          topic: topic ?? null,
          application_id: applicationId ?? null,
          has_sig: sig != null,
        },
        "webhook.invalid_signature",
      );
      return c.json({ error: "invalid_signature" }, 401);
    }

    // [7] Topic is mandatory — without it, we cannot route or dedupe stably.
    if (!topic) {
      log.warn(
        { route: "webhooks-mercadolibre" },
        "webhook.missing_topic",
      );
      return c.json({ error: "missing_topic" }, 400);
    }

    // [8] Replay window: `sent` is an ISO-8601 string from ML. >24h → 401.
    // Absent `sent` → accept (older delivery shapes; HMAC binds the rest).
    if (sent) {
      const sentMs = Date.parse(sent);
      if (Number.isFinite(sentMs) && now() - sentMs > ML_TIMESTAMP_WINDOW_MS) {
        log.warn(
          {
            route: "webhooks-mercadolibre",
            topic,
            age_ms: now() - sentMs,
          },
          "webhook.stale_delivery",
        );
        return c.json({ error: "stale_delivery" }, 401);
      }
    }

    // Read the body now (it's a thin pointer per RESEARCH §Anti-Patterns).
    // Parse failure is benign — the canonical pointer fields live in the
    // signed query. We persist what we got.
    let body: Record<string, unknown> = {};
    try {
      const parsed = (await c.req.json().catch(() => ({}))) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }

    const resource =
      (typeof body.resource === "string" ? (body.resource as string) : undefined) ??
      query.get("resource") ??
      undefined;

    const notificationId = buildNotificationId(topic, resource, sent);

    const supabase = (deps.getSupabase ?? getSupabaseDefault)();

    // [9] Dedupe via `raw_events` partial unique index on
    // (canal, payload_json->>'_delivery_id'). Same partial index used by
    // WordPress — index is per-canal so ML retries collapse independently
    // of any WP delivery sharing the suffix.
    const dedupeRow = {
      canal: "mercadolibre" as const,
      tipo_evento: "webhook",
      payload_json: {
        _delivery_id: notificationId,
        topic,
        resource: resource ?? null,
        application_id: applicationId ?? null,
        sent: sent ?? null,
      },
      ocurrido_at: new Date().toISOString(),
    };
    const dedupeResult = await supabase
      .from("raw_events")
      .upsert(dedupeRow, {
        onConflict: "canal,(payload_json->>'_delivery_id')",
        ignoreDuplicates: true,
      })
      .select("id");
    if (dedupeResult.error) {
      log.error(
        {
          route: "webhooks-mercadolibre",
          notification_id: notificationId,
          err: dedupeResult.error.message,
        },
        "webhook.dedupe_failed",
      );
      return c.json({ error: "dedupe_failed" }, 500);
    }
    const seen =
      !dedupeResult.data ||
      (Array.isArray(dedupeResult.data) && dedupeResult.data.length === 0);
    if (seen) {
      log.info(
        {
          route: "webhooks-mercadolibre",
          notification_id: notificationId,
          topic,
        },
        "webhook.dedup",
      );
      return c.json({ ok: true, dedup: true });
    }

    // [10-11] Unknown topics: ack 200 + drop. CC-14 — `messages` never
    // reaches `raw_orders`; messaging side-table is F5.5's surface.
    if (!isSupportedTopic(topic)) {
      log.info(
        {
          route: "webhooks-mercadolibre",
          notification_id: notificationId,
          topic,
        },
        "webhook.topic_dropped",
      );
      return c.json({ ok: true, dropped: true });
    }

    // [12] Persist into `raw_orders` — the async cron drains
    // `canal='mercadolibre' AND processed=false`. We carry the body PLUS the
    // signed-query context so the cron has everything to re-fetch from ML
    // without trusting the body for state.
    const { error: insertErr } = await supabase.from("raw_orders").insert({
      canal: "mercadolibre",
      payload_json: {
        ...body,
        _topic: topic,
        _notification_id: notificationId,
        _resource: resource ?? null,
        _application_id: applicationId ?? null,
        _sent: sent ?? null,
      },
      processed: false,
    });
    if (insertErr) {
      log.error(
        {
          route: "webhooks-mercadolibre",
          notification_id: notificationId,
          err: insertErr.message,
        },
        "webhook.raw_orders_insert_failed",
      );
      return c.json({ error: "raw_orders_insert_failed" }, 500);
    }

    // [13] ACK fast.
    log.info(
      {
        route: "webhooks-mercadolibre",
        notification_id: notificationId,
        topic,
      },
      "webhook.accepted",
    );
    return c.json({ ok: true });
  });
}

function getSupabaseDefault(): SupabaseClient {
  return getSupabase();
}

function defaultLogger(): WebhookLogger {
  return {
    debug: (obj, msg) => orchestratorLog.debug(obj, msg),
    info: (obj, msg) => orchestratorLog.info(obj, msg),
    warn: (obj, msg) => orchestratorLog.warn(obj, msg),
    error: (obj, msg) => orchestratorLog.error(obj, msg),
  };
}
