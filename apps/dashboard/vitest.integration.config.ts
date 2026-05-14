/**
 * Vitest integration test config for the dashboard app (Plan 2.5.1).
 *
 * Replaces the F1-era noop `test:integration` script (ESTADO.md §"Pendientes
 * menores" item 1.2.5). The intent is to discover any `*.integration.test.ts`
 * under `apps/dashboard/` and run them against a live Supabase.
 *
 * **Gating contract** (mirrors `packages/connectors/__tests__/matching/levels.test.ts`):
 *   - Set `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` to opt in.
 *   - If either is missing, the affected `describeLive` blocks skip themselves
 *     — the suite still exits 0 so local dev and CI without a test DB stay
 *     green. This is the F2.1 convention (Plan 2.2.2's `liveDbConfigured`
 *     pattern) that all subsequent integration tests inherit.
 *
 * F2.1 inheritance: future integration tests (Plan 2.5.3 webhooks + RLS +
 * hoy views) MUST use the same gating constants and skip semantics — see
 * `__tests__/setup-integration.ts` for the shared helpers.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
    ],
    setupFiles: ["./__tests__/setup-integration.ts"],
    // Supabase reset / seeding can take 20s on a cold local stack.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
