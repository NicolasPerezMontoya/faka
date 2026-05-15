/**
 * Tests for `sync-ml-products` cron — Plan 2.1.3.3.
 *
 * Coverage:
 *   (a) degraded mode (env unset) → succeeded no-op + connector_runs row
 *       with errors_json.reason='not_configured'.
 *   (b) no oauth_tokens row → succeeded no-op with reason='no_oauth_token_row'.
 *   (c) idempotent reruns of the degraded path are no-ops.
 *
 * The happy path (real scroll cursor + variant upsert) lives in Wave 4's
 * integration suite. Unit tests stay quiet on the network.
 */

import { describe, it, expect, vi } from "vitest";
import { runSyncMlProducts } from "../src/jobs/sync-ml-products.js";
import type { JobLogger } from "../src/jobs/sync-ml-products.js";

const quietLogger: JobLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function buildSupabaseMock(opts: { hasOauthRow?: boolean } = {}): {
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
    if (table === "oauth_tokens") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: opts.hasOauthRow ? { user_id: "123456789" } : null,
                error: null,
              })),
            })),
          })),
        })),
      };
    }
    return { insert: vi.fn(), upsert: vi.fn(), select: vi.fn() };
  });
  return { insertedRuns, client: { from } };
}

describe("runSyncMlProducts", () => {
  it("degraded mode (env unset): records succeeded no-op + returns not_configured", async () => {
    const mock = buildSupabaseMock();
    const result = await runSyncMlProducts({
      getSupabase: () => mock.client as never,
      loadConfig: () => ({
        ok: false,
        reason: "not_configured",
        missing: ["ML_CLIENT_ID"],
      }),
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });

    expect(result.status).toBe("not_configured");
    expect(result.items_fetched).toBe(0);
    expect(result.pages_scanned).toBe(0);
    expect(result.connector_run_id).toBe("mock-run-id");

    expect(mock.insertedRuns).toHaveLength(1);
    const row = mock.insertedRuns[0]!;
    expect(row.kind).toBe("channel");
    expect(row.canal).toBe("mercadolibre");
    expect(row.status).toBe("succeeded");
    const meta = row.metadata_json as { tipo?: string; source?: string };
    expect(meta.tipo).toBe("products");
    expect(meta.source).toBe("rest_pull");
    const errors = row.errors_json as { reason: string };
    expect(errors.reason).toBe("not_configured");
  });

  it("configured but no oauth_tokens row: succeeded no-op with reason=no_oauth_token_row", async () => {
    const mock = buildSupabaseMock({ hasOauthRow: false });
    const result = await runSyncMlProducts({
      getSupabase: () => mock.client as never,
      loadConfig: () => ({
        ok: true,
        cfg: {
          clientId: "3933497047128728",
          clientSecret: "test-secret",
          redirectUri:
            "https://orchestrator.example.test/oauth/mercadolibre/callback",
          webhookSecret: "test-webhook-secret",
          siteId: "MCO",
        },
      }),
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });

    expect(result.status).toBe("not_configured");
    expect(mock.insertedRuns).toHaveLength(1);
    const row = mock.insertedRuns[0]!;
    expect((row.errors_json as { reason: string }).reason).toBe(
      "no_oauth_token_row",
    );
    expect(
      (row.metadata_json as { tipo?: string }).tipo,
    ).toBe("products");
  });

  it("idempotent reruns of the degraded path are no-ops", async () => {
    const mock = buildSupabaseMock();
    const cfg = () =>
      ({
        ok: false,
        reason: "not_configured",
        missing: ["ML_CLIENT_ID"],
      }) as const;
    const r1 = await runSyncMlProducts({
      getSupabase: () => mock.client as never,
      loadConfig: cfg,
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });
    const r2 = await runSyncMlProducts({
      getSupabase: () => mock.client as never,
      loadConfig: cfg,
      logger: quietLogger,
      now: () => new Date("2026-05-15T13:00:00Z"),
    });
    expect(r1.status).toBe("not_configured");
    expect(r2.status).toBe("not_configured");
    expect(mock.insertedRuns).toHaveLength(2);
  });
});
