import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { log } from "./lib/log.js";
import { getSupabase } from "./lib/supabase.js";
import { buildRegistry } from "./connectors/registry.js";
import { mountWordPressWebhook } from "./routes/webhooks-wordpress.js";
import { mountMercadoLibreWebhook } from "./routes/webhooks-mercadolibre.js";

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "faka-orchestrator",
    phase: 1,
    ts: new Date().toISOString(),
  }),
);

app.get("/connectors", async (c) => {
  const registry = buildRegistry();
  const supabase = getSupabase();
  const ctx = {
    supabase,
    logger: {
      debug: (m: string) => log.debug(m),
      info: (m: string) => log.info(m),
      warn: (m: string) => log.warn(m),
      error: (m: string) => log.error(m),
    },
  };

  const results = await Promise.all(
    Object.entries(registry).map(async ([canal, conn]) => {
      if (!conn)
        return { canal, ok: false, last_error: "alias (see canonical canal)" };
      try {
        const health = await conn.healthCheck(ctx);
        return { canal, name: conn.name, type: conn.type, ...health };
      } catch (err) {
        return {
          canal,
          name: conn.name,
          ok: false,
          last_error: (err as Error).message,
        };
      }
    }),
  );

  return c.json({ connectors: results });
});

// Plan 2.3.1 — real WP webhook receiver. The mounter registers
// `POST /webhooks/wordpress` directly; the catch-all below keeps every other
// canal on the F1 501 stub until its own route lands (F3 POS).
mountWordPressWebhook(app);

// Plan 2.1.3.1 — Mercado Libre signed-query-params webhook. Distinct verifier
// from WP (HMAC-PATTERN-DIVERGENCE): ML signs the canonical query string, WP
// signs the raw body — the two routes share an envelope, not a primitive.
mountMercadoLibreWebhook(app);

app.post("/webhooks/:canal", (c) => {
  const canal = c.req.param("canal");
  // wordpress + mercadolibre are intentionally NOT listed here — their
  // mounters above take precedence (Hono matches in registration order).
  // If a request still hits this catch-all with one of those canals,
  // something has been mis-registered upstream — fail loud.
  if (canal === "wordpress" || canal === "mercadolibre") {
    return c.json({ error: "route_misregistration", canal }, 500);
  }
  return c.json({ error: "NOT_IMPLEMENTED_F2", canal }, 501);
});

app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

app.onError((err, c) => {
  log.error({ err: err.message, stack: err.stack }, "unhandled_error");
  return c.json({ error: "internal_server_error" }, 500);
});

const port = Number(process.env.PORT ?? 8080);
log.info({ port }, "orchestrator starting");
serve({ fetch: app.fetch, port });
