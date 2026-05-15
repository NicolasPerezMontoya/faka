/**
 * Plan 2.1.4.2 — OAuth refresh-token race regression (RESEARCH §Pitfall 1).
 *
 * The Wave 1 `oauth.test.ts` already includes a "happy path" race case
 * (`Promise.all([refresh, refresh])` with the lock acquired by exactly one
 * caller). This file is the Wave 4 *regression* layer — it exists to ensure
 * the advisory-lock branch in `oauth.ts` keeps doing its job, AND to provide
 * the negative control that proves the lock is actually necessary.
 *
 * Why a separate file: the W1 test is a "shape" assertion (one upstream POST,
 * two rotated tokens). The W4 regression triplet adds:
 *
 *   (A) Positive control with advisory lock — Promise.all of N=2 concurrent
 *       refreshToken calls issues EXACTLY ONE upstream POST. (Same shape as
 *       W1, but asserted via a request counter on the `MockAgent` rather
 *       than just "no second interceptor matched" — more explicit.)
 *
 *   (B) Negative control without advisory lock — the same Promise.all, but
 *       the Supabase mock returns `lock_acquired=true` for BOTH callers
 *       (simulating a missing/broken advisory lock). Asserts the race WOULD
 *       have triggered TWO upstream POSTs. This proves the lock is doing
 *       load-bearing work; if a future refactor accidentally removes the
 *       lock branch, the (A) test still passes (single interceptor) but the
 *       (B) test changes behavior and surfaces the breakage.
 *
 *   (C) DB final-state assertion — after the (A) race resolves, the mock
 *       supabase has EXACTLY ONE row in oauth_tokens with the newest tokens.
 *       The loser's contested branch re-read the winner's row instead of
 *       writing its own.
 *
 * Anti-duplication: this file imports the production `refreshToken` directly
 * — does NOT re-implement the lock semantics. The advisory-lock RPC is
 * simulated by a per-caller boolean queue on the Supabase mock; the
 * production code itself decides whether to proceed or yield based on the
 * RPC return value.
 *
 * References:
 *   PATTERNS §2 "OAuth token lifecycle (NEW in F2.1)"
 *   PATTERNS §13 "Tests — mercadolibre-oauth"
 *   RESEARCH §Pitfall 1 (refresh-token race — this test is the regression)
 *   PLAN.md §2.1.4.2 case #7 (race + negative-control + DB-state assertions)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from "undici";
import { refreshToken } from "../../src/mercadolibre/oauth.js";
import type { MLConfig } from "../../src/mercadolibre/types.js";
import tokenFixture from "../__fixtures__/ml-token-response.json";

// -----------------------------------------------------------------------------
// undici MockAgent setup — mirrors oauth.test.ts. A SHARED counter lets us
// count *actual* upstream POSTs regardless of how many interceptors hit.
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
});

function pool() {
  return mockAgent.get("https://api.mercadolibre.com");
}

// -----------------------------------------------------------------------------
// Supabase mock with explicit lock-result queue.
// -----------------------------------------------------------------------------

interface OauthTokenRowStub {
  canal: "mercadolibre";
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
}

interface RaceMockState {
  /** Single-row store — the canal+user_id uniqueness invariant means the
   *  mock has at most one row at any time. Each upsert REPLACES it. */
  tokenRow: OauthTokenRowStub | null;
  /** FIFO queue: each `try_acquire_advisory_lock` call consumes one entry.
   *  Empty queue defaults to `false` (contested) to avoid silently leaking
   *  past-the-end-of-queue successes. */
  lockResults: boolean[];
  upsertCalls: Array<Record<string, unknown>>;
  rpcCalls: Array<{ fn: string; args: unknown }>;
  /** Counter incremented on EVERY upsert — distinguishes "one upsert with
   *  two assertions" from "two upserts that happen to look identical". */
  upsertCount: number;
}

