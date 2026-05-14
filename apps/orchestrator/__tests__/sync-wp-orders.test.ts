/**
 * Tests for `sync-wp-orders` cron — Plan 2.3.3.
 *
 * Scope: degraded-mode path (no WordPress creds → log + record skipped run
 * + clean return). The happy path exercises real WC REST + Supabase and
 * lives in the Wave 5 integration suite (Plan 2.5.x).
 *
 * Anti-duplication: this file MUST NOT assert against any real WC client.
 * The degraded-mode check is the one observable that doesn't require MSW
 * fixtures, so it's the right thing to gate in unit tests.
 */

import { describe, it, expect, vi } from "vitest";
import { runSyncWpOrders } from "../src/jobs/sync-wp-orders.js";
import type { JobLogger } from "../src/jobs/sync-wp-orders.js";

const quietLogger: JobLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function buildSupabaseMock(): {
  insertedRuns: Array<Record<string, unknown>>;
  client: { from: ReturnType<typeof vi.fn> };
} {
  const insertedRuns: Array<Record<string, unknown>> = [];
  const from = vi.fn((table: string) => {
    if (table === "connector_runs") {
      return {
        insert: vi.fn((row: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => {
              insertedRuns.push(row);
              return { data: { id: "mock-run-id" }, error: null };
            }),
          })),
        })),
      };
    }
    return { insert: vi.fn(), upsert: vi.fn(), select: vi.fn() };
  });
  return { insertedRuns, client: { from } };
}

describe("runSyncWpOrders", () => {
  it("degraded mode (env unset): records a skipped run + returns not_configured", async () => {
    const mock = buildSupabaseMock();
    const result = await runSyncWpOrders({
      getSupabase: () => mock.client as never,
      loadConfig: () => ({ ok: false, reason: "not_configured" }),
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });

    expect(result.status).toBe("not_configured");
    expect(result.records_processed).toBe(0);
    expect(result.records_failed).toBe(0);
    expect(result.connector_run_id).toBe("mock-run-id");

    // One connector_runs row landed with the degraded signal.
    expect(mock.insertedRuns).toHaveLength(1);
    const row = mock.insertedRuns[0];
    expect(row.kind).toBe("channel");
    expect(row.canal).toBe("wordpress");
    expect(row.status).toBe("succeeded");
    expect(row.records_processed).toBe(0);
    expect(row.errors_json).toEqual({ reason: "not_configured" });
    expect(
      (row.metadata_json as { tipo?: string; source?: string }).tipo,
    ).toBe("orders");
    expect(
      (row.metadata_json as { tipo?: string; source?: string }).source,
    ).toBe("rest_pull");
  });
});
