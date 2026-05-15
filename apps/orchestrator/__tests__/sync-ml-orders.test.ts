/**
 * Tests for `sync-ml-orders` cron — Plan 2.1.3.2.
 *
 * Coverage:
 *   (a) degraded mode (env unset) → succeeded no-op + connector_runs row
 *       with errors_json.reason='not_configured' and exit-0-friendly status.
 *   (b) no oauth_tokens row → same degraded shape with
 *       errors_json.reason='no_oauth_token_row'.
 *
 * The cascade-integration smoke case (happy path that asserts
 * `runMatchCascade` + `persistMatch` are called for every unmatched item)
 * is exercised in Wave 4's integration suite — unit tests stay quiet on the
 * network. This file's job is to prove the degraded-mode envelopes are
 * wired correctly so the operator can confirm "cron landed + idle, awaiting
 * OAuth bootstrap" by reading `connector_runs` rows alone.
 *
 * Anti-duplication: NO real api-client construction; NO real cascade call;
 * NO MSW. The degraded paths short-circuit before any of those run.
 */

import { describe, it, expect, vi } from "vitest";
import { runSyncMlOrders } from "../src/jobs/sync-ml-orders.js";
import type { JobLogger } from "../src/jobs/sync-ml-orders.js";

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
        // `computeSinceForOrders` reads from connector_runs.
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: [], error: null })),
                })),
              })),
            })),
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

describe("runSyncMlOrders", () => {
  it("degraded mode (env unset): records succeeded no-op + returns not_configured", async () => {
    const mock = buildSupabaseMock();
    const result = await runSyncMlOrders({
      getSupabase: () => mock.client as never,
      loadConfig: () => ({
        ok: false,
        reason: "not_configured",
        missing: ["ML_CLIENT_ID", "ML_WEBHOOK_SECRET"],
      }),
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });

    expect(result.status).toBe("not_configured");
    expect(result.records_processed).toBe(0);
    expect(result.records_failed).toBe(0);
    expect(result.cascade_attempts).toBe(0);
    expect(result.connector_run_id).toBe("mock-run-id");

    expect(mock.insertedRuns).toHaveLength(1);
    const row = mock.insertedRuns[0]!;
    expect(row.kind).toBe("channel");
    expect(row.canal).toBe("mercadolibre");
    expect(row.status).toBe("succeeded");
    expect(row.records_processed).toBe(0);
    const errors = row.errors_json as { reason: string; missing: string[] };
    expect(errors.reason).toBe("not_configured");
    expect(errors.missing).toContain("ML_CLIENT_ID");
    const meta = row.metadata_json as { tipo?: string; source?: string };
    expect(meta.tipo).toBe("orders");
    expect(meta.source).toBe("rest_pull");
  });

  it("configured but no oauth_tokens row: succeeded no-op with reason=no_oauth_token_row", async () => {
    const mock = buildSupabaseMock({ hasOauthRow: false });
    const result = await runSyncMlOrders({
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
    expect(result.cascade_attempts).toBe(0);

    expect(mock.insertedRuns).toHaveLength(1);
    const row = mock.insertedRuns[0]!;
    expect(row.kind).toBe("channel");
    expect(row.canal).toBe("mercadolibre");
    expect(row.status).toBe("succeeded");
    expect((row.errors_json as { reason: string }).reason).toBe(
      "no_oauth_token_row",
    );
  });

  it("idempotent reruns of the degraded path are no-ops", async () => {
    const mock = buildSupabaseMock();
    const cfg = () =>
      ({
        ok: false,
        reason: "not_configured",
        missing: ["ML_CLIENT_ID"],
      }) as const;
    const r1 = await runSyncMlOrders({
      getSupabase: () => mock.client as never,
      loadConfig: cfg,
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:00:00Z"),
    });
    const r2 = await runSyncMlOrders({
      getSupabase: () => mock.client as never,
      loadConfig: cfg,
      logger: quietLogger,
      now: () => new Date("2026-05-15T12:15:00Z"),
    });
    expect(r1.status).toBe("not_configured");
    expect(r2.status).toBe("not_configured");
    // Each call writes one row — but no sales / sale_items / cascade side-
    // effects occur because the degraded gate short-circuits first.
    expect(mock.insertedRuns).toHaveLength(2);
  });
});
