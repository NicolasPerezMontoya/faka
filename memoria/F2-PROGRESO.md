# Fase 2 — Walking Skeleton (WordPress) — progreso

**Pausa: 2026-05-14, último commit `9a4cd28`. CI verde.**

## Plan completo

Archivos en `.planning/phases/2-walking-skeleton-wp/`:

- `RESEARCH.md` (~3,400 palabras): WordPress REST + webhooks, cascade design (5 niveles), embeddings (`text-embedding-3-small` @ 1536 dims + pgvector HNSW), LLM arbiter reuse desde scripts/discovery, "Hoy" view via 5 SECURITY INVOKER views, validation queue UX, latency budget, WP CSV mapping profile.
- `PATTERNS.md` (~2,200 palabras): mapping de los 16 archivos nuevos a sus analogs en F1.
- `PLAN.md` (25 plans, 84h, 6 waves).
- `PLAN-CHECK.md`: VERDICT **PASS** con 7 warnings no-bloqueantes (WARNING-3 ya arreglado inline, los demás están documentados).

## Ejecución completada

### Wave 0 — Scaffolding ✓

| Plan | Commit | Qué hizo |
|---|---|---|
| 2.0.1 | `8fa9723` | Extracción `@faka/llm` package + shim en `scripts/discovery/llm-arbiter.ts` |
| 2.0.2 | `34c19b8` | Env vars F2 (WordPress + matching + embeddings + LLM providers) + CC-11 regex extendido |
| 2.0.3 | `51a2370` | WordPress orders CSV mapping profile en `seed.sql` (WC Order Export Lite shape) |
| 2.0.4 | `7b1c73e` | Pinea deps Wave 2 en `@faka/connectors` (`@woocommerce/woocommerce-rest-api`, `ai`, `@ai-sdk/openai`, `p-limit`, `msw`) |
| - | `d15b397` | Bump Node 22.11 → 22.13 (msw 2.14+ engine requirement) |
| - | `339d01a` + `e3838fd` | Prettier-fixes de los nuevos archivos |

### Wave 1 — Schema ✓

| Plan | Commit | Qué hizo |
|---|---|---|
| - | `50baf83` | CI: subir database.ts generado como artifact (ergonomía) |
| 2.1.1 | `9698866` | Migration `20260601000001_product_embeddings.sql` (vector(1536) + HNSW + `find_similar_products`) |
| 2.1.2 | `54acb4f` | Migration `20260601000002_hoy_views.sql` (5 SECURITY INVOKER views — totals, per_channel + analista-variant, top_products, last_hour) |
| 2.1.3 | `9a4cd28` | Regenerar `packages/db/types/database.ts` (+227 líneas) + nota en `DEPLOY.md` |

Run de referencia (último verde): `25838778257` o el siguiente. Lint + tests + DB integration en verde.

## Lo que falta

### Wave 2 — Connectors (5 plans, ~22h)

- 2.2.1 — WordPress connector real impl + degraded mode (env unset)
- 2.2.2 — Cascade levels 1-3 (barcode + supplier_code + normalized_name)
- 2.2.3 — Cascade level 4 (embeddings service)
- 2.2.4 — Cascade level 5 (LLM arbiter wiring)
- 2.2.5 — Cascade orchestrator + product_mappings UPSERT

### Wave 3 — Orchestrator (4 plans, ~14h)

- 2.3.1 — Hono `/webhooks/wordpress` route (HMAC verify + raw-body + dedupe by delivery ID)
- 2.3.2 — Cron: sync-wp-orders (every 1h)
- 2.3.3 — Cron: sync-wp-products (every 1h)
- 2.3.4 — Cron: re-cascade-unmatched + reembed-products

### Wave 4 — Dashboard UI (5 plans, ~20h)

- 2.4.1 — `/matching` validation queue page
- 2.4.2 — `/matching/[mappingId]` detail page con cascade decision viz
- 2.4.3 — Server Actions: validate-mapping, reject-mapping, bulk-validate
- 2.4.4 — `/hoy` page (4 server components — totals, per-channel chart, top products, live feed)
- 2.4.5 — Live-feed Client Component (Realtime) + WP CSV upload wizard callout

### Wave 5 — Tests + verify (4 plans, ~8h)

- 2.5.1 — vitest integration configs reales para `apps/dashboard` y `apps/orchestrator`
- 2.5.2 — Tests cascade (5 niveles + sticky validado_humano)
- 2.5.3 — Tests webhook HMAC
- 2.5.4 — Smoke + latency budget script (`wp-latency-smoke.ts`)

## Demo path (sin credenciales WP)

WP-02 → WP-03 → WP-04 → WP-05 → WP-06 son demostrables solo con CSVs. Wave 2.2.1 cierra el WP REST connector con graceful-degrade (`healthCheck` retorna `ok:false`, fetchOrders no-op, webhook 503s) hasta que el cliente entregue las 4 vars: `WORDPRESS_API_URL`, `WORDPRESS_API_KEY`, `WORDPRESS_API_SECRET`, `WORDPRESS_WEBHOOK_SECRET`.

## Cómo retomar

1. Lee este archivo + `.planning/phases/2-walking-skeleton-wp/PLAN.md` desde Wave 2.
2. Empieza por Plan 2.2.1 (WordPress connector).
3. CI valida cada commit; el patrón es: editar local → commit → push → si falla algo de types, bajar el artifact `database-types` y commitearlo.
4. Wave 2.2.X pueden ejecutarse en paralelo después de Wave 1 (que ya está cerrada).
