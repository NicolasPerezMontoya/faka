/**
 * Unit tests for TokenBudgetTracker (Plan 2.2.4).
 *
 * Covers the math of the in-memory accumulator plus the DB aggregation
 * contract. Supabase is stubbed via vi.fn so the test stays a pure unit
 * test (the matching integration tests in 2.2.5 will exercise the real
 * `connector_runs.metadata_json` path).
 *
 *   - `.record(tokens)` adds to the in-memory accumulator (sync, idempotent
 *      for non-positive values).
 *   - `.current()` = DB total (today's `connector_runs.metadata_json->>'llm_tokens'`
 *      summed) + in-memory accumulator.
 *   - `.exhausted()` returns true iff `.current() >= dailyCap`.
 *   - The DB query filters on `canal` and `started_at` within the
 *      America/Bogota business day.
 */

import { describe, it, expect, vi } from "vitest";
import {
  TokenBudgetTracker,
  bogotaTodayUtcRange,
} from "../../src/matching/token-budget.js";

type StubSupabase = {
  from: ReturnType<typeof vi.fn>;
};

function makeSupabaseStub(
  rows: Array<{ metadata_json: { llm_tokens?: number } | null }> | null,
  error: unknown = null,
): { supabase: StubSupabase; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {
    from: [],
    eq: [],
    gte: [],
    lt: [],
  };
  const lt = vi.fn(async (col: string, val: unknown) => {
    calls.lt!.push({ col, val });
    return { data: rows, error };
  });
  const gte = vi.fn((col: string, val: unknown) => {
    calls.gte!.push({ col, val });
    return { lt };
  });
  const eq = vi.fn((col: string, val: unknown) => {
    calls.eq!.push({ col, val });
    return { gte };
  });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    calls.from!.push(table);
    return { select };
  });
  return { supabase: { from }, calls };
}

describe("TokenBudgetTracker — record() in-memory accumulator", () => {
  it("accumulates positive integer token counts", () => {
    const { supabase } = makeSupabaseStub([]);
    const t = new TokenBudgetTracker(supabase as never, 1000, "wordpress");
    t.record(100);
    t.record(50);
    expect(t.consumedThisRun()).toBe(150);
  });

  it("ignores non-positive values and non-finite values", () => {
    const { supabase } = makeSupabaseStub([]);
    const t = new TokenBudgetTracker(supabase as never, 1000, "wordpress");
    t.record(0);
    t.record(-50);
    t.record(Number.NaN);
    t.record(Number.POSITIVE_INFINITY);
    expect(t.consumedThisRun()).toBe(0);
  });

  it("floors fractional tokens", () => {
    const { supabase } = makeSupabaseStub([]);
    const t = new TokenBudgetTracker(supabase as never, 1000, "wordpress");
    t.record(99.9);
    expect(t.consumedThisRun()).toBe(99);
  });
});

describe("TokenBudgetTracker — current() aggregates DB + in-memory", () => {
  it("sums today's connector_runs metadata_json.llm_tokens + in-memory", async () => {
    const { supabase, calls } = makeSupabaseStub([
      { metadata_json: { llm_tokens: 1000 } },
      { metadata_json: { llm_tokens: 500 } },
      { metadata_json: null },
      { metadata_json: {} },
    ]);
    const t = new TokenBudgetTracker(supabase as never, 5000, "wordpress");
    t.record(250);

    const total = await t.current();
    expect(total).toBe(1000 + 500 + 250);

    // Confirms the query shape: connector_runs, canal=wordpress, started_at range
    expect(calls.from).toEqual(["connector_runs"]);
    expect(calls.eq).toEqual([{ col: "canal", val: "wordpress" }]);
    expect(calls.gte![0]).toMatchObject({ col: "started_at" });
    expect(calls.lt![0]).toMatchObject({ col: "started_at" });
  });

  it("treats query error as 0 DB total (never throws)", async () => {
    const { supabase } = makeSupabaseStub(null, { message: "db down" });
    const t = new TokenBudgetTracker(supabase as never, 5000, "wordpress");
    t.record(100);
    const total = await t.current();
    expect(total).toBe(100);
  });

  it("caches the DB read so repeat current() calls don't re-query", async () => {
    const { supabase, calls } = makeSupabaseStub([
      { metadata_json: { llm_tokens: 100 } },
    ]);
    const t = new TokenBudgetTracker(supabase as never, 5000, "wordpress");
    await t.current();
    await t.current();
    await t.current();
    expect(calls.from!.length).toBe(1);
  });
});

describe("TokenBudgetTracker — exhausted() compares to dailyCap", () => {
  it("returns false when current() < cap", async () => {
    const { supabase } = makeSupabaseStub([
      { metadata_json: { llm_tokens: 100 } },
    ]);
    const t = new TokenBudgetTracker(supabase as never, 1000, "wordpress");
    expect(await t.exhausted()).toBe(false);
  });

  it("returns true when current() === cap (boundary)", async () => {
    const { supabase } = makeSupabaseStub([
      { metadata_json: { llm_tokens: 1000 } },
    ]);
    const t = new TokenBudgetTracker(supabase as never, 1000, "wordpress");
    expect(await t.exhausted()).toBe(true);
  });

  it("returns true when current() > cap", async () => {
    const { supabase } = makeSupabaseStub([
      { metadata_json: { llm_tokens: 900 } },
    ]);
    const t = new TokenBudgetTracker(supabase as never, 1000, "wordpress");
    t.record(200);
    expect(await t.exhausted()).toBe(true);
  });
});

describe("bogotaTodayUtcRange()", () => {
  it("returns a 24h window starting at Bogota midnight (UTC 05:00)", () => {
    // Pick a UTC moment that's clearly mid-day in Bogota.
    const probe = new Date("2026-05-15T18:00:00.000Z"); // 13:00 Bogota
    const { startUtc, endUtc } = bogotaTodayUtcRange(probe);
    expect(startUtc).toBe("2026-05-15T05:00:00.000Z");
    expect(endUtc).toBe("2026-05-16T05:00:00.000Z");
  });

  it("rolls to the previous business day when UTC is past midnight but Bogota isn't yet", () => {
    // 03:00 UTC = 22:00 previous-day Bogota.
    const probe = new Date("2026-05-15T03:00:00.000Z");
    const { startUtc } = bogotaTodayUtcRange(probe);
    expect(startUtc).toBe("2026-05-14T05:00:00.000Z");
  });
});
