/**
 * Tests for `sync-wp-products` cron — Plan 2.3.3.
 *
 * Scope: degraded-mode path. Happy path lives in the Wave 5 integration
 * suite (Plan 2.5.x) where MSW + a real Supabase reset are available.
 */

import { describe, it, expect, vi } from "vitest";
import { runSyncWpProducts } from "../src/jobs/sync-wp-products.js";
import type { JobLogger } from "../src/jobs/sync-wp-products.js";

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

describe("runSyncWpProducts", () => {
  it("degraded mode (env unset): records a skipped run + returns not_configured", async () => {
    const mock = buildSupabaseMock();
    const result = await runSyncWpProducts({
      getSupabase: () => mock.client as never,
      loadConfig: () => ({ ok: false, reason: "not_configured" }),
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });

    expect(result.status).toBe("not_configured");
    expect(result.records_processed).toBe(0);
    expect(result.records_failed).toBe(0);
    expect(result.connector_run_id).toBe("mock-run-id");

    expect(mock.insertedRuns).toHaveLength(1);
    const row = mock.insertedRuns[0];
    expect(row.kind).toBe("channel");
    expect(row.canal).toBe("wordpress");
    expect(row.status).toBe("succeeded");
    expect(row.errors_json).toEqual({ reason: "not_configured" });
    expect(
      (row.metadata_json as { tipo?: string; source?: string }).tipo,
    ).toBe("products");
    expect(
      (row.metadata_json as { tipo?: string; source?: string }).source,
    ).toBe("rest_pull");
  });
});
