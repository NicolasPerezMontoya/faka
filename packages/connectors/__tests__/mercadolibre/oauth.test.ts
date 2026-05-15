/**
 * Tests for `packages/connectors/src/mercadolibre/oauth.ts` (Plan 2.1.1.2).
 *
 * Coverage matrix (verifies clause from PLAN.md §2.1.1.2 + Plan 2.1.4.1 test
 * gate at line 333 — the seven cases land here):
 *
 *   1. exchangeCodeForToken: ml-token-response.json fixture round-trips.
 *   2. refreshToken: rotation UPSERTs BOTH new access_token AND refresh_token.
 *   3. refreshToken: race regression — Promise.all([refresh, refresh])
 *      issues exactly ONE upstream call due to the advisory lock.
 *   4. refreshToken: 401 from upstream → structured error (no throw, no
 *      partial UPSERT — Pitfall 1 corollary).
 *   5. refreshToken: lock RPC unavailable → structured error (don't risk
 *      bricking on missing helper fn).
 *   6. loadAccessToken: triggers refresh when expires_at < now() + 60s.
 *   7. loadAccessToken: returns cached token when expires_at is far in the
 *      future.
 *
 * Test strategy:
 *   - Mock ML's `/oauth/token` upstream via undici's `MockAgent`. This is
 *     the canonical undici test path — no msw needed.
 *   - Mock Supabase with a hand-rolled chain that records every call so we
 *     can assert the rotation UPSERT shape and the lock-RPC dispatch order.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from "undici";
import {
  exchangeCodeForToken,
  refreshToken,
  loadAccessToken,
} from "../../src/mercadolibre/oauth.js";
import type { MLConfig } from "../../src/mercadolibre/types.js";
import tokenFixture from "../__fixtures__/ml-token-response.json";

// -----------------------------------------------------------------------------
// undici MockAgent setup
// -----------------------------------------------------------------------------

let originalDispatcher: Dispatcher;
let mockAgent: MockAgent;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  await mockAgent.close();
  setGlobalDispatcher(originalDispatcher);
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// Fixtures + helpers
// -----------------------------------------------------------------------------

const CFG: MLConfig = {
  clientId: "TEST_CLIENT_ID",
  clientSecret: "TEST_CLIENT_SECRET",
  redirectUri: "https://orchestrator.test/oauth/mercadolibre/callback",
  webhookSecret: "TEST_WEBHOOK_SECRET",
};

function pool() {
  return mockAgent.get("https://api.mercadolibre.com");
}

interface OauthTokenRowStub {
  canal: "mercadolibre";
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
  created_at?: string;
  updated_at?: string;
  id?: string;
}

interface SupabaseMockState {
  tokenRow: OauthTokenRowStub | null;
  lockResults: boolean[]; // one per call to `rpc('try_acquire_advisory_lock')`
  upsertCalls: Array<Record<string, unknown>>;
  dlqInserts: Array<Record<string, unknown>>;
  rpcCalls: Array<{ fn: string; args: unknown }>;
}

function makeSupabaseMock(initial: Partial<SupabaseMockState> = {}) {
  const state: SupabaseMockState = {
    tokenRow: initial.tokenRow ?? null,
    lockResults: initial.lockResults ?? [true],
    upsertCalls: [],
    dlqInserts: [],
    rpcCalls: [],
  };

  let lockCallIndex = 0;

  function fromOauthTokens() {
    return {
      select: (_cols: string) => {
        return {
          eq: (_c1: string, _v1: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              maybeSingle: async () => ({
                data: state.tokenRow,
                error: null,
              }),
            }),
          }),
        };
      },
      upsert: async (row: Record<string, unknown>, _opts: unknown) => {
        state.upsertCalls.push(row);
        state.tokenRow = {
          canal: "mercadolibre",
          user_id: row.user_id as string,
          access_token: row.access_token as string,
          refresh_token: row.refresh_token as string,
          expires_at: row.expires_at as string,
          scope: (row.scope as string | null) ?? null,
        };
        return { error: null };
      },
      delete: () => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: async (_c2: string, _v2: unknown) => {
            state.tokenRow = null;
            return { error: null };
          },
        }),
      }),
    };
  }

  function fromDLQ() {
    return {
      insert: async (row: Record<string, unknown>) => {
        state.dlqInserts.push(row);
        return { error: null };
      },
    };
  }

  const supabase = {
    from(table: string) {
      if (table === "oauth_tokens") return fromOauthTokens();
      if (table === "dead_letter_queue") return fromDLQ();
      throw new Error(`unexpected from(${table})`);
    },
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      if (fn === "try_acquire_advisory_lock") {
        const r = state.lockResults[lockCallIndex] ?? false;
        lockCallIndex += 1;
        return { data: r, error: null };
      }
      return { data: null, error: { message: `unexpected_rpc_${fn}` } };
    },
  };

  return { supabase, state };
}

// -----------------------------------------------------------------------------
// (1) exchangeCodeForToken
// -----------------------------------------------------------------------------

describe("exchangeCodeForToken", () => {
  it("round-trips a ml-token-response.json fixture", async () => {
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, tokenFixture);

    const { supabase } = makeSupabaseMock();
    const result = await exchangeCodeForToken(CFG, "AUTH_CODE_X", supabase);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.access_token).toBe(tokenFixture.access_token);
      // refresh_token MUST be present in the envelope so the callback handler
      // can UPSERT it. CRITICAL invariant from PATTERNS §2.
      expect(result.response.refresh_token).toBe(tokenFixture.refresh_token);
      expect(result.response.expires_in).toBe(tokenFixture.expires_in);
    }
  });

  it("returns ok:false on a non-2xx upstream after retries exhaust", async () => {
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(400, { error: "invalid_grant" })
      .persist();

    const { supabase, state } = makeSupabaseMock();
    const result = await exchangeCodeForToken(CFG, "BAD_CODE", supabase);

    expect(result.ok).toBe(false);
    // DLQ wrote a row that does NOT contain the auth code (Pitfall: never
    // persist secrets in DLQ).
    expect(state.dlqInserts.length).toBeGreaterThan(0);
    const dlqPayload = state.dlqInserts[0].payload_json as Record<string, unknown>;
    expect(JSON.stringify(dlqPayload)).not.toContain("BAD_CODE");
  });
});

// -----------------------------------------------------------------------------
// (2) refreshToken — rotation
// -----------------------------------------------------------------------------

describe("refreshToken — single-flight rotation", () => {
  it("rotates BOTH access_token AND refresh_token in one UPSERT", async () => {
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, {
        ...tokenFixture,
        access_token: "NEW_ACCESS_AAA",
        refresh_token: "NEW_REFRESH_BBB",
      });

    const { supabase, state } = makeSupabaseMock({
      tokenRow: {
        canal: "mercadolibre",
        user_id: "USR_1",
        access_token: "OLD_ACCESS",
        refresh_token: "OLD_REFRESH",
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        scope: "offline_access read write",
      },
    });

    const out = await refreshToken(supabase, CFG, "USR_1");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.access_token).toBe("NEW_ACCESS_AAA");
    }
    // ONE upsert, containing BOTH new tokens.
    expect(state.upsertCalls.length).toBe(1);
    expect(state.upsertCalls[0].access_token).toBe("NEW_ACCESS_AAA");
    expect(state.upsertCalls[0].refresh_token).toBe("NEW_REFRESH_BBB");
    expect(state.upsertCalls[0].canal).toBe("mercadolibre");
    expect(state.upsertCalls[0].user_id).toBe("USR_1");
    // Lock was acquired (advisory_lock_call recorded).
    expect(state.rpcCalls[0].fn).toBe("try_acquire_advisory_lock");
  });

  it("returns structured error on 401 — no partial UPSERT", async () => {
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(401, { error: "invalid_token" })
      .persist();

    const { supabase, state } = makeSupabaseMock({
      tokenRow: {
        canal: "mercadolibre",
        user_id: "USR_2",
        access_token: "OLD_ACCESS",
        refresh_token: "OLD_REFRESH",
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        scope: null,
      },
    });

    const out = await refreshToken(supabase, CFG, "USR_2");
    expect(out.ok).toBe(false);
    // CRITICAL: no UPSERT happened. A partial UPSERT (with stale refresh_token)
    // would have bricked the integration.
    expect(state.upsertCalls.length).toBe(0);
  });

  it("returns structured error when the advisory_lock RPC is unavailable", async () => {
    const { supabase, state } = makeSupabaseMock();
    // Override rpc to return an error envelope.
    const originalRpc = supabase.rpc;
    supabase.rpc = async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      return { data: null, error: { message: "function does not exist" } };
    };

    const out = await refreshToken(supabase, CFG, "USR_3");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/advisory_lock_unavailable/);
    }
    expect(state.upsertCalls.length).toBe(0);
    // Restore.
    supabase.rpc = originalRpc;
  });
});

// -----------------------------------------------------------------------------
// (3) refreshToken — race regression (RESEARCH §Pitfall 1)
// -----------------------------------------------------------------------------

describe("refreshToken — advisory lock race regression", () => {
  it("Promise.all([refresh, refresh]) issues exactly ONE upstream call", async () => {
    // ML pool only allows ONE token POST — second would 404 because we don't
    // .persist() the interceptor.
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, {
        ...tokenFixture,
        access_token: "ROTATED_ACCESS",
        refresh_token: "ROTATED_REFRESH",
      });

    const { supabase, state } = makeSupabaseMock({
      tokenRow: {
        canal: "mercadolibre",
        user_id: "USR_RACE",
        access_token: "OLD_ACCESS",
        refresh_token: "OLD_REFRESH",
        expires_at: new Date(Date.now() + 5_000).toISOString(),
        scope: null,
      },
      // Winner acquires (true); loser is contested (false).
      lockResults: [true, false],
    });

    const [a, b] = await Promise.all([
      refreshToken(supabase, CFG, "USR_RACE"),
      refreshToken(supabase, CFG, "USR_RACE"),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // The winning call rotated; the loser re-read the post-rotation row and
    // returned the new access_token without issuing a second POST. Exactly
    // ONE token-endpoint hit happened (only one interceptor was registered;
    // a second hit would 404 and trip the .ok === false assertions above).
    expect(state.upsertCalls.length).toBe(1);
    expect(state.upsertCalls[0].access_token).toBe("ROTATED_ACCESS");
    expect(state.upsertCalls[0].refresh_token).toBe("ROTATED_REFRESH");

    // Both callers eventually see the rotated access_token — the loser via
    // re-read, the winner via direct return.
    if (a.ok) expect(a.access_token).toBe("ROTATED_ACCESS");
    if (b.ok) expect(b.access_token).toBe("ROTATED_ACCESS");

    // Both advisory_lock RPC calls happened.
    const lockCalls = state.rpcCalls.filter(
      (c) => c.fn === "try_acquire_advisory_lock",
    );
    expect(lockCalls.length).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// (4) loadAccessToken
// -----------------------------------------------------------------------------

describe("loadAccessToken", () => {
  it("returns the cached token when expires_at is comfortably in the future", async () => {
    const { supabase, state } = makeSupabaseMock({
      tokenRow: {
        canal: "mercadolibre",
        user_id: "USR_OK",
        access_token: "CACHED_ACCESS",
        refresh_token: "CACHED_REFRESH",
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        scope: null,
      },
    });

    const token = await loadAccessToken(supabase, CFG, { userId: "USR_OK" });
    expect(token).toBe("CACHED_ACCESS");
    // No refresh happened — no UPSERT, no advisory_lock call, no ML hit.
    expect(state.upsertCalls.length).toBe(0);
    expect(
      state.rpcCalls.filter((c) => c.fn === "try_acquire_advisory_lock").length,
    ).toBe(0);
  });

  it("triggers refresh when expires_at is within the 60s skew window", async () => {
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, {
        ...tokenFixture,
        access_token: "REFRESHED_ACCESS",
        refresh_token: "REFRESHED_REFRESH",
      });

    const { supabase, state } = makeSupabaseMock({
      tokenRow: {
        canal: "mercadolibre",
        user_id: "USR_SOON",
        access_token: "STALE_ACCESS",
        refresh_token: "STALE_REFRESH",
        // 10 seconds left — well inside the 60s skew window.
        expires_at: new Date(Date.now() + 10_000).toISOString(),
        scope: null,
      },
    });

    const token = await loadAccessToken(supabase, CFG, { userId: "USR_SOON" });
    expect(token).toBe("REFRESHED_ACCESS");
    expect(state.upsertCalls.length).toBe(1);
    // Both rotated tokens persisted in the same write — the partial-UPSERT
    // failure mode would brick the integration.
    expect(state.upsertCalls[0].refresh_token).toBe("REFRESHED_REFRESH");
  });

  it("returns null when no token row exists for the user", async () => {
    const { supabase } = makeSupabaseMock({ tokenRow: null });
    const token = await loadAccessToken(supabase, CFG, { userId: "NOPE" });
    expect(token).toBeNull();
  });

  it("opts.lazyRefreshOn401=true forces a refresh even with a far-future expiry", async () => {
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, {
        ...tokenFixture,
        access_token: "FORCE_REFRESHED",
        refresh_token: "FORCE_REFRESHED_REF",
      });

    const { supabase, state } = makeSupabaseMock({
      tokenRow: {
        canal: "mercadolibre",
        user_id: "USR_401",
        access_token: "BANNED_BY_ML",
        refresh_token: "STILL_VALID_REFRESH",
        // Plenty of headroom — but the api-client saw a 401, so force rotation.
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        scope: null,
      },
    });

    const token = await loadAccessToken(supabase, CFG, {
      userId: "USR_401",
      lazyRefreshOn401: true,
    });
    expect(token).toBe("FORCE_REFRESHED");
    expect(state.upsertCalls.length).toBe(1);
  });
});
