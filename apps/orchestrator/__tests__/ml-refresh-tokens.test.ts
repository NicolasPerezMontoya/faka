/**
 * Tests for `runMlRefreshTokens` — Plan 2.1.1.4 ML refresh-tokens cron.
 *
 * Coverage:
 *   (a) Degraded mode (config not_configured) → succeeded run, exit 0
 *       semantics (we assert via return value rather than process.exit),
 *       errors_json.reason='not_configured', metadata_json.tipo='refresh-tokens',
 *       NO refreshToken calls, NO oauth_tokens queries.
 *   (b) No candidates (every token comfortably in the future) → succeeded
 *       run with records_processed=0 and candidates=0.
 *   (c) Two candidates, both refreshed → succeeded run, records_processed=2.
 *   (d) Two candidates, one fails → partial run, errors_json has the failing
 *       user_id, the OTHER user still got refreshed.
 *   (e) oauth_tokens query error → failed run with reason='query_failed',
 *       no refreshToken calls.
 *   (f) W2 invariant: every connector_runs row is kind='channel' +
 *       canal='mercadolibre' (the helper enforces this; the test confirms
 *       the cron passes the right pair).
 *
 * Strategy: drive `runMlRefreshTokens` directly with a hand-rolled supabase
 * chain + injected loader / logger. No real Supabase, no real network. The
 * `refreshToken` invocation is mocked at the module level so we can assert
 * exact per-user dispatch without spinning up the full OAuth surface.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// -----------------------------------------------------------------------------
// Module mocks — must be hoisted via vi.mock before importing the SUT.
// -----------------------------------------------------------------------------

const refreshTokenMock = vi.fn();

vi.mock("@faka/connectors/mercadolibre/oauth.js", () => ({
  refreshToken: refreshTokenMock,
}));

// Pin the config import surface — the SUT reads `loadMercadoLibreConfig`
// indirectly via the `deps.loadConfig` override in tests, so we don't need
// to mock it. The static import still resolves to the real module.

import { runMlRefreshTokens } from "../src/jobs/ml-refresh-tokens.js";
import type { LoadedMLConfig } from "@faka/connectors/mercadolibre/config.js";

// -----------------------------------------------------------------------------
// Supabase mock — minimal chain
// -----------------------------------------------------------------------------

interface MockState {
  candidates: Array<{ user_id: string; expires_at: string }>;
  queryError: { message: string } | null;
  connectorRuns: Array<Record<string, unknown>>;
}

function makeSupabaseMock(initial: Partial<MockState> = {}) {
  const state: MockState = {
    candidates: initial.candidates ?? [],
    queryError: initial.queryError ?? null,
    connectorRuns: [],
  };

  function fromOauthTokens() {
    return {
      select: (_cols: string) => ({
        eq: (_c1: string, _v1: unknown) => ({
          lt: async (_c2: string, _v2: unknown) => {
            if (state.queryError) {
              return { data: null, error: state.queryError };
            }
            return { data: state.candidates, error: null };
          },
        }),
      }),
    };
  }

  function fromConnectorRuns() {
    return {
      insert: async (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) state.connectorRuns.push(r);
        return {
          data: rows.map((_, i) => ({
            id: `cr_${state.connectorRuns.length - rows.length + i}`,
          })),
          error: null,
          select: () => ({
            single: async () => ({
              data: { id: `cr_${state.connectorRuns.length - 1}` },
              error: null,
            }),
          }),
        };
      },
      // recordConnectorRun chains `.insert(...).select().single()`.
    };
  }

  const supabase = {
    from(table: string) {
      if (table === "oauth_tokens") return fromOauthTokens();
      if (table === "connector_runs") {
        // recordConnectorRun does insert(...).select().single()
        return {
          insert: (row: Record<string, unknown>) => {
            state.connectorRuns.push(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: `cr_${state.connectorRuns.length - 1}` },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  } as unknown as Parameters<typeof runMlRefreshTokens>[0]["getSupabase"] extends
    | undefined
    | (() => infer R)
    ? R
    : never;

  return { supabase: supabase as never, state };
}

function silentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeCfg(ok: boolean, missing: string[] = []): LoadedMLConfig {
  if (ok) {
    return {
      ok: true,
      cfg: {
        clientId: "TEST_CLIENT",
        clientSecret: "TEST_SECRET",
        redirectUri: "https://orchestrator.test/oauth/mercadolibre/callback",
        webhookSecret: "TEST_WEBHOOK",
        siteId: "MCO",
      },
    };
  }
  return { ok: false, reason: "not_configured", missing };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

beforeEach(() => {
  refreshTokenMock.mockReset();
});

describe("runMlRefreshTokens — degraded mode (not_configured)", () => {
  it("writes succeeded connector_runs row and does NOT call refreshToken or query oauth_tokens", async () => {
    const { supabase, state } = makeSupabaseMock();
    const result = await runMlRefreshTokens({
      getSupabase: () => supabase,
      loadConfig: () => makeCfg(false, ["ML_CLIENT_ID", "ML_CLIENT_SECRET"]),
      logger: silentLogger(),
    });

    expect(result.status).toBe("not_configured");
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(0);

    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(state.connectorRuns.length).toBe(1);
    expect(state.connectorRuns[0].status).toBe("succeeded");
    expect(state.connectorRuns[0].kind).toBe("channel");
    expect(state.connectorRuns[0].canal).toBe("mercadolibre");

    const errors = state.connectorRuns[0].errors_json as Record<string, unknown>;
    expect(errors.reason).toBe("not_configured");
    expect(errors.missing).toEqual(["ML_CLIENT_ID", "ML_CLIENT_SECRET"]);

    const meta = state.connectorRuns[0].metadata_json as Record<string, unknown>;
    expect(meta.tipo).toBe("refresh-tokens");
    expect(meta.source).toBe("ml-refresh-cron");
  });
});

describe("runMlRefreshTokens — happy path", () => {
  it("no candidates → succeeded run with records_processed=0", async () => {
    const { supabase, state } = makeSupabaseMock({ candidates: [] });
    const result = await runMlRefreshTokens({
      getSupabase: () => supabase,
      loadConfig: () => makeCfg(true),
      logger: silentLogger(),
    });

    expect(result.status).toBe("succeeded");
    expect(result.candidates).toBe(0);
    expect(result.refreshed).toBe(0);
    expect(refreshTokenMock).not.toHaveBeenCalled();

    expect(state.connectorRuns.length).toBe(1);
    expect(state.connectorRuns[0].status).toBe("succeeded");
    expect(state.connectorRuns[0].records_processed).toBe(0);
  });

  it("two candidates, both refreshed → succeeded run with records_processed=2", async () => {
    refreshTokenMock.mockResolvedValue({ ok: true, access_token: "NEW" });

    const { supabase, state } = makeSupabaseMock({
      candidates: [
        { user_id: "USR_A", expires_at: new Date(Date.now() + 1800_000).toISOString() },
        { user_id: "USR_B", expires_at: new Date(Date.now() + 2400_000).toISOString() },
      ],
    });
    const result = await runMlRefreshTokens({
      getSupabase: () => supabase,
      loadConfig: () => makeCfg(true),
      logger: silentLogger(),
    });

    expect(result.status).toBe("succeeded");
    expect(result.candidates).toBe(2);
    expect(result.refreshed).toBe(2);
    expect(result.failed).toBe(0);

    expect(refreshTokenMock).toHaveBeenCalledTimes(2);
    expect(refreshTokenMock).toHaveBeenNthCalledWith(1, supabase, expect.any(Object), "USR_A");
    expect(refreshTokenMock).toHaveBeenNthCalledWith(2, supabase, expect.any(Object), "USR_B");

    expect(state.connectorRuns.length).toBe(1);
    expect(state.connectorRuns[0].records_processed).toBe(2);
    expect(state.connectorRuns[0].records_failed).toBe(0);
  });
});

describe("runMlRefreshTokens — partial-batch resilience", () => {
  it("one candidate fails → partial run, OTHER user still refreshed, errors_json captures the failure", async () => {
    refreshTokenMock.mockImplementation(
      async (
        _supabase: unknown,
        _cfg: unknown,
        userId: string,
      ): Promise<{ ok: true; access_token: string } | { ok: false; error: string }> => {
        if (userId === "USR_BROKEN") {
          return { ok: false, error: "refresh_failed_after_retries" };
        }
        return { ok: true, access_token: "NEW" };
      },
    );

    const { supabase, state } = makeSupabaseMock({
      candidates: [
        { user_id: "USR_BROKEN", expires_at: new Date(Date.now() + 600_000).toISOString() },
        { user_id: "USR_OK", expires_at: new Date(Date.now() + 700_000).toISOString() },
      ],
    });
    const result = await runMlRefreshTokens({
      getSupabase: () => supabase,
      loadConfig: () => makeCfg(true),
      logger: silentLogger(),
    });

    expect(result.status).toBe("partial");
    expect(result.refreshed).toBe(1);
    expect(result.failed).toBe(1);

    expect(refreshTokenMock).toHaveBeenCalledTimes(2);

    expect(state.connectorRuns.length).toBe(1);
    expect(state.connectorRuns[0].status).toBe("partial");
    expect(state.connectorRuns[0].records_processed).toBe(1);
    expect(state.connectorRuns[0].records_failed).toBe(1);

    const errors = state.connectorRuns[0].errors_json as
      | { errors: Array<{ user_id: string; message: string }> }
      | null;
    expect(errors).not.toBeNull();
    expect(errors!.errors).toHaveLength(1);
    expect(errors!.errors[0].user_id).toBe("USR_BROKEN");
    expect(errors!.errors[0].message).toBe("refresh_failed_after_retries");
  });

  it("all candidates fail → failed run", async () => {
    refreshTokenMock.mockResolvedValue({ ok: false, error: "ml_token_endpoint_500" });

    const { supabase, state } = makeSupabaseMock({
      candidates: [
        { user_id: "USR_1", expires_at: new Date(Date.now() + 600_000).toISOString() },
        { user_id: "USR_2", expires_at: new Date(Date.now() + 700_000).toISOString() },
      ],
    });
    const result = await runMlRefreshTokens({
      getSupabase: () => supabase,
      loadConfig: () => makeCfg(true),
      logger: silentLogger(),
    });

    expect(result.status).toBe("failed");
    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(2);
    expect(state.connectorRuns[0].status).toBe("failed");
  });
});

describe("runMlRefreshTokens — query failure", () => {
  it("oauth_tokens query errors → failed run, reason='query_failed', NO refresh calls", async () => {
    const { supabase, state } = makeSupabaseMock({
      queryError: { message: "relation oauth_tokens does not exist" },
    });
    const result = await runMlRefreshTokens({
      getSupabase: () => supabase,
      loadConfig: () => makeCfg(true),
      logger: silentLogger(),
    });

    expect(result.status).toBe("failed");
    expect(refreshTokenMock).not.toHaveBeenCalled();

    expect(state.connectorRuns.length).toBe(1);
    expect(state.connectorRuns[0].status).toBe("failed");
    const errors = state.connectorRuns[0].errors_json as Record<string, unknown>;
    expect(errors.reason).toBe("query_failed");
    expect(errors.message).toBe("relation oauth_tokens does not exist");
  });
});

describe("runMlRefreshTokens — W2 invariant (kind/canal coherence)", () => {
  it("every connector_runs row uses kind='channel' + canal='mercadolibre' + metadata.tipo='refresh-tokens'", async () => {
    refreshTokenMock.mockResolvedValue({ ok: true, access_token: "X" });

    const { supabase, state } = makeSupabaseMock({
      candidates: [
        { user_id: "USR_X", expires_at: new Date(Date.now() + 1800_000).toISOString() },
      ],
    });
    await runMlRefreshTokens({
      getSupabase: () => supabase,
      loadConfig: () => makeCfg(true),
      logger: silentLogger(),
    });

    for (const row of state.connectorRuns) {
      expect(row.kind).toBe("channel");
      expect(row.canal).toBe("mercadolibre");
      const meta = row.metadata_json as Record<string, unknown>;
      expect(meta.tipo).toBe("refresh-tokens");
      expect(meta.source).toBe("ml-refresh-cron");
    }
  });
});