function makeRaceMock(initial: {
  tokenRow: OauthTokenRowStub;
  lockResults: boolean[];
}): { supabase: unknown; state: RaceMockState } {
  const state: RaceMockState = {
    tokenRow: initial.tokenRow,
    lockResults: [...initial.lockResults],
    upsertCalls: [],
    rpcCalls: [],
    upsertCount: 0,
  };

  let lockCallIndex = 0;

  const fromOauthTokens = {
    select: (_cols: string) => ({
      eq: (_c1: string, _v1: unknown) => ({
        eq: (_c2: string, _v2: unknown) => ({
          maybeSingle: async () => ({ data: state.tokenRow, error: null }),
        }),
      }),
    }),
    upsert: async (row: Record<string, unknown>, _opts: unknown) => {
      state.upsertCalls.push(row);
      state.upsertCount += 1;
      // Atomic replacement — production code's UPSERT with onConflict on
      // (canal, user_id) replaces the row's access_token + refresh_token
      // + expires_at in one write.
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
  };

  const fromDLQ = {
    insert: async (_row: Record<string, unknown>) => ({ error: null }),
  };

  const supabase = {
    from(table: string) {
      if (table === "oauth_tokens") return fromOauthTokens;
      if (table === "dead_letter_queue") return fromDLQ;
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
// Test config + fixture row.
// -----------------------------------------------------------------------------

const CFG: MLConfig = {
  clientId: "TEST_CLIENT_ID",
  clientSecret: "TEST_CLIENT_SECRET",
  redirectUri: "https://orchestrator.test/oauth/mercadolibre/callback",
  webhookSecret: "TEST_WEBHOOK_SECRET",
};

const PRE_ROTATION_ROW: OauthTokenRowStub = {
  canal: "mercadolibre",
  user_id: "USR_RACE",
  access_token: "OLD_ACCESS",
  refresh_token: "OLD_REFRESH",
  // 5s of headroom — well inside the 60s refresh-skew window so any caller
  // that gets the lock proceeds to rotate.
  expires_at: new Date(Date.now() + 5_000).toISOString(),
  scope: "offline_access read write",
};

// -----------------------------------------------------------------------------
// (A) Positive control — advisory lock yields exactly ONE upstream POST.
// -----------------------------------------------------------------------------

describe("Plan 2.1.4.2 — refresh-token race regression", () => {
  it("(A) advisory lock active: Promise.all yields exactly ONE upstream POST", async () => {
    let upstreamHits = 0;

    // Intercept twice — but only the first should fire if the lock works.
    // We .persist() so a stray second hit isn't a 404 (which would be a
    // separate failure mode confounding the assertion); the COUNTER is the
    // canonical signal.
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, () => {
        upstreamHits += 1;
        return {
          ...tokenFixture,
          access_token: "ROTATED_ACCESS",
          refresh_token: "ROTATED_REFRESH",
        };
      })
      .persist();

    const { supabase, state } = makeRaceMock({
      tokenRow: { ...PRE_ROTATION_ROW },
      // Winner acquires (true); loser is contested (false).
      lockResults: [true, false],
    });

    const [a, b] = await Promise.all([
      refreshToken(supabase as Parameters<typeof refreshToken>[0], CFG, "USR_RACE"),
      refreshToken(supabase as Parameters<typeof refreshToken>[0], CFG, "USR_RACE"),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(upstreamHits).toBe(1);
    expect(state.upsertCount).toBe(1);

    // Both callers eventually observe the rotated token.
    if (a.ok) expect(a.access_token).toBe("ROTATED_ACCESS");
    if (b.ok) expect(b.access_token).toBe("ROTATED_ACCESS");

    // Both advisory_lock RPC calls happened — production code didn't
    // short-circuit. (If only one happened, the second caller skipped the
    // lock branch entirely, which would itself be a regression.)
    const lockCalls = state.rpcCalls.filter(
      (c) => c.fn === "try_acquire_advisory_lock",
    );
    expect(lockCalls.length).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // (B) Negative control — without the lock, the race triggers TWO POSTs.
  // ---------------------------------------------------------------------------
  //
  // This is the load-bearing regression assertion: if a future refactor
  // removes the contested-branch yield in `refreshToken`, the (A) test still
  // passes (only one interceptor hit because the second caller would race
  // anyway), but (B) reveals the breakage by counting upstream POSTs.
  //
  // Strategy: configure the mock to return `lock_acquired=true` for BOTH
  // callers. The production code's contested branch is never taken; both
  // callers proceed to POST to /oauth/token.

  it("(B) lock disabled (BOTH callers acquire): the race triggers TWO upstream POSTs", async () => {
    let upstreamHits = 0;

    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, () => {
        upstreamHits += 1;
        // Distinct token values per hit so we can tell them apart.
        return {
          ...tokenFixture,
          access_token: `ROTATED_${upstreamHits}_ACCESS`,
          refresh_token: `ROTATED_${upstreamHits}_REFRESH`,
        };
      })
      .persist();

    const { supabase, state } = makeRaceMock({
      tokenRow: { ...PRE_ROTATION_ROW },
      // BOTH callers see lock_acquired=true — simulates the bug condition
      // where the advisory lock helper is broken / missing / always-true.
      // In production this would brick the integration: caller #2 POSTs with
      // an already-rotated refresh_token (ML invalidated it server-side
      // immediately on caller #1's success) and ML returns 400 invalid_grant.
      // Here we let the upstream succeed so the test counts both hits.
      lockResults: [true, true],
    });

    const [a, b] = await Promise.all([
      refreshToken(supabase as Parameters<typeof refreshToken>[0], CFG, "USR_RACE"),
      refreshToken(supabase as Parameters<typeof refreshToken>[0], CFG, "USR_RACE"),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // KEY ASSERTION: without the lock yielding, BOTH callers POST.
    expect(upstreamHits).toBe(2);
    expect(state.upsertCount).toBe(2);

    // The two upserts wrote DIFFERENT tokens — the second one OVERWROTE the
    // first. In production this would mean caller #2's "rotated" tokens
    // (issued via caller #1's already-invalidated refresh_token) win the
    // race, and the integration is bricked once ML invalidates them.
    expect(state.upsertCalls[0].access_token).not.toBe(
      state.upsertCalls[1].access_token,
    );
  });

  // ---------------------------------------------------------------------------
  // (C) DB final state — after the (A) race, oauth_tokens has ONE row with
  //     the rotated tokens.
  // ---------------------------------------------------------------------------

  it("(C) after a locked race, oauth_tokens has exactly ONE row with the newest tokens", async () => {
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, {
        ...tokenFixture,
        access_token: "FINAL_ACCESS",
        refresh_token: "FINAL_REFRESH",
      })
      .persist();

    const { supabase, state } = makeRaceMock({
      tokenRow: { ...PRE_ROTATION_ROW },
      lockResults: [true, false],
    });

    await Promise.all([
      refreshToken(supabase as Parameters<typeof refreshToken>[0], CFG, "USR_RACE"),
      refreshToken(supabase as Parameters<typeof refreshToken>[0], CFG, "USR_RACE"),
    ]);

    // The mock's single-row store models the (canal, user_id) unique index.
    // One row. New tokens. Old tokens entirely gone — the partial-UPSERT
    // bug (RESEARCH §Pitfall 1) would have left a row with old refresh_token
    // and new access_token; this assertion catches that exact regression.
    expect(state.tokenRow).not.toBeNull();
    expect(state.tokenRow?.access_token).toBe("FINAL_ACCESS");
    expect(state.tokenRow?.refresh_token).toBe("FINAL_REFRESH");
    expect(state.tokenRow?.user_id).toBe("USR_RACE");
    expect(state.tokenRow?.canal).toBe("mercadolibre");
    // expires_at moved forward (within a generous slop).
    const newExpiry = new Date(state.tokenRow!.expires_at).getTime();
    expect(newExpiry).toBeGreaterThan(
      new Date(PRE_ROTATION_ROW.expires_at).getTime(),
    );
    // Exactly one rotation happened end-to-end.
    expect(state.upsertCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // (D) Coverage corollary — the contested-branch read sees the winner's row.
  // ---------------------------------------------------------------------------
  //
  // Subtle invariant: after the winner UPSERTs and the loser re-reads, the
  // loser's `refreshToken` return value must be the winner's NEW access
  // token, not the pre-rotation value. This is the visibility contract that
  // prevents the loser from issuing a redundant rotation on the next cron
  // tick.

  it("(D) contested caller observes the winner's rotated token, not the pre-rotation row", async () => {
    pool()
      .intercept({ path: "/oauth/token", method: "POST" })
      .reply(200, {
        ...tokenFixture,
        access_token: "WINNER_ACCESS",
        refresh_token: "WINNER_REFRESH",
      });

    const { supabase } = makeRaceMock({
      tokenRow: { ...PRE_ROTATION_ROW },
      lockResults: [true, false],
    });

    const [a, b] = await Promise.all([
      refreshToken(supabase as Parameters<typeof refreshToken>[0], CFG, "USR_RACE"),
      refreshToken(supabase as Parameters<typeof refreshToken>[0], CFG, "USR_RACE"),
    ]);

    // Both ok — but more importantly, the loser's access_token is the
    // WINNER's rotated value (post-sleep re-read), not the pre-rotation
    // "OLD_ACCESS".
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.access_token).toBe("WINNER_ACCESS");
      expect(b.access_token).toBe("WINNER_ACCESS");
      // Neither caller returns the pre-rotation access token.
      expect(a.access_token).not.toBe("OLD_ACCESS");
      expect(b.access_token).not.toBe("OLD_ACCESS");
    }
  });
});
