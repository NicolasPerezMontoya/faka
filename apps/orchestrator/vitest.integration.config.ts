/**
 * Vitest integration test config for the orchestrator app (Plan 2.5.1).
 *
 * Replaces the F1-era noop `test:integration` script (ESTADO.md §"Pendientes
 * menores" item 1.4.3). Mirrors `apps/dashboard/vitest.integration.config.ts`
 * — same gating env vars, same skip semantics, same 30s testTimeout.
 *
 * **Gating contract** (mirrors `packages/connectors/__tests__/matching/levels.test.ts`):
 *   - `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` opt in.
 *   - Either missing → integration `describe` blocks skip; suite exits 0.
 *
 * Plan 2.5.3's webhook + cron integration tests will land under
 * `apps/orchestrator/__tests__/**/*.integration.test.ts` and inherit this
 * config + the shared `setup-integration.ts` helper.
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
      "**/.turbo/**",
    ],
    setupFiles: ["./__tests__/setup-integration.ts"],
    // Match dashboard config — local Supabase reset / seed can take 20s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
