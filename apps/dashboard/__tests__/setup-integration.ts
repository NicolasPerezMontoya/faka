/**
 * Integration-test setup helpers for the dashboard app (Plan 2.5.1).
 *
 * Two responsibilities:
 *   1. Surface a `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY` env
 *      check as a boolean (`liveDbConfigured`) so test files can wrap their
 *      describe blocks with `describeLive` / `itLive` — when the test DB is
 *      not configured the tests skip cleanly rather than failing the suite.
 *   2. Print a one-line note at the top of the run so it's obvious whether
 *      the integration suite ran against a live DB or skipped through.
 *
 * No `supabase db reset` here on purpose: each integration test seeds its own
 * fixtures inside `beforeAll` / `beforeEach`. Centralising reset in setup
 * would couple test files to a single ordering and make per-test isolation
 * harder. Test files that need a clean slate can call `supabase.rpc('truncate_*')`
 * themselves or scope inserts under a test-specific prefix (the F2.1 convention).
 */

export const liveDbConfigured: boolean =
  Boolean(process.env.TEST_SUPABASE_URL) &&
  Boolean(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY);

// One-line announce. Helpful when scanning CI logs.
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
