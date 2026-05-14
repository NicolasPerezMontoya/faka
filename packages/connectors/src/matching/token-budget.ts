/**
 * Token budget tracker (Plan 2.2.4 — RESEARCH §Pitfall 7 mitigation 4).
 *
 * Daily LLM cost guard for the matching cascade's level 5 arbiter. Aggregates
 * `connector_runs.metadata_json->>'llm_tokens'` for today's runs of the given
 * canal and short-circuits the arbiter once the daily cap is reached.
 *
 * Design (RESEARCH §Pitfall 7 — LLM cost runaway):
 *   - `current()` reads the daily total from `connector_runs.metadata_json`.
 *     "Today" is computed in `America/Bogota` because runs are reported in
 *     local-business time (matches `v_hoy_*` views from Plan 2.1.2).
 *   - `exhausted()` returns `current() >= dailyCap`. The arbiter calls this
 *     BEFORE each LLM call and short-circuits to a reject verdict when true.
 *   - `record(tokens)` is an in-memory accumulator that the orchestrator
 *     (Plan 2.2.5) flushes to `connector_runs.metadata_json.llm_tokens` at
 *     run-end. Kept synchronous so level-5 calls don't pay a DB round-trip
 *     per arbitration.
 *
 * Anti-duplication invariant: this file MUST NOT call the LLM directly nor
 * import `@faka/llm`. It is a pure cost-ledger reader/writer that the level-5
 * arbiter coordinates with.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Channel } from "@faka/schema";

export class TokenBudgetTracker {
  private readonly supabase: SupabaseClient;
  private readonly dailyCap: number;
  private readonly canal: Channel;
  /** In-memory accumulator for tokens consumed during the current run. */
  private inMemory = 0;
  /** Cached daily total from the DB; refreshed by `current()`. */
  private dbTotalCache: number | null = null;

  constructor(supabase: SupabaseClient, dailyCap: number, canal: Channel) {
    this.supabase = supabase;
    this.dailyCap = dailyCap;
    this.canal = canal;
  }

  /**
   * Aggregate `metadata_json->>'llm_tokens'` for today's runs of this canal
   * plus the in-memory accumulator. "Today" is `America/Bogota` business day.
   *
   * Returns 0 on query error rather than throwing — the arbiter treats a
   * read failure as "budget unknown, proceed conservatively"; the upstream
   * cascade orchestrator's try/catch will still envelope any real fault.
   */
  async current(): Promise<number> {
    if (this.dbTotalCache === null) {
      this.dbTotalCache = await this.readDbTotal();
    }
    return this.dbTotalCache + this.inMemory;
  }

  /**
   * True when today's spend (DB + in-memory) has reached the daily cap.
   * The arbiter MUST check this before each LLM call.
   */
  async exhausted(): Promise<boolean> {
    const used = await this.current();
    return used >= this.dailyCap;
  }

  /**
   * Add tokens consumed by an LLM call to the in-memory accumulator.
   *
   * Synchronous (no DB round-trip per call) — the orchestrator flushes the
   * total to `connector_runs.metadata_json.llm_tokens` at run-end so the
   * next run's `current()` sees it.
   */
  record(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    this.inMemory += Math.floor(tokens);
  }

  /** Read-only accessor for the orchestrator to flush at run-end. */
  consumedThisRun(): number {
    return this.inMemory;
  }

  /** Daily cap (exposed for logging / metrics). */
  cap(): number {
    return this.dailyCap;
  }

  private async readDbTotal(): Promise<number> {
    // "Today" in business time (RESEARCH §America/Bogota — matches v_hoy_*).
    // We compute the DATE in JS so the query stays a simple range scan on
    // started_at (uses connector_runs_canal_started_idx).
    const { startUtc, endUtc } = bogotaTodayUtcRange(new Date());

    const { data, error } = await this.supabase
      .from("connector_runs")
      .select("metadata_json")
      .eq("canal", this.canal)
      .gte("started_at", startUtc)
      .lt("started_at", endUtc);

    if (error || !data) return 0;

    let total = 0;
    for (const row of data as Array<{
      metadata_json: { llm_tokens?: number } | null;
    }>) {
      const tokens = row.metadata_json?.llm_tokens;
      if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) {
        total += tokens;
      }
    }
    return total;
  }
}

/**
 * Compute the UTC range corresponding to "today" in America/Bogota.
 * Bogota is UTC-5 year-round (no DST), so we can use a fixed offset.
 *
 * Returns the half-open interval `[startUtc, endUtc)` as ISO strings suitable
 * for `gte` / `lt` filters on a `timestamptz` column.
 */
export function bogotaTodayUtcRange(now: Date): {
  startUtc: string;
  endUtc: string;
} {
  const OFFSET_MS = 5 * 60 * 60 * 1000; // UTC-5
  const local = new Date(now.getTime() - OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  // Local midnight = UTC 05:00 of the same calendar day.
  const startUtc = new Date(Date.UTC(year, month, day, 5, 0, 0, 0));
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
  };
}
