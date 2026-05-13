import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { log } from './lib/log.js';
import { getSupabase } from './lib/supabase.js';
import { buildRegistry } from './connectors/registry.js';

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'faka-orchestrator',
    phase: 1,
    ts: new Date().toISOString(),
  }),
);

app.get('/connectors', async (c) => {
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
      if (!conn) return { canal, ok: false, last_error: 'alias (see canonical canal)' };
      try {
        const health = await conn.healthCheck(ctx);
        return { canal, name: conn.name, type: conn.type, ...health };
      } catch (err) {
        return { canal, name: conn.name, ok: false, last_error: (err as Error).message };
      }
    }),
  );

  return c.json({ connectors: results });
});

app.post('/webhooks/:canal', (c) =>
  c.json({ error: 'NOT_IMPLEMENTED_F2', canal: c.req.param('canal') }, 501),
);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  log.error({ err: err.message, stack: err.stack }, 'unhandled_error');
  return c.json({ error: 'internal_server_error' }, 500);
});

const port = Number(process.env.PORT ?? 8080);
log.info({ port }, 'orchestrator starting');
serve({ fetch: app.fetch, port });
