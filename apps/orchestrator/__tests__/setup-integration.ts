/**
 * Integration-test setup helpers for the orchestrator app (Plan 2.5.1).
 *
 * Mirror of `apps/dashboard/__tests__/setup-integration.ts` — see that file
 * for design notes. Kept as a separate file (rather than a shared package)
 * so each app's integration config remains self-contained and can evolve
 * independently (the orchestrator may grow Hono-specific helpers; the
 * dashboard may grow Next-specific test handles).
 */

export const liveDbConfigured: boolean =
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY);

if (!liveDbConfigured) {
  // eslint-disable-next-line no-console
  console.log(
    "[setup-integration] TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY " +
      "not set — integration test bodies will skip themselves.",
  );
} else {
  // eslint-disable-next-line no-console
  console.log(
    "[setup-integration] live DB configured — integration tests will run " +
      "against " +
      String(process.env.TEST_SUPABASE_URL),
  );
}
