/**
 * Tests for `/operacion/conectar-mercadolibre` — F2.1 Plan 2.1.3.4.
 *
 * Coverage:
 *   (a) start-oauth server action redirects to auth.mercadolibre.com.co
 *       with the correct query params (response_type, client_id, redirect_uri,
 *       state) AFTER persisting a row into oauth_state.
 *   (b) start-oauth degrades to error redirect when ML_CLIENT_ID env is unset.
 *   (c) start-oauth degrades to error redirect when the oauth_state insert
 *       fails.
 *   (d) start-oauth surface-tests the role gate — non-admin role triggers a
 *       redirect to /forbidden.
 *
 * Strategy: mock `next/headers`, `next/navigation` (`redirect`), and the
 * server-side Supabase client. Drive the server action directly and assert
 * on the redirect URL + the oauth_state row.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be set up BEFORE importing the module under test so the
// server-only "use server" directive doesn't fight Vitest's module loader.
const headersMock = vi.fn();
const redirectMock = vi.fn((_to: string) => {
  // Mirror Next's behavior: `redirect()` throws a special error to halt
  // server-action execution. We approximate that with a real throw + a
  // marker so the test asserts on the captured argument.
  throw new Error(`__REDIRECT__:${_to}`);
});

vi.mock("next/headers", () => ({
  headers: () => ({
    get: (name: string) => headersMock(name),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

const supabaseFromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({
    from: supabaseFromMock,
  }),
}));

// Import the action AFTER mocks are wired.
import { startMlOAuthAction } from "../app/(app)/operacion/conectar-mercadolibre/_actions/start-oauth";

function captureRedirect(): string {
  const call = redirectMock.mock.calls[redirectMock.mock.calls.length - 1];
  return call?.[0] ?? "";
}

describe("startMlOAuthAction", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    supabaseFromMock.mockReset();
    headersMock.mockReset();
    // Default role: super_admin.
    headersMock.mockImplementation((name: string) =>
      name === "x-user-role" ? "super_admin" : null,
    );
    delete process.env.ML_CLIENT_ID;
    delete process.env.ML_REDIRECT_URI;
  });

  it("(a) builds the authorize URL with client_id/redirect_uri/state + persists oauth_state row", async () => {
    process.env.ML_CLIENT_ID = "3933497047128728";
    process.env.ML_REDIRECT_URI =
      "https://orchestrator.example.test/oauth/mercadolibre/callback";

    const inserted: Array<Record<string, unknown>> = [];
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === "oauth_state") {
        return {
          insert: vi.fn(async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          }),
        };
      }
      return { insert: vi.fn(async () => ({ error: null })) };
    });

    await expect(startMlOAuthAction()).rejects.toThrow(/__REDIRECT__:/);

    const target = captureRedirect();
    expect(target).toMatch(/^https:\/\/auth\.mercadolibre\.com\.co\/authorization\?/);
    const url = new URL(target);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("3933497047128728");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://orchestrator.example.test/oauth/mercadolibre/callback",
    );
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(state!.length).toBe(64); // 32 bytes → 64 hex chars

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.canal).toBe("mercadolibre");
    expect(inserted[0]!.state).toBe(state);
  });

  it("(b) redirects to error page when ML_CLIENT_ID is unset", async () => {
    // No env set — redirect should land on the connect page with status=error.
    supabaseFromMock.mockImplementation(() => ({
      insert: vi.fn(async () => ({ error: null })),
    }));

    await expect(startMlOAuthAction()).rejects.toThrow(/__REDIRECT__:/);

    const target = captureRedirect();
    expect(target).toMatch(
      /\/operacion\/conectar-mercadolibre\?status=error&reason=missing_env/,
    );
  });

  it("(c) redirects to error page when the oauth_state insert fails", async () => {
    process.env.ML_CLIENT_ID = "3933497047128728";
    process.env.ML_REDIRECT_URI =
      "https://orchestrator.example.test/oauth/mercadolibre/callback";
    supabaseFromMock.mockImplementation(() => ({
      insert: vi.fn(async () => ({
        error: { message: "rls denied" },
      })),
    }));

    await expect(startMlOAuthAction()).rejects.toThrow(/__REDIRECT__:/);
    const target = captureRedirect();
    expect(target).toMatch(/oauth_state_insert_failed/);
  });

  it("(d) redirects non-admin role to /forbidden", async () => {
    headersMock.mockImplementation((name: string) =>
      name === "x-user-role" ? "analista" : null,
    );
    process.env.ML_CLIENT_ID = "3933497047128728";
    process.env.ML_REDIRECT_URI =
      "https://orchestrator.example.test/oauth/mercadolibre/callback";

    await expect(startMlOAuthAction()).rejects.toThrow(/__REDIRECT__:/);
    expect(captureRedirect()).toBe("/forbidden");
  });
});
